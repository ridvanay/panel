import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { authenticate } from "../../middleware/authenticate";
import { requireSiteRole } from "../../middleware/site-rbac";
import { requirePanelAccess } from "../../middleware/panel-access";
import { ROLES_ADMIN_MANAGER } from "../../lib/site-roles";
import { ok } from "../../lib/envelope";
import { ApiSuccessSchema, ApiSuccessWithMeta } from "../../schemas/common";
import {
  SupportAgentSummarySchema,
  SupportChatMessageSchema,
  SupportChatSessionSchema,
  SupportChatSessionSummarySchema,
  SupportReplyTemplateSchema,
  SupportSessionCountsSchema,
  SupportSessionStatusSchema,
} from "../../schemas/entities";
import {
  toSupportAgentSummaryDto,
  toSupportChatMessageDto,
  toSupportChatSessionDto,
  toSupportChatSessionSummaryDto,
  toSupportReplyTemplateDto,
} from "../../mappers";
import { ConflictError, NotFoundError } from "../../lib/errors";
import { logAudit } from "../../lib/audit";
import { encodeCursor, parseCursor } from "../../lib/pagination";
import { SUPPORT_MESSAGE_RATE_LIMIT } from "../../lib/rate-limit";
import {
  AssignSupportSessionRequestSchema,
  CreateSupportReplyTemplateRequestSchema,
  ListAdminSupportSessionsQuerySchema,
  ListSupportTemplatesQuerySchema,
  SendSupportAgentMessageRequestSchema,
  SessionIdParamSchema,
  SupportAfterSeqQuerySchema,
  TemplateIdParamSchema,
  UpdateSupportReplyTemplateRequestSchema,
  UpdateSupportSessionRequestSchema,
} from "./support.schemas";
import {
  WITH_SESSION_RELATIONS,
  appendAgentMessage,
  assertValidAssignmentTarget,
  computeUnreadForAgent,
  fetchLastMessagePreview,
  type SupportChatSessionWithRelations,
} from "./support.service";

const SupportMessagesMetaSchema = z.object({
  status: SupportSessionStatusSchema,
  lastSeq: z.number().int().nullable(),
});

const AdminSupportSessionsListMetaSchema = z.object({
  nextCursor: z.string().nullable(),
  counts: SupportSessionCountsSchema,
});

const SUPPORT_AGENT_SUMMARY_ROLES = new Set(["ADMIN", "MANAGER"]);

/**
 * Savunma katmanı (bug fix, 2026-09-16 qa-agent raporu) — `SupportAgentSummarySchema.role`
 * yalnızca `ADMIN`/`MANAGER` kabul eder. Kök neden düzeltmesi (`admin-users.routes.ts::
 * clearSupportAssignmentsIfDemoted`) rol düşürüldüğü ANDA atamayı temizler, ama bu satır BU
 * fix'ten ÖNCE oluşmuş bozuk kayıtları (veya öngörülemeyen bir yarış durumunu) KAPSAMAZ —
 * mapper'a asla geçersiz role'lü bir `assignedAgent`/`closedBy` verilmez; bunun yerine `null`'a
 * düşürülür ve veri tutarsızlığı sinyali olarak `warn` loglanır (sessizce yutulmaz). Response
 * şeması ASLA genişletilmez (kontrat sabit kalır) — bkz. `schemas/entities.ts::
 * SupportAgentSummarySchema`.
 */
function sanitizeSupportAgent(
  app: FastifyInstance,
  agent: SupportChatSessionWithRelations["assignedAgent"],
  context: { sessionId: string; field: "assignedAgent" | "closedBy" }
): SupportChatSessionWithRelations["assignedAgent"] {
  if (!agent) return null;
  if (SUPPORT_AGENT_SUMMARY_ROLES.has(agent.role)) return agent;
  app.log.warn(
    { sessionId: context.sessionId, field: context.field, userId: agent.id, role: agent.role },
    "support: veri tutarsızlığı — atanan kullanıcının rolü artık ADMIN/MANAGER değil, response'ta null'a düşürüldü"
  );
  return null;
}

async function buildSessionSummaryDto(app: FastifyInstance, session: SupportChatSessionWithRelations) {
  const [unreadForAgent, lastMessagePreview] = await Promise.all([
    computeUnreadForAgent(app, session.id, session.lastAgentMessageAt),
    fetchLastMessagePreview(app, session.id),
  ]);
  const assignedAgent = sanitizeSupportAgent(app, session.assignedAgent, { sessionId: session.id, field: "assignedAgent" });
  return toSupportChatSessionSummaryDto(session, { assignedAgent, unreadForAgent, lastMessagePreview });
}

async function buildSessionDetailDto(app: FastifyInstance, session: SupportChatSessionWithRelations) {
  const [unreadForAgent, lastMessagePreview] = await Promise.all([
    computeUnreadForAgent(app, session.id, session.lastAgentMessageAt),
    fetchLastMessagePreview(app, session.id),
  ]);
  const assignedAgent = sanitizeSupportAgent(app, session.assignedAgent, { sessionId: session.id, field: "assignedAgent" });
  const closedBy = sanitizeSupportAgent(app, session.closedBy, { sessionId: session.id, field: "closedBy" });
  return toSupportChatSessionDto(session, {
    assignedAgent,
    closedBy,
    unreadForAgent,
    lastMessagePreview,
  });
}

async function findSessionOrThrow(app: FastifyInstance, sessionId: string): Promise<SupportChatSessionWithRelations> {
  const session = await app.prisma.supportChatSession.findUnique({ where: { id: sessionId }, include: WITH_SESSION_RELATIONS });
  if (!session) throw new NotFoundError("Destek oturumu bulunamadı.");
  return session;
}

/**
 * `/admin/support` prefix'i altında bağlanır (bkz. app.ts). `.claude/architect-scope-support-
 * desk-and-reminders.md` §3.2 — `SiteRole = ADMIN veya MANAGER` (EDITOR ziyaretçi PII'sine
 * erişemez, tüm uçlarda 403 alır). `telehealth.notifications.routes.ts`'in ayrık-dosya
 * deseniyle AYNI: ziyaretçi yüzeyi `support.public.routes.ts`te, bu dosya YALNIZCA yönetim.
 */
export async function adminSupportRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>();
  server.addHook("preHandler", authenticate);
  server.addHook("preHandler", requirePanelAccess());
  server.addHook("preHandler", requireSiteRole(...ROLES_ADMIN_MANAGER));

  server.get(
    "/sessions",
    {
      schema: {
        querystring: ListAdminSupportSessionsQuerySchema,
        response: { 200: ApiSuccessWithMeta(z.array(SupportChatSessionSummarySchema), AdminSupportSessionsListMetaSchema) },
      },
    },
    async (request, reply) => {
      const { cursor, limit, status, assignedAgentId, q } = request.query;
      const cursorSeq = parseCursor(cursor);

      const assignedFilter: Prisma.SupportChatSessionWhereInput | undefined =
        assignedAgentId === "me"
          ? { assignedAgentId: request.user!.id }
          : assignedAgentId === "unassigned"
            ? { assignedAgentId: null }
            : assignedAgentId
              ? { assignedAgentId }
              : undefined;

      const where: Prisma.SupportChatSessionWhereInput = {
        ...(cursorSeq ? { seq: { lt: cursorSeq } } : {}),
        ...(status ? { status } : {}),
        ...(assignedFilter ?? {}),
        ...(q ? { OR: [{ visitorName: { contains: q, mode: "insensitive" } }, { visitorEmail: { contains: q, mode: "insensitive" } }] } : {}),
      };

      const [rows, counts] = await Promise.all([
        app.prisma.supportChatSession.findMany({ where, orderBy: { seq: "desc" }, take: limit, include: WITH_SESSION_RELATIONS }),
        // §10.7 `ContentCounts` disipliniyle AYNI — istekteki `status` filtresinden ETKİLENMEZ.
        app.prisma.supportChatSession.groupBy({ by: ["status"], _count: { _all: true } }),
      ]);

      const countsByStatus = new Map(counts.map((c) => [c.status, c._count._all]));
      const pending = countsByStatus.get("PENDING") ?? 0;
      const answered = countsByStatus.get("ANSWERED") ?? 0;
      const closed = countsByStatus.get("CLOSED") ?? 0;

      const dtos = await Promise.all(rows.map((row) => buildSessionSummaryDto(app, row)));
      const nextCursor = rows.length === limit ? encodeCursor(rows[rows.length - 1]!.seq) : null;

      return reply.send(ok(dtos, { nextCursor, counts: { pending, answered, closed, all: pending + answered + closed } }));
    }
  );

  server.get(
    "/sessions/:sessionId",
    { schema: { params: SessionIdParamSchema, response: { 200: ApiSuccessSchema(SupportChatSessionSchema) } } },
    async (request, reply) => {
      const session = await findSessionOrThrow(app, request.params.sessionId);

      // [ASD] compliance-notes §7 (bağlayıcı, YENİ) — oturum+personel+GÜN başına BİR KEZ
      // `support.session_viewed` audit. Mesaj poll ucu (`GET .../messages`) LOGLANMAZ.
      const dayStart = new Date();
      dayStart.setUTCHours(0, 0, 0, 0);
      const alreadyViewedToday = await app.prisma.auditLog.findFirst({
        where: { action: "support.session_viewed", targetId: session.id, actorId: request.user!.id, createdAt: { gte: dayStart } },
        select: { id: true },
      });
      if (!alreadyViewedToday) {
        await logAudit(app, {
          actorId: request.user!.id,
          actorEmail: request.user!.email,
          action: "support.session_viewed",
          targetType: "SupportChatSession",
          targetId: session.id,
          metadata: { sessionId: session.id },
          ipAddress: request.ip,
        });
      }

      return reply.send(ok(await buildSessionDetailDto(app, session)));
    }
  );

  server.patch(
    "/sessions/:sessionId",
    {
      schema: {
        params: SessionIdParamSchema,
        body: UpdateSupportSessionRequestSchema,
        response: { 200: ApiSuccessSchema(SupportChatSessionSchema) },
      },
    },
    async (request, reply) => {
      const session = await findSessionOrThrow(app, request.params.sessionId);
      const fromStatus = session.status;
      const toStatus = request.body.status;

      const now = new Date();
      const updated = await app.prisma.supportChatSession.update({
        where: { id: session.id },
        data:
          toStatus === "CLOSED"
            ? { status: "CLOSED", closedAt: now, closedById: request.user!.id }
            : { status: "PENDING", closedAt: null, closedById: null },
        include: WITH_SESSION_RELATIONS,
      });

      // `contact.submission_status_change` disipliniyle BİREBİR aynı — ziyaretçi adı/e-postası/
      // mesaj içeriği metadata'ya YAZILMAZ.
      await logAudit(app, {
        actorId: request.user!.id,
        actorEmail: request.user!.email,
        action: "support.session_status_change",
        targetType: "SupportChatSession",
        targetId: session.id,
        metadata: { from: fromStatus, to: toStatus },
        ipAddress: request.ip,
      });

      return reply.send(ok(await buildSessionDetailDto(app, updated)));
    }
  );

  server.delete(
    "/sessions/:sessionId",
    { schema: { params: SessionIdParamSchema, response: { 204: z.undefined() } } },
    async (request, reply) => {
      const session = await findSessionOrThrow(app, request.params.sessionId);

      // Geri alınamaz — çöp kutusu YOKTUR (KVKK md.11 silme talebinin karşılığı). Mesajlar
      // `onDelete: Cascade` ile gider.
      await app.prisma.supportChatSession.delete({ where: { id: session.id } });

      await logAudit(app, {
        actorId: request.user!.id,
        actorEmail: request.user!.email,
        action: "support.session_delete",
        targetType: "SupportChatSession",
        targetId: session.id,
        ipAddress: request.ip,
      });

      return reply.code(204).send();
    }
  );

  server.get(
    "/sessions/:sessionId/messages",
    {
      schema: {
        params: SessionIdParamSchema,
        querystring: SupportAfterSeqQuerySchema,
        response: { 200: ApiSuccessWithMeta(z.array(SupportChatMessageSchema), SupportMessagesMetaSchema) },
      },
    },
    async (request, reply) => {
      const session = await findSessionOrThrow(app, request.params.sessionId);

      // Yan etkisizdir — "okundu" İŞARETLEMEZ, audit ÜRETMEZ (bkz. `GET .../{sessionId}` detay
      // ucu, [ASD] compliance-notes §7).
      const messages = await app.prisma.supportChatMessage.findMany({
        where: {
          sessionId: session.id,
          ...(request.query.afterSeq !== undefined ? { seq: { gt: request.query.afterSeq } } : {}),
        },
        orderBy: { seq: "asc" },
        take: 200,
      });
      const lastSeq = messages.length > 0 ? messages[messages.length - 1]!.seq : null;

      return reply.send(ok(messages.map(toSupportChatMessageDto), { status: session.status, lastSeq }));
    }
  );

  server.post(
    "/sessions/:sessionId/messages",
    {
      config: { rateLimit: SUPPORT_MESSAGE_RATE_LIMIT },
      schema: {
        params: SessionIdParamSchema,
        body: SendSupportAgentMessageRequestSchema,
        response: { 201: ApiSuccessSchema(SupportChatMessageSchema) },
      },
    },
    async (request, reply) => {
      const session = await findSessionOrThrow(app, request.params.sessionId);

      // `senderDisplayName` gönderim ANINDAKİ personel ADI SNAPSHOT'ıdır — e-posta DEĞİL
      // (`OrderItem.productTitle` disiplini, bkz. schema.prisma yorumu). `request.user` yalnızca
      // `{id, email, role}` taşır (bkz. middleware/authenticate.ts), `name` AYRICA okunur.
      const actorUser = await app.prisma.user.findUniqueOrThrow({ where: { id: request.user!.id }, select: { name: true } });

      const { message, autoAssigned } = await appendAgentMessage(
        app,
        session,
        { id: request.user!.id, name: actorUser.name },
        request.body.body,
        request.body.templateId ?? null
      );

      if (autoAssigned) {
        await logAudit(app, {
          actorId: request.user!.id,
          actorEmail: request.user!.email,
          action: "support.session_assigned",
          targetType: "SupportChatSession",
          targetId: session.id,
          metadata: { fromAgentId: null, toAgentId: request.user!.id },
          ipAddress: request.ip,
        });
      }

      await logAudit(app, {
        actorId: request.user!.id,
        actorEmail: request.user!.email,
        action: "support.message_sent",
        targetType: "SupportChatSession",
        targetId: session.id,
        metadata: { templateId: request.body.templateId ?? null },
        ipAddress: request.ip,
      });

      return reply.code(201).send(ok(toSupportChatMessageDto(message)));
    }
  );

  server.patch(
    "/sessions/:sessionId/assign",
    {
      schema: {
        params: SessionIdParamSchema,
        body: AssignSupportSessionRequestSchema,
        response: { 200: ApiSuccessSchema(SupportChatSessionSchema) },
      },
    },
    async (request, reply) => {
      const session = await findSessionOrThrow(app, request.params.sessionId);
      await assertValidAssignmentTarget(app, request.body.agentId);

      const now = new Date();
      const updated = await app.prisma.supportChatSession.update({
        where: { id: session.id },
        data: { assignedAgentId: request.body.agentId, assignedAt: request.body.agentId ? now : null },
        include: WITH_SESSION_RELATIONS,
      });

      await logAudit(app, {
        actorId: request.user!.id,
        actorEmail: request.user!.email,
        action: "support.session_assigned",
        targetType: "SupportChatSession",
        targetId: session.id,
        metadata: { fromAgentId: session.assignedAgentId, toAgentId: request.body.agentId },
        ipAddress: request.ip,
      });

      return reply.send(ok(await buildSessionDetailDto(app, updated)));
    }
  );

  server.get(
    "/agents",
    { schema: { response: { 200: ApiSuccessSchema(z.array(SupportAgentSummarySchema)) } } },
    async (_request, reply) => {
      // [ASD] §3.2/§3.6 madde 6 (bağlayıcı) — filtre SABİTTİR, istemciden GELMEZ. `email` ASLA
      // dönmez, sayfalama YOKTUR.
      const agents = await app.prisma.user.findMany({
        where: { status: "ACTIVE", deletedAt: null, role: { in: ["ADMIN", "MANAGER"] } },
        select: { id: true, name: true, role: true },
        orderBy: { name: "asc" },
      });
      return reply.send(ok(agents.map(toSupportAgentSummaryDto)));
    }
  );

  server.get(
    "/templates",
    {
      schema: { querystring: ListSupportTemplatesQuerySchema, response: { 200: ApiSuccessSchema(z.array(SupportReplyTemplateSchema)) } },
    },
    async (request, reply) => {
      const rows = await app.prisma.supportReplyTemplate.findMany({
        where: request.query.includeInactive ? {} : { isActive: true },
        orderBy: [{ sortOrder: "asc" }, { seq: "asc" }],
      });
      return reply.send(ok(rows.map(toSupportReplyTemplateDto)));
    }
  );

  server.post(
    "/templates",
    {
      schema: { body: CreateSupportReplyTemplateRequestSchema, response: { 201: ApiSuccessSchema(SupportReplyTemplateSchema) } },
    },
    async (request, reply) => {
      const totalCount = await app.prisma.supportReplyTemplate.count();
      if (totalCount >= 100) {
        throw new ConflictError("Şablon üst sınırına (100) ulaşıldı.");
      }

      let sortOrder = request.body.sortOrder ?? null;
      if (sortOrder === null) {
        const max = await app.prisma.supportReplyTemplate.aggregate({ _max: { sortOrder: true } });
        sortOrder = (max._max.sortOrder ?? 0) + 10;
      }

      const created = await app.prisma.supportReplyTemplate.create({
        data: {
          title: request.body.title,
          body: request.body.body,
          sortOrder,
          isActive: request.body.isActive,
        },
      });

      return reply.code(201).send(ok(toSupportReplyTemplateDto(created)));
    }
  );

  server.patch(
    "/templates/:templateId",
    {
      schema: {
        params: TemplateIdParamSchema,
        body: UpdateSupportReplyTemplateRequestSchema,
        response: { 200: ApiSuccessSchema(SupportReplyTemplateSchema) },
      },
    },
    async (request, reply) => {
      const existing = await app.prisma.supportReplyTemplate.findUnique({ where: { id: request.params.templateId } });
      if (!existing) throw new NotFoundError("Şablon bulunamadı.");

      const updated = await app.prisma.supportReplyTemplate.update({
        where: { id: existing.id },
        data: {
          ...(request.body.title !== undefined ? { title: request.body.title } : {}),
          ...(request.body.body !== undefined ? { body: request.body.body } : {}),
          ...(request.body.sortOrder !== undefined ? { sortOrder: request.body.sortOrder } : {}),
          ...(request.body.isActive !== undefined ? { isActive: request.body.isActive } : {}),
        },
      });

      return reply.send(ok(toSupportReplyTemplateDto(updated)));
    }
  );

  server.delete(
    "/templates/:templateId",
    { schema: { params: TemplateIdParamSchema, response: { 204: z.undefined() } } },
    async (request, reply) => {
      const existing = await app.prisma.supportReplyTemplate.findUnique({ where: { id: request.params.templateId } });
      if (!existing) throw new NotFoundError("Şablon bulunamadı.");

      // Kalıcı silme — şablondan ÜRETİLMİŞ geçmiş mesajlar ETKİLENMEZ (`body` bir SNAPSHOT'tır).
      await app.prisma.supportReplyTemplate.delete({ where: { id: existing.id } });

      return reply.code(204).send();
    }
  );
}
