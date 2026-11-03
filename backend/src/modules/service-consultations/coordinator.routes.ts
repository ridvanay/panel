import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { requireModuleEnabled } from "../../middleware/module-guard";
import { authenticate } from "../../middleware/authenticate";
import { ok } from "../../lib/envelope";
import { ApiSuccessSchema } from "../../schemas/common";
import { decryptSecret } from "../../lib/crypto";
import { logAudit } from "../../lib/audit";
import { ROLES_PANEL } from "../../lib/site-roles";
import { LiveKitNotConfiguredError, MeetingNotOpenError, NotFoundError, ServiceCoordinatorForbiddenError, TwoFactorRequiredError } from "../../lib/errors";
import { isLiveKitConfigured } from "../telehealth/lib/livekit";
import { MEETING_JOIN_LEAD_MS, createMeetingHostToken, ensureMeetingRoom } from "../telehealth/lib/meeting-livekit";
import { addCalendarDays, getStartOfCalendarDayInTimeZone } from "../telehealth/lib/timezone";
import { parseIsoCalendarDate } from "../telehealth/lib/availability";
import { MeetingTokenResponseSchema } from "../meetings/meetings.schemas";
import { computePhase, meetingOpensAt, serviceCoordinatorLabel } from "../meetings/meetings.service";
import { getOrCreateDesk } from "./service-desk";
import { dateKeyInZone } from "./service-slots";
import { formatConsultationNumber } from "./service-consultation-tokens";

const HOST_TOKEN_RATE_LIMIT = { max: 10, timeWindow: "1 minute" };
const READ_RATE_LIMIT = { max: 60, timeWindow: "1 minute" };
const MESSAGE_RATE_LIMIT = { max: 20, timeWindow: "1 minute" };

const StatusSchema = z.enum(["PENDING_PAYMENT", "SCHEDULED", "COMPLETED", "CANCELLED", "NO_SHOW"]);

const CoordinatorConsultationSchema = z.object({
  id: z.string(),
  consultationNumber: z.string(),
  startsAt: z.string(),
  endsAt: z.string(),
  status: StatusSchema,
  serviceName: z.string(),
  patientName: z.string(),
  country: z.string().nullable(),
  contactLanguage: z.string().nullable(),
  needsInterpreter: z.boolean(),
  interpreterLanguage: z.string().nullable(),
  preferredContactChannel: z.string().nullable(),
  hasMessage: z.boolean(),
  patientTimeZone: z.string().nullable(),
  joinOpensAt: z.string(),
  canJoin: z.boolean(),
});
const CoordinatorConsultationDetailSchema = CoordinatorConsultationSchema.extend({ email: z.string().nullable(), phone: z.string().nullable() });

const ListQuerySchema = z.object({ scope: z.enum(["today", "upcoming"]).default("today") });
const IdParamSchema = z.object({ id: z.string().uuid() });

const ROW_SELECT = {
  id: true,
  seq: true,
  startsAt: true,
  endsAt: true,
  status: true,
  serviceName: true,
  needsInterpreter: true,
  interpreterLanguage: true,
  patientTimeZone: true,
  coordinatorId: true,
  meeting: { select: { id: true, status: true, startsAt: true, endsAt: true, roomName: true, maxParticipants: true } },
  request: { select: { fullName: true, email: true, phone: true, country: true, contactLanguage: true, preferredContactChannel: true, messageEncrypted: true } },
} satisfies Prisma.ServiceConsultationSelect;
type Row = Prisma.ServiceConsultationGetPayload<{ select: typeof ROW_SELECT }>;

export interface CoordinatorContext {
  userId: string;
  email: string;
  twoFactorEnabled: boolean;
  profileId: string;
  displayName: string;
}

/**
 * Her istekte TAZE okunan koordinator kapisi: aktif CoordinatorProfile + ACTIVE kullanici + panel rolu + doktor profili YOK.
 * Degilse 403. `hideAsNotFound`: kimligi-bazli uclarda ADMIN profil sahibi degilse 404 (varlik/yetki sizdirilmaz, AG ilkesi).
 */
export async function requireCoordinator(app: FastifyInstance, request: FastifyRequest, opts: { hideAsNotFound?: boolean } = {}): Promise<CoordinatorContext> {
  const user = await app.prisma.user.findUnique({
    where: { id: request.user!.id },
    select: {
      id: true,
      email: true,
      role: true,
      status: true,
      twoFactorEnabled: true,
      doctorProfile: { select: { id: true } },
      coordinatorProfile: { select: { id: true, isActive: true, displayName: true } },
    },
  });
  const ok_ =
    user &&
    user.status === "ACTIVE" &&
    !user.doctorProfile &&
    (ROLES_PANEL as readonly string[]).includes(user.role) &&
    user.coordinatorProfile?.isActive === true;
  if (!ok_) {
    if (opts.hideAsNotFound && user?.role === "ADMIN") throw new NotFoundError("Görüşme bulunamadı.");
    throw new ServiceCoordinatorForbiddenError();
  }
  return { userId: user.id, email: user.email, twoFactorEnabled: user.twoFactorEnabled, profileId: user.coordinatorProfile!.id, displayName: user.coordinatorProfile!.displayName };
}

function canJoinNow(row: Pick<Row, "status" | "startsAt" | "endsAt">, now: Date): boolean {
  return row.status === "SCHEDULED" && now.getTime() >= row.startsAt.getTime() - MEETING_JOIN_LEAD_MS && now.getTime() < row.endsAt.getTime();
}

function toDto(row: Row, now: Date) {
  return {
    id: row.id,
    consultationNumber: formatConsultationNumber(row.seq),
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    status: row.status,
    serviceName: row.serviceName,
    patientName: row.request?.fullName ?? "",
    country: row.request?.country ?? null,
    contactLanguage: row.request?.contactLanguage ?? null,
    needsInterpreter: row.needsInterpreter,
    interpreterLanguage: row.interpreterLanguage,
    preferredContactChannel: row.request?.preferredContactChannel ?? null,
    hasMessage: Boolean(row.request?.messageEncrypted),
    patientTimeZone: row.patientTimeZone,
    joinOpensAt: new Date(row.startsAt.getTime() - MEETING_JOIN_LEAD_MS).toISOString(),
    canJoin: canJoinNow(row, now),
  };
}

async function loadOwn(app: FastifyInstance, id: string, coordinatorId: string): Promise<Row> {
  const row = await app.prisma.serviceConsultation.findFirst({ where: { id, coordinatorId }, select: ROW_SELECT });
  if (!row) throw new NotFoundError("Görüşme bulunamadı.");
  return row;
}

/**
 * `/coordinator` prefix'i altinda baglanir. Paket AI (Is 3) - hasta koordinatoru uclari: yalnizca KENDINE atanmis
 * gorusmeler (baskasinin kaydi ve ADMIN -> 404). Mesaj cozme: hesapta 2FA acik olmali + her goruntuleme audit'e.
 * Katilim: AG ev sahibi `host-token` ile AYNI yanit bicimi; oda adi `Patient Coordinator · <displayName>`.
 */
export async function coordinatorRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>();
  server.addHook("preHandler", authenticate);

  server.get(
    "/consultations",
    { config: { rateLimit: READ_RATE_LIMIT }, schema: { querystring: ListQuerySchema, response: { 200: ApiSuccessSchema(z.array(CoordinatorConsultationSchema)) } } },
    async (request, reply) => {
      const coordinator = await requireCoordinator(app, request);
      const now = new Date();
      let where: Prisma.ServiceConsultationWhereInput;
      if (request.query.scope === "today") {
        const desk = await getOrCreateDesk(app.prisma);
        const today = parseIsoCalendarDate(dateKeyInZone(now, desk.timeZone));
        where = {
          coordinatorId: coordinator.profileId,
          startsAt: { gte: getStartOfCalendarDayInTimeZone(today, desk.timeZone), lt: getStartOfCalendarDayInTimeZone(addCalendarDays(today, 1), desk.timeZone) },
        };
      } else {
        where = { coordinatorId: coordinator.profileId, endsAt: { gt: now } };
      }
      const rows = await app.prisma.serviceConsultation.findMany({ where, select: ROW_SELECT, orderBy: { startsAt: "asc" }, take: 200 });
      reply.header("Cache-Control", "no-store");
      return reply.send(ok(rows.map((r) => toDto(r, now))));
    }
  );

  server.get(
    "/consultations/:id",
    { config: { rateLimit: READ_RATE_LIMIT }, schema: { params: IdParamSchema, response: { 200: ApiSuccessSchema(CoordinatorConsultationDetailSchema) } } },
    async (request, reply) => {
      const coordinator = await requireCoordinator(app, request, { hideAsNotFound: true });
      const row = await loadOwn(app, request.params.id, coordinator.profileId);
      await logAudit(app, {
        actorId: coordinator.userId,
        actorEmail: coordinator.email,
        action: "service_consultation.viewed",
        targetType: "ServiceConsultation",
        targetId: row.id,
        metadata: null,
        ipAddress: request.ip,
      });
      reply.header("Cache-Control", "no-store");
      return reply.send(ok({ ...toDto(row, new Date()), email: row.request?.email ?? null, phone: row.request?.phone ?? null }));
    }
  );

  server.get(
    "/consultations/:id/message",
    { config: { rateLimit: MESSAGE_RATE_LIMIT }, schema: { params: IdParamSchema, response: { 200: ApiSuccessSchema(z.object({ message: z.string().nullable() })) } } },
    async (request, reply) => {
      const coordinator = await requireCoordinator(app, request, { hideAsNotFound: true });
      // 2FA kapiyi GORUNTULEMEDEN once: saglik verisi cozulmeden hesap korumasi sart.
      if (!coordinator.twoFactorEnabled) throw new TwoFactorRequiredError("Talep mesajını görüntülemek için iki adımlı doğrulamayı (2FA) açmanız gerekir.");
      const row = await loadOwn(app, request.params.id, coordinator.profileId);
      let message: string | null = null;
      if (row.request?.messageEncrypted) {
        try {
          message = decryptSecret(row.request.messageEncrypted);
        } catch (err) {
          app.log.error({ err: (err as Error).message, consultationId: row.id }, "Talep mesajı çözülemedi.");
        }
      }
      // Metadata'da kisisel veri/mesaj YOK; yalniz mesajin var olup olmadigi.
      await logAudit(app, {
        actorId: coordinator.userId,
        actorEmail: coordinator.email,
        action: "service_consultation.message_viewed",
        targetType: "ServiceConsultation",
        targetId: row.id,
        metadata: { hadMessage: message !== null },
        ipAddress: request.ip,
      });
      reply.header("Cache-Control", "no-store");
      return reply.send(ok({ message }));
    }
  );

  server.post(
    "/consultations/:id/host-token",
    {
      preHandler: requireModuleEnabled("telehealth"),
      config: { rateLimit: HOST_TOKEN_RATE_LIMIT },
      schema: { params: IdParamSchema, response: { 200: ApiSuccessSchema(MeetingTokenResponseSchema) } },
    },
    async (request, reply) => {
      // Yapilandirilmamisken 503 - toplanti var mi / yetki var mi sorgulanmadan (AG host-token ile ayni sira).
      if (!isLiveKitConfigured()) throw new LiveKitNotConfiguredError();
      const coordinator = await requireCoordinator(app, request, { hideAsNotFound: true });
      const row = await loadOwn(app, request.params.id, coordinator.profileId);
      const now = new Date();
      const meeting = row.meeting;
      if (row.status !== "SCHEDULED") throw new MeetingNotOpenError(row.status === "CANCELLED" ? "cancelled" : "ended");
      const phase = computePhase(meeting, now);
      if (phase === "cancelled") throw new MeetingNotOpenError("cancelled");
      if (phase === "ended") throw new MeetingNotOpenError("ended");
      if (phase === "upcoming") throw new MeetingNotOpenError("not_yet_open", meetingOpensAt(meeting));

      try {
        await ensureMeetingRoom(meeting.roomName, meeting.maxParticipants);
      } catch (err) {
        app.log.warn({ err, consultationId: row.id }, "Toplantı odası önceden yapılandırılamadı (best-effort) — katılım engellenmedi.");
      }
      const token = await createMeetingHostToken({
        roomName: meeting.roomName,
        userId: coordinator.userId,
        displayName: serviceCoordinatorLabel(coordinator.displayName),
        endsAt: meeting.endsAt,
      });
      await app.prisma.externalMeeting.updateMany({ where: { id: meeting.id, hostJoinedAt: null }, data: { hostJoinedAt: now } });
      await logAudit(app, {
        actorId: coordinator.userId,
        actorEmail: coordinator.email,
        action: "service_consultation.host_token.issued",
        targetType: "ServiceConsultation",
        targetId: row.id,
        metadata: null,
        ipAddress: request.ip,
      });
      return reply.send(ok({ token: token.token, serverUrl: token.serverUrl, roomName: token.roomName, expiresAt: token.expiresAt }));
    }
  );
}
