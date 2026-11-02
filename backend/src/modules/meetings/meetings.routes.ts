import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { requireModuleEnabled } from "../../middleware/module-guard";
import { authenticate } from "../../middleware/authenticate";
import { ok } from "../../lib/envelope";
import { ApiSuccessSchema, ApiSuccessWithMeta } from "../../schemas/common";
import { canHostMeetings } from "../../lib/meeting-host";
import {
  ConflictError,
  LiveKitNotConfiguredError,
  MeetingLimitReachedError,
  MeetingNotEditableError,
  MeetingNotFoundError,
  MeetingNotOpenError,
  ValidationError,
} from "../../lib/errors";
import { logAudit } from "../../lib/audit";
import { runSerializable } from "../../lib/serializable-tx";
import { sendBrandedMail } from "../../lib/branded-mail";
import { toBrandLocale } from "../../lib/branded-email";
import { isLiveKitConfigured } from "../telehealth/lib/livekit";
import {
  buildMeetingGuestIdentity,
  createMeetingHostToken,
  ensureMeetingRoom,
  generateMeetingRoomName,
  listMeetingParticipants,
  removeMeetingParticipant,
} from "../telehealth/lib/meeting-livekit";
import { buildMeetingInviteEmail } from "../telehealth/lib/meeting-invite-email";
import { buildGuestLink, extractGuestToken, generateGuestToken, verifyGuestToken } from "./meeting-tokens";
import {
  CreateMeetingRequestSchema,
  GuestLinkRequestSchema,
  HostStatusSchema,
  InviteEmailRequestSchema,
  ListMeetingsQuerySchema,
  MeetingGuestListItemSchema,
  MeetingGuestParamSchema,
  MeetingIdParamSchema,
  MeetingSchema,
  MeetingTokenResponseSchema,
  UpdateMeetingRequestSchema,
} from "./meetings.schemas";
import {
  MAX_FUTURE_MEETINGS_PER_HOST,
  MAX_INVITE_EMAILS_PER_MEETING,
  START_MAX_AHEAD_MS,
  START_PAST_TOLERANCE_MS,
  buildMeetingListQuery,
  cancelMeeting,
  computePhase,
  encodeMeetingCursor,
  loadOwnMeeting,
  meetingOpensAt,
  requireMeetingHost,
  toMeetingDto,
} from "./meetings.service";

/** Bekleme yoklaması bu süreden eski görülmüşse misafir artık "bekleyen" sayılmaz (sekme kapanmış). */
const WAITING_FRESH_MS = 30_000;

const HostMetaSchema = z.object({ nextCursor: z.string().nullable(), host: z.object({ twoFactorEnabled: z.boolean() }) });

function assertStartsAtInRange(startsAt: Date, now: Date): void {
  if (startsAt.getTime() < now.getTime() - START_PAST_TOLERANCE_MS) {
    throw new ValidationError("Başlangıç zamanı geçmişte olamaz.", { startsAt: ["Başlangıç zamanı geçmişte olamaz."] });
  }
  if (startsAt.getTime() > now.getTime() + START_MAX_AHEAD_MS) {
    throw new ValidationError("Başlangıç zamanı en çok 180 gün sonrası olabilir.", { startsAt: ["En çok 180 gün sonrası seçilebilir."] });
  }
}

/**
 * `/meetings` prefix'i altında bağlanır. Paket AG (İş 3) — harici görüntülü toplantı, ev sahibi uçları.
 * Randevu/consultation akışından TAMAMEN bağımsızdır. Yetki her istekte taze DB'den okunur (`requireMeetingHost`);
 * 2FA istenmez (S2) — durum `twoFactorEnabled` olarak döner. Başkasının toplantısı (ADMIN dahil) → 404.
 */
export async function meetingsRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>();
  server.addHook("preHandler", requireModuleEnabled("telehealth"));
  server.addHook("preHandler", authenticate);

  server.get(
    "/host-status",
    { schema: { response: { 200: ApiSuccessSchema(HostStatusSchema) } } },
    async (request, reply) => {
      const user = await app.prisma.user.findUnique({
        where: { id: request.user!.id },
        select: { role: true, twoFactorEnabled: true, meetingHostGrantedAt: true, doctorProfile: { select: { id: true } } },
      });
      return reply.send(ok({ canHostMeetings: user ? canHostMeetings(user) : false, twoFactorEnabled: user?.twoFactorEnabled ?? false }));
    }
  );

  server.get(
    "/",
    { schema: { querystring: ListMeetingsQuerySchema, response: { 200: ApiSuccessWithMeta(z.array(MeetingSchema), HostMetaSchema) } } },
    async (request, reply) => {
      const host = await requireMeetingHost(app, request.user!.id);
      const { scope, cursor, limit } = request.query;
      const now = new Date();
      const query = buildMeetingListQuery(scope, cursor, now);
      const rows = await app.prisma.externalMeeting.findMany({
        where: { AND: [{ hostUserId: host.id }, query.where] },
        orderBy: query.orderBy,
        take: limit + 1,
      });
      const page = rows.slice(0, limit);
      const nextCursor = rows.length > limit ? encodeMeetingCursor(page[page.length - 1]!) : null;
      return reply.send(ok(page.map((m) => toMeetingDto(m, now)), { nextCursor, host: { twoFactorEnabled: host.twoFactorEnabled } }));
    }
  );

  server.post(
    "/",
    {
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
      schema: {
        body: CreateMeetingRequestSchema,
        response: { 201: ApiSuccessSchema(z.object({ meeting: MeetingSchema, guestLink: z.string(), host: z.object({ twoFactorEnabled: z.boolean() }) })) },
      },
    },
    async (request, reply) => {
      const host = await requireMeetingHost(app, request.user!.id);
      const body = request.body;
      const now = new Date();
      assertStartsAtInRange(body.startsAt, now);

      const { token, hash } = generateGuestToken();
      const meeting = await runSerializable(app, async (tx) => {
        const upcoming = await tx.externalMeeting.count({ where: { hostUserId: host.id, status: "SCHEDULED", endsAt: { gt: now } } });
        if (upcoming >= MAX_FUTURE_MEETINGS_PER_HOST) {
          throw new MeetingLimitReachedError(`En çok ${MAX_FUTURE_MEETINGS_PER_HOST} gelecek toplantınız olabilir.`);
        }
        return tx.externalMeeting.create({
          data: {
            hostUserId: host.id,
            title: body.title,
            note: body.note ? body.note : null,
            startsAt: body.startsAt,
            endsAt: new Date(body.startsAt.getTime() + body.durationMin * 60_000),
            durationMin: body.durationMin,
            maxParticipants: body.maxParticipants,
            autoAdmitGuests: body.autoAdmitGuests,
            roomName: generateMeetingRoomName(),
            guestTokenHash: hash,
            guestTokenCreatedAt: now,
          },
        });
      });

      await logAudit(app, {
        actorId: host.id,
        actorEmail: host.email,
        action: "meeting.created",
        targetType: "ExternalMeeting",
        targetId: meeting.id,
        metadata: { durationMin: meeting.durationMin, maxParticipants: meeting.maxParticipants, autoAdmitGuests: meeting.autoAdmitGuests },
        ipAddress: request.ip,
      });
      await logAudit(app, {
        actorId: host.id,
        actorEmail: host.email,
        action: "meeting.guest_link.created",
        targetType: "ExternalMeeting",
        targetId: meeting.id,
        metadata: { regenerated: false },
        ipAddress: request.ip,
      });

      return reply
        .code(201)
        .send(ok({ meeting: toMeetingDto(meeting, now), guestLink: buildGuestLink(token, body.locale), host: { twoFactorEnabled: host.twoFactorEnabled } }));
    }
  );

  server.get(
    "/:id",
    { schema: { params: MeetingIdParamSchema, response: { 200: ApiSuccessSchema(MeetingSchema) } } },
    async (request, reply) => {
      const host = await requireMeetingHost(app, request.user!.id);
      const meeting = await loadOwnMeeting(app, request.params.id, host.id);
      return reply.send(ok(toMeetingDto(meeting)));
    }
  );

  server.patch(
    "/:id",
    { schema: { params: MeetingIdParamSchema, body: UpdateMeetingRequestSchema, response: { 200: ApiSuccessSchema(MeetingSchema) } } },
    async (request, reply) => {
      const host = await requireMeetingHost(app, request.user!.id);
      const meeting = await loadOwnMeeting(app, request.params.id, host.id);
      const now = new Date();
      const phase = computePhase(meeting, now);
      if (phase === "cancelled" || phase === "ended") throw new MeetingNotEditableError();

      const body = request.body;
      const touchesSchedule = body.startsAt !== undefined || body.durationMin !== undefined;
      // Zaman alanları yalnızca toplantı başlamadan; katılımcı sınırı yalnızca oda açılmadan (maxParticipants oda
      // ilk oluşturulurken uygulanır) değiştirilebilir. Başlık / not / otomatik kabul her zaman.
      if (touchesSchedule && now.getTime() >= meeting.startsAt.getTime()) {
        throw new MeetingNotEditableError("Başlamış bir toplantının zamanı değiştirilemez.");
      }
      if (body.maxParticipants !== undefined && now.getTime() >= meetingOpensAt(meeting).getTime()) {
        throw new MeetingNotEditableError("Oda açıldıktan sonra katılımcı sınırı değiştirilemez.");
      }
      if (body.startsAt !== undefined) assertStartsAtInRange(body.startsAt, now);

      const startsAt = body.startsAt ?? meeting.startsAt;
      const durationMin = body.durationMin ?? meeting.durationMin;
      const updated = await app.prisma.externalMeeting.update({
        where: { id: meeting.id },
        data: {
          ...(body.title !== undefined ? { title: body.title } : {}),
          ...(body.note !== undefined ? { note: body.note ? body.note : null } : {}),
          ...(body.maxParticipants !== undefined ? { maxParticipants: body.maxParticipants } : {}),
          ...(body.autoAdmitGuests !== undefined ? { autoAdmitGuests: body.autoAdmitGuests } : {}),
          ...(touchesSchedule ? { startsAt, durationMin, endsAt: new Date(startsAt.getTime() + durationMin * 60_000) } : {}),
        },
      });

      await logAudit(app, {
        actorId: host.id,
        actorEmail: host.email,
        action: "meeting.updated",
        targetType: "ExternalMeeting",
        targetId: meeting.id,
        metadata: { fields: Object.keys(body) },
        ipAddress: request.ip,
      });
      return reply.send(ok(toMeetingDto(updated, now)));
    }
  );

  server.post(
    "/:id/guest-link",
    {
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
      schema: { params: MeetingIdParamSchema, body: GuestLinkRequestSchema, response: { 200: ApiSuccessSchema(z.object({ guestLink: z.string() })) } },
    },
    async (request, reply) => {
      const host = await requireMeetingHost(app, request.user!.id);
      const meeting = await loadOwnMeeting(app, request.params.id, host.id);
      const phase = computePhase(meeting);
      if (phase === "cancelled" || phase === "ended") throw new MeetingNotEditableError();

      // Yeni özet eskisinin üzerine yazılır: eski bağlantı anında geçersiz.
      const { token, hash } = generateGuestToken();
      await app.prisma.externalMeeting.update({ where: { id: meeting.id }, data: { guestTokenHash: hash, guestTokenCreatedAt: new Date() }, select: { id: true } });
      await logAudit(app, {
        actorId: host.id,
        actorEmail: host.email,
        action: "meeting.guest_link.created",
        targetType: "ExternalMeeting",
        targetId: meeting.id,
        metadata: { regenerated: true },
        ipAddress: request.ip,
      });
      return reply.send(ok({ guestLink: buildGuestLink(token, request.body.locale) }));
    }
  );

  server.delete(
    "/:id/guest-link",
    { schema: { params: MeetingIdParamSchema, response: { 204: z.undefined() } } },
    async (request, reply) => {
      const host = await requireMeetingHost(app, request.user!.id);
      const meeting = await loadOwnMeeting(app, request.params.id, host.id);
      await app.prisma.externalMeeting.update({ where: { id: meeting.id }, data: { guestTokenHash: null, guestTokenCreatedAt: null }, select: { id: true } });
      await logAudit(app, {
        actorId: host.id,
        actorEmail: host.email,
        action: "meeting.guest_link.revoked",
        targetType: "ExternalMeeting",
        targetId: meeting.id,
        metadata: null,
        ipAddress: request.ip,
      });
      return reply.code(204).send();
    }
  );

  server.post(
    "/:id/cancel",
    { schema: { params: MeetingIdParamSchema, response: { 200: ApiSuccessSchema(MeetingSchema) } } },
    async (request, reply) => {
      const host = await requireMeetingHost(app, request.user!.id);
      const meeting = await loadOwnMeeting(app, request.params.id, host.id);
      if (meeting.status !== "CANCELLED" && computePhase(meeting) === "ended") throw new MeetingNotEditableError("Biten bir toplantı iptal edilemez.");
      const updated = await cancelMeeting(app, meeting, { actorId: host.id, actorEmail: host.email, ipAddress: request.ip, source: "host" });
      return reply.send(ok(toMeetingDto(updated)));
    }
  );

  server.post(
    "/:id/host-token",
    {
      // meeting-token ile aynı sınır: 10 istek/dk.
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
      schema: { params: MeetingIdParamSchema, response: { 200: ApiSuccessSchema(MeetingTokenResponseSchema) } },
    },
    async (request, reply) => {
      // Yapılandırılmamışken 503 — toplantı var mı / yetki var mı sorgulanmadan (meeting-token ile aynı sıra).
      if (!isLiveKitConfigured()) throw new LiveKitNotConfiguredError();

      const host = await requireMeetingHost(app, request.user!.id);
      const meeting = await loadOwnMeeting(app, request.params.id, host.id);
      const now = new Date();
      const phase = computePhase(meeting, now);
      if (phase === "cancelled") throw new MeetingNotOpenError("cancelled");
      if (phase === "ended") throw new MeetingNotOpenError("ended");
      if (phase === "upcoming") throw new MeetingNotOpenError("not_yet_open", meetingOpensAt(meeting));

      try {
        await ensureMeetingRoom(meeting.roomName, meeting.maxParticipants);
      } catch (err) {
        app.log.warn({ err, meetingId: meeting.id }, "Toplantı odası önceden yapılandırılamadı (best-effort) — katılım engellenmedi.");
      }

      const token = await createMeetingHostToken({ roomName: meeting.roomName, userId: host.id, displayName: host.displayName, endsAt: meeting.endsAt });
      await app.prisma.externalMeeting.updateMany({ where: { id: meeting.id, hostJoinedAt: null }, data: { hostJoinedAt: now } });

      await logAudit(app, {
        actorId: host.id,
        actorEmail: host.email,
        action: "meeting.host_token.issued",
        targetType: "ExternalMeeting",
        targetId: meeting.id,
        metadata: null,
        ipAddress: request.ip,
      });
      return reply.send(ok({ token: token.token, serverUrl: token.serverUrl, roomName: token.roomName, expiresAt: token.expiresAt }));
    }
  );

  server.get(
    "/:id/guests",
    {
      // 5 sn yoklama = 12/dk; ev sahibi birden çok sekme için pay.
      config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
      schema: { params: MeetingIdParamSchema, response: { 200: ApiSuccessSchema(z.array(MeetingGuestListItemSchema)) } },
    },
    async (request, reply) => {
      const host = await requireMeetingHost(app, request.user!.id);
      const meeting = await loadOwnMeeting(app, request.params.id, host.id);
      const guests = await app.prisma.externalMeetingGuest.findMany({ where: { meetingId: meeting.id }, orderBy: { createdAt: "asc" }, take: 100 });

      let present: string[] | null = null;
      try {
        present = await listMeetingParticipants(meeting.roomName);
      } catch (err) {
        app.log.warn({ err, meetingId: meeting.id }, "Toplantı katılımcı listesi okunamadı; inRoom bilinmiyor.");
      }
      const now = Date.now();
      return reply.send(
        ok(
          guests.map((g) => ({
            id: g.id,
            displayName: g.displayName,
            createdAt: g.createdAt.toISOString(),
            admittedAt: g.admittedAt ? g.admittedAt.toISOString() : null,
            removedAt: g.removedAt ? g.removedAt.toISOString() : null,
            waiting: g.admittedAt === null && g.removedAt === null && g.lastSeenAt !== null && now - g.lastSeenAt.getTime() <= WAITING_FRESH_MS,
            inRoom: present === null ? null : present.includes(buildMeetingGuestIdentity(g.id)),
          }))
        )
      );
    }
  );

  server.post(
    "/:id/guests/:guestId/remove",
    { schema: { params: MeetingGuestParamSchema, response: { 204: z.undefined() } } },
    async (request, reply) => {
      const host = await requireMeetingHost(app, request.user!.id);
      const meeting = await loadOwnMeeting(app, request.params.id, host.id);
      const guest = await app.prisma.externalMeetingGuest.findFirst({ where: { id: request.params.guestId, meetingId: meeting.id }, select: { id: true, removedAt: true } });
      if (!guest) throw new MeetingNotFoundError();

      if (!guest.removedAt) {
        await app.prisma.externalMeetingGuest.update({ where: { id: guest.id }, data: { removedAt: new Date() }, select: { id: true } });
      }
      // Anında at (best-effort); eski token'la dönerse süpürücü tekrar atar, katılım uçları zaten token vermez.
      try {
        const present = await listMeetingParticipants(meeting.roomName);
        const identity = buildMeetingGuestIdentity(guest.id);
        if (present?.includes(identity)) await removeMeetingParticipant(meeting.roomName, identity);
      } catch (err) {
        app.log.warn({ err, meetingId: meeting.id }, "Misafir odadan hemen atılamadı; süpürücü tekrar deneyecek.");
      }
      await logAudit(app, {
        actorId: host.id,
        actorEmail: host.email,
        action: "meeting.guest.removed",
        targetType: "ExternalMeeting",
        targetId: meeting.id,
        metadata: { guestId: guest.id },
        ipAddress: request.ip,
      });
      return reply.code(204).send();
    }
  );

  server.post(
    "/:id/invite-email",
    {
      // E-posta spam rölesi olmasın: 5/dk + toplantı başına en çok 10.
      config: { rateLimit: { max: 5, timeWindow: "1 minute" } },
      schema: { params: MeetingIdParamSchema, body: InviteEmailRequestSchema, response: { 202: ApiSuccessSchema(z.object({ sent: z.boolean() })) } },
    },
    async (request, reply) => {
      const host = await requireMeetingHost(app, request.user!.id);
      const meeting = await loadOwnMeeting(app, request.params.id, host.id);
      const phase = computePhase(meeting);
      if (phase === "cancelled" || phase === "ended") throw new MeetingNotEditableError();

      // Düz belirteç SAKLANMAZ: istemci, oluşturma/yeniden üretme yanıtındaki bağlantıyı bu istekte geri gönderir;
      // özeti mevcut özetle eşleşmiyorsa (yenilenmiş / iptal edilmiş) gönderilmez. Bağlantı sunucuda yeniden kurulur
      // (istemcinin verdiği URL e-postaya konmaz).
      const token = extractGuestToken(request.body.guestLink);
      if (!token) throw new ValidationError("Geçersiz misafir bağlantısı.", { guestLink: ["Geçersiz misafir bağlantısı."] });
      if (!verifyGuestToken(token, meeting.guestTokenHash)) {
        throw new ConflictError("Bu bağlantı artık geçerli değil (yenilenmiş veya iptal edilmiş). Güncel bağlantıyı kullanın.");
      }

      const reserved = await app.prisma.externalMeeting.updateMany({
        where: { id: meeting.id, inviteCount: { lt: MAX_INVITE_EMAILS_PER_MEETING } },
        data: { inviteCount: { increment: 1 } },
      });
      if (reserved.count === 0) throw new MeetingLimitReachedError(`Bir toplantı için en çok ${MAX_INVITE_EMAILS_PER_MEETING} e-posta daveti gönderilebilir.`);

      const mail = buildMeetingInviteEmail({
        locale: request.body.locale,
        title: meeting.title,
        hostName: host.displayName,
        startsAt: meeting.startsAt,
        endsAt: meeting.endsAt,
        joinUrl: buildGuestLink(token, request.body.locale),
      });
      let sent = false;
      try {
        await sendBrandedMail(app, {
          to: request.body.email,
          subject: mail.subject,
          preheader: mail.subject,
          bodyHtml: mail.bodyHtml,
          cta: mail.cta,
          afterCtaHtml: mail.afterCtaHtml,
          locale: toBrandLocale(request.body.locale),
          audience: "user",
        });
        sent = true;
      } catch (err) {
        // Alıcı adresi saklanmaz / audit'e yazılmaz; yalnızca sonuç loglanır.
        app.log.warn({ err: (err as Error).message, meetingId: meeting.id }, "Toplantı daveti e-postası gönderilemedi.");
      }
      if (sent) {
        await logAudit(app, {
          actorId: host.id,
          actorEmail: host.email,
          action: "meeting.invite.sent",
          targetType: "ExternalMeeting",
          targetId: meeting.id,
          metadata: { count: 1 },
          ipAddress: request.ip,
        });
      }
      return reply.code(202).send(ok({ sent }));
    }
  );
}
