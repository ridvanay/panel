import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ConsultationRequest, CrmLead, CrmLeadStatus, Prisma } from "@prisma/client";
import { z } from "zod";
import { ok } from "../../lib/envelope";
import { logAudit } from "../../lib/audit";
import { decryptSecret } from "../../lib/crypto";
import { NotFoundError, ValidationError } from "../../lib/errors";
import { toCsv } from "../reports/reports.format";
import { formatRequestNumber } from "../consultation-requests/consultation-request-email";
import { readCrmSettings } from "./crm.settings";
import { parseOr422 } from "./crm.validate";
import { istanbulDate } from "./crm.rollup";
import { addLeadNote, AddNoteSchema, buildLeadWhere, computeSla, decryptNoteBody, LeadListQuerySchema, loadAssigneeNames } from "./crm.leads";

/**
 * Paket AJ-4 - admin CRM "Talepler" ekrani: danisma talepleri (kanal CONSULTATION_REQUEST) icin ozel uclar.
 * `registerCrmLeadRoutes` icinde `/requests*` altinda kayitlidir -> ADMIN + 2FA kapisinin (requireCrmAccess) ARKASINDADIR.
 * Kayit kimligi = CrmLead kimligi (`id`); bu ekran yalniz bes durumu gosterir/doner:
 * New(NEW) -> Contacted(CALLED) -> Planning(TREATMENT_PLANNED) -> Converted(TREATED) / Closed(NEGATIVE).
 * Mesaj (saglik verisi) listede/detayda DONMEZ; yalniz `/requests/:id/message` ile cozulur ve HER cozme audit'e yazilir.
 */
export const REQUEST_STATUS_TO_LEAD = {
  new: "NEW",
  contacted: "CALLED",
  planning: "TREATMENT_PLANNED",
  converted: "TREATED",
  closed: "NEGATIVE",
} as const satisfies Record<string, CrmLeadStatus>;
export type RequestStatus = keyof typeof REQUEST_STATUS_TO_LEAD;
export const REQUEST_STATUSES = Object.keys(REQUEST_STATUS_TO_LEAD) as RequestStatus[];
const LEAD_TO_REQUEST_STATUS = Object.fromEntries(Object.entries(REQUEST_STATUS_TO_LEAD).map(([k, v]) => [v, k])) as Record<string, RequestStatus>;
const MAPPED_LEAD_STATUSES = Object.values(REQUEST_STATUS_TO_LEAD) as CrmLeadStatus[];
const REQUEST_STATUS_LABELS: Record<RequestStatus, string> = { new: "Yeni", contacted: "Görüşüldü", planning: "Planlama", converted: "Dönüştü", closed: "Kapandı" };
const CHANNEL_LABELS: Record<string, string> = { email: "E-posta", whatsapp: "WhatsApp", phone: "Telefon" };
const EXPORT_MAX_ROWS = 10_000;

const IdParam = z.object({ id: z.string().uuid() });

const RequestListQuerySchema = z.object({
  status: z.string().max(200).optional(),
  specialtyId: z.string().uuid().optional(),
  assignedToId: z.string().uuid().optional(),
  q: z.string().trim().max(100).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
type RequestListQuery = z.infer<typeof RequestListQuerySchema>;

const UpdateRequestSchema = z
  .object({
    status: z.enum(["new", "contacted", "planning", "converted", "closed"]).optional(),
    assignedToId: z.string().uuid().nullable().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: "En az bir alan gönderilmeli." });

type LeadWithRequest = CrmLead & { consultationRequest: ConsultationRequest };

function actor(request: FastifyRequest) {
  return { id: request.user!.id, email: request.user!.email };
}

/** Kisisel veri (ad/e-posta/telefon) yalniz ADMIN'e. CRM kapisi bugun zaten ADMIN'dir; rol gevserse PII yine kapali kalir. */
function canSeePii(request: FastifyRequest): boolean {
  return request.user?.role === "ADMIN";
}

function buildRequestWhere(query: RequestListQuery): Prisma.CrmLeadWhereInput {
  const selected = (query.status ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is RequestStatus => (REQUEST_STATUSES as string[]).includes(s))
    .map((s) => REQUEST_STATUS_TO_LEAD[s]);
  const base = buildLeadWhere({
    ...LeadListQuerySchema.parse({}),
    channel: "CONSULTATION_REQUEST",
    status: (selected.length ? selected : MAPPED_LEAD_STATUSES).join(","),
    from: query.from,
    to: query.to,
    assignedToId: query.assignedToId,
    q: query.q,
  });
  const where: Prisma.CrmLeadWhereInput = { ...base, consultationRequest: { isNot: null } };
  if (query.specialtyId) where.consultationRequest = { is: { specialtyId: query.specialtyId } };
  const reqNo = query.q?.match(/^REQ-?0*(\d{1,9})$/i);
  if (reqNo) where.OR = [...(base.OR ?? []), { consultationRequest: { is: { seq: Number(reqNo[1]) } } }];
  return where;
}

function toRequestDto(lead: LeadWithRequest, slaHours: number, assignees: Map<string, string>, pii: boolean) {
  const r = lead.consultationRequest;
  return {
    id: lead.id,
    requestId: r.id,
    seq: r.seq,
    number: formatRequestNumber(r.seq),
    createdAt: r.createdAt.toISOString(),
    serviceName: r.serviceName,
    specialtyId: r.specialtyId,
    packageId: r.packageId,
    country: r.country,
    contactLanguage: r.contactLanguage,
    needsInterpreter: r.needsInterpreter,
    preferredContactChannel: r.preferredContactChannel,
    preferredFrom: r.preferredFrom ? r.preferredFrom.toISOString().slice(0, 10) : null,
    preferredTo: r.preferredTo ? r.preferredTo.toISOString().slice(0, 10) : null,
    status: LEAD_TO_REQUEST_STATUS[lead.status] ?? null,
    statusChangedAt: lead.statusChangedAt.toISOString(),
    assignedToId: lead.assignedToId,
    assignedToName: lead.assignedToId ? (assignees.get(lead.assignedToId) ?? null) : null,
    hasMessage: Boolean(r.messageEncrypted),
    anonymizedAt: r.anonymizedAt?.toISOString() ?? null,
    sla: computeSla(lead, slaHours),
    ...(pii ? { fullName: r.fullName, email: r.email, phone: r.phone } : {}),
  };
}

export async function registerCrmRequestRoutes(app: FastifyInstance) {
  async function loadRequestLead(id: string): Promise<LeadWithRequest> {
    const lead = await app.prisma.crmLead.findFirst({
      where: { id, channel: "CONSULTATION_REQUEST", consultationRequest: { isNot: null } },
      include: { consultationRequest: true },
    });
    if (!lead || !lead.consultationRequest) throw new NotFoundError("Talep bulunamadı.");
    return lead as LeadWithRequest;
  }

  async function authorOf(request: FastifyRequest) {
    const user = await app.prisma.user.findUnique({ where: { id: actor(request).id }, select: { name: true, email: true } });
    return { id: actor(request).id, name: user?.name || user?.email || "Yönetici" };
  }

  app.get("/requests", async (request, reply) => {
    const query = parseOr422(RequestListQuerySchema, request.query);
    const where = buildRequestWhere(query);
    const [settings, assignees, total, items, counts] = await Promise.all([
      readCrmSettings(app.prisma),
      loadAssigneeNames(app),
      app.prisma.crmLead.count({ where }),
      app.prisma.crmLead.findMany({ where, include: { consultationRequest: true }, orderBy: { createdAt: "desc" }, skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
      app.prisma.crmLead.groupBy({ by: ["status"], where: { ...where, status: { in: MAPPED_LEAD_STATUSES } }, _count: { _all: true } }),
    ]);
    const statusCounts = Object.fromEntries(REQUEST_STATUSES.map((s) => [s, 0])) as Record<RequestStatus, number>;
    for (const c of counts) {
      const key = LEAD_TO_REQUEST_STATUS[c.status];
      if (key) statusCounts[key] = c._count._all;
    }
    const pii = canSeePii(request);
    return reply.send(
      ok(
        items.map((lead) => toRequestDto(lead as LeadWithRequest, settings.slaHours, assignees, pii)),
        { total, page: query.page, pageSize: query.pageSize, statusCounts }
      )
    );
  });

  app.get("/requests/assignees", async (_request, reply) => {
    const users = await app.prisma.user.findMany({
      where: { role: { in: ["ADMIN", "MANAGER"] }, status: "ACTIVE" },
      orderBy: { name: "asc" },
      select: { id: true, name: true, email: true },
    });
    return reply.send(ok(users.map((u) => ({ id: u.id, name: u.name || u.email }))));
  });

  app.get("/requests/export", async (request, reply) => {
    const query = parseOr422(RequestListQuerySchema, request.query);
    const where = buildRequestWhere(query);
    const pii = canSeePii(request);
    const [settings, assignees, items] = await Promise.all([
      readCrmSettings(app.prisma),
      loadAssigneeNames(app),
      app.prisma.crmLead.findMany({ where, include: { consultationRequest: true }, orderBy: { createdAt: "desc" }, take: EXPORT_MAX_ROWS }),
    ]);
    const columns = ["No", "Tarih", "Hizmet", "Ülke", "Dil", "Tercüman", "Tercih edilen kanal", "Tercih edilen başlangıç", "Tercih edilen bitiş", "Durum", "Atanan", ...(pii ? ["Ad", "E-posta", "Telefon"] : [])];
    const rows = items.map((lead) => {
      const dto = toRequestDto(lead as LeadWithRequest, settings.slaHours, assignees, pii) as ReturnType<typeof toRequestDto> & { fullName?: string | null; email?: string | null; phone?: string | null };
      return [
        dto.number,
        dto.createdAt,
        dto.serviceName,
        dto.country,
        dto.contactLanguage,
        dto.needsInterpreter ? "evet" : "hayır",
        dto.preferredContactChannel ? (CHANNEL_LABELS[dto.preferredContactChannel] ?? dto.preferredContactChannel) : "",
        dto.preferredFrom ?? "",
        dto.preferredTo ?? "",
        dto.status ? REQUEST_STATUS_LABELS[dto.status] : "",
        dto.assignedToName ?? "",
        ...(pii ? [dto.fullName ?? "", dto.email ?? "", dto.phone ?? ""] : []),
      ];
    });
    await logAudit(app, {
      actorId: actor(request).id,
      actorEmail: actor(request).email,
      action: "crm.requests.export",
      targetType: "ConsultationRequest",
      metadata: { rows: rows.length, includesPii: pii, filters: { status: query.status ?? null, specialtyId: query.specialtyId ?? null, from: query.from ?? null, to: query.to ?? null, q: query.q ? true : false } },
      ipAddress: request.ip,
    });
    return reply
      .header("content-type", "text/csv; charset=utf-8")
      .header("content-disposition", `attachment; filename="talepler-${istanbulDate()}.csv"`)
      .header("cache-control", "no-store")
      .send(toCsv(columns, rows));
  });

  app.get("/requests/:id", async (request, reply) => {
    const { id } = parseOr422(IdParam, request.params);
    const lead = await loadRequestLead(id);
    const [settings, assignees, notes] = await Promise.all([
      readCrmSettings(app.prisma),
      loadAssigneeNames(app),
      app.prisma.crmLeadNote.findMany({ where: { leadId: id }, orderBy: { createdAt: "desc" } }),
    ]);
    await logAudit(app, { actorId: actor(request).id, actorEmail: actor(request).email, action: "crm.lead.viewed", targetType: "CrmLead", targetId: id, ipAddress: request.ip });
    const r = lead.consultationRequest;
    return reply.send(
      ok({
        ...toRequestDto(lead, settings.slaHours, assignees, canSeePii(request)),
        contactConsentAt: r.contactConsentAt.toISOString(),
        healthDataConsentAt: r.healthDataConsentAt?.toISOString() ?? null,
        consentTextVersion: r.consentTextVersion,
        locale: r.locale,
        notes: notes.map((n) => ({ id: n.id, kind: n.kind, authorName: n.authorName, body: decryptNoteBody(n.bodyCiphertext), createdAt: n.createdAt.toISOString() })),
      })
    );
  });

  /** Talep mesaji (saglik verisi olabilir): ADMIN + 2FA kapisi + HER cozme audit'e (icerik YAZILMAZ). */
  app.get("/requests/:id/message", async (request, reply) => {
    const { id } = parseOr422(IdParam, request.params);
    const lead = await loadRequestLead(id);
    const r = lead.consultationRequest;
    let message: string | null = null;
    let failed = false;
    if (r.messageEncrypted) {
      try {
        message = decryptSecret(r.messageEncrypted);
      } catch (err) {
        failed = true;
        app.log.error({ leadId: id, consultationRequestId: r.id, error: err instanceof Error ? err.name : "unknown" }, "Danışma talebi mesajı çözülemedi.");
        message = "[Mesaj çözülemedi]";
      }
    }
    await logAudit(app, {
      actorId: actor(request).id,
      actorEmail: actor(request).email,
      action: failed ? "crm.consultation_request.decrypt_failed" : "crm.consultation_request.message_viewed",
      targetType: "CrmLead",
      targetId: id,
      metadata: { hasMessage: Boolean(r.messageEncrypted) },
      ipAddress: request.ip,
    });
    reply.header("cache-control", "no-store");
    return reply.send(ok({ id, number: formatRequestNumber(r.seq), message }));
  });

  app.patch("/requests/:id", async (request, reply) => {
    const { id } = parseOr422(IdParam, request.params);
    const input = parseOr422(UpdateRequestSchema, request.body);
    const lead = await loadRequestLead(id);
    if (input.assignedToId) {
      const user = await app.prisma.user.findFirst({ where: { id: input.assignedToId, role: { in: ["ADMIN", "MANAGER"] }, status: "ACTIVE" }, select: { id: true } });
      if (!user) throw new ValidationError("Atanacak kişi bulunamadı.", { assignedToId: ["Yalnızca aktif personel atanabilir."] });
    }
    const now = new Date();
    const data: Prisma.CrmLeadUncheckedUpdateInput = {};
    const newLeadStatus = input.status ? REQUEST_STATUS_TO_LEAD[input.status] : undefined;
    const statusChanged = newLeadStatus !== undefined && newLeadStatus !== lead.status;
    if (statusChanged) {
      data.status = newLeadStatus;
      data.statusChangedAt = now;
      if (!lead.firstResponseAt && newLeadStatus !== "NEW") data.firstResponseAt = now;
    }
    const assignChanged = input.assignedToId !== undefined && input.assignedToId !== lead.assignedToId;
    if (assignChanged) data.assignedToId = input.assignedToId;
    if (statusChanged || assignChanged) {
      const author = await authorOf(request);
      await app.prisma.$transaction(async (tx) => {
        await tx.crmLead.update({ where: { id }, data });
        if (statusChanged) {
          const from = LEAD_TO_REQUEST_STATUS[lead.status];
          await addLeadNote(tx, id, `Durum: ${from ? REQUEST_STATUS_LABELS[from] : lead.status} → ${REQUEST_STATUS_LABELS[input.status!]}`, "STATUS", author);
        }
        if (assignChanged) await addLeadNote(tx, id, input.assignedToId ? "Talep atandı." : "Atama kaldırıldı.", "SYSTEM", author);
      });
      await logAudit(app, {
        actorId: actor(request).id,
        actorEmail: actor(request).email,
        action: "crm.lead.update",
        targetType: "CrmLead",
        targetId: id,
        metadata: { fields: Object.keys(input), ...(statusChanged ? { status: input.status } : {}) },
        ipAddress: request.ip,
      });
    }
    const [settings, assignees, fresh] = await Promise.all([readCrmSettings(app.prisma), loadAssigneeNames(app), loadRequestLead(id)]);
    return reply.send(ok(toRequestDto(fresh, settings.slaHours, assignees, canSeePii(request))));
  });

  app.post("/requests/:id/notes", async (request, reply) => {
    const { id } = parseOr422(IdParam, request.params);
    const input = parseOr422(AddNoteSchema, request.body);
    const lead = await loadRequestLead(id);
    if (lead.anonymizedAt) throw new ValidationError("Anonimleştirilmiş talebe not eklenemez.");
    const author = await authorOf(request);
    const note = await app.prisma.$transaction(async (tx) => {
      const created = await addLeadNote(tx, id, input.body, "NOTE", author);
      if (!lead.firstResponseAt) await tx.crmLead.update({ where: { id }, data: { firstResponseAt: new Date() } });
      return created;
    });
    await logAudit(app, { actorId: actor(request).id, actorEmail: actor(request).email, action: "crm.lead.note", targetType: "CrmLead", targetId: id, ipAddress: request.ip });
    return reply.code(201).send(ok({ id: note.id, kind: note.kind, authorName: note.authorName, body: input.body, createdAt: note.createdAt.toISOString() }));
  });
}
