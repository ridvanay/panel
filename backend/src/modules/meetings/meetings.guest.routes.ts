import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { requireModuleEnabled } from "../../middleware/module-guard";
import { ok } from "../../lib/envelope";
import { ApiSuccessSchema } from "../../schemas/common";
import { LiveKitNotConfiguredError, MeetingFullError, MeetingLinkInvalidError, MeetingNotOpenError, ValidationError } from "../../lib/errors";
import { hashToken } from "../../lib/tokens";
import { logAudit } from "../../lib/audit";
import { isLiveKitConfigured } from "../telehealth/lib/livekit";
import {
  MEETING_GUEST_IDENTITY_PREFIX,
  MEETING_HOST_IDENTITY_PREFIX,
  buildMeetingGuestIdentity,
  createMeetingGuestToken,
  ensureMeetingRoom,
  listMeetingParticipants,
} from "../telehealth/lib/meeting-livekit";
import { GUEST_TOKEN_REGEX, issueGuestSession, verifyGuestSession, verifyGuestToken } from "./meeting-tokens";
import { normalizeGuestName } from "./meeting-guest-name";
import { GuestJoinRequestSchema, GuestJoinResponseSchema, GuestPreflightRequestSchema, GuestPreflightResponseSchema } from "./meetings.schemas";
import { MAX_GUEST_SESSIONS_PER_MEETING, hostDisplayName, meetingOpensAt } from "./meetings.service";

const POLL_AFTER_SEC = 5;

/**
 * `/meet/guest` prefix'i altında bağlanır. Paket AG (İş 3) — herkese açık misafir uçları (oturum YOK). Erişim
 * YALNIZCA geçerli `mg_…` belirteciyle. Belirteç yalnızca POST gövdesinde gelir (URL/query'de değil). Bu uçlar
 * TARAYICIDAN çağrılmalıdır: SSR'den çağrılırsa tüm misafirler iç istemci kovasını paylaşır ve IP sınırı devre dışı kalır.
 *
 * Bilgi sızıntısı yok: geçersiz biçim, bilinmeyen / yenilenmiş / iptal edilmiş belirteç, iptal edilmiş veya bitmiş
 * toplantı, kurcalanmış / başka toplantıya ait / süresi dolmuş oturum ve çıkarılmış misafir HEP AYNI 404
 * (`MEETING_LINK_INVALID`, sabit mesaj). Audit'e misafir adı ve IP YAZILMAZ (yalnızca meetingId + guestId).
 */
export async function meetingsGuestRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>();

  // 404 dahil tüm yanıtlarda önbellek yok + arama motoru dizinlemesi yok.
  server.addHook("onRequest", async (_request, reply) => {
    reply.header("Cache-Control", "no-store");
    reply.header("X-Robots-Tag", "noindex, nofollow");
  });
  server.addHook("preHandler", requireModuleEnabled("telehealth"));

  /** Belirteçten geçerli (iptal edilmemiş, bitmemiş, ev sahibi aktif) toplantıyı çözer; aksi hâlde TEK tip 404. */
  async function resolveMeeting(rawToken: string) {
    if (!GUEST_TOKEN_REGEX.test(rawToken)) throw new MeetingLinkInvalidError();
    const meeting = await app.prisma.externalMeeting.findUnique({
      where: { guestTokenHash: hashToken(rawToken) },
      include: {
        host: {
          select: {
            name: true,
            status: true,
            doctorProfile: { select: { fullName: true, publicName: true, isFounder: true } },
          },
        },
      },
    });
    // Bulunan kayıtta ayrıca sabit zamanlı özet doğrulaması; bulunamayınca sahte karşılaştırma (süre dengesi).
    const valid = verifyGuestToken(rawToken, meeting?.guestTokenHash ?? null);
    if (!meeting || !valid || meeting.status !== "SCHEDULED" || Date.now() >= meeting.endsAt.getTime() || meeting.host.status !== "ACTIVE") {
      throw new MeetingLinkInvalidError();
    }
    return meeting;
  }

  server.post(
    "/preflight",
    {
      config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
      schema: { body: GuestPreflightRequestSchema, response: { 200: ApiSuccessSchema(GuestPreflightResponseSchema) } },
    },
    async (request, reply) => {
      const meeting = await resolveMeeting(request.body.t);
      return reply.send(
        ok({
          title: meeting.title,
          hostName: hostDisplayName(meeting.host),
          startsAt: meeting.startsAt.toISOString(),
          endsAt: meeting.endsAt.toISOString(),
          phase: Date.now() < meetingOpensAt(meeting).getTime() ? ("upcoming" as const) : ("open" as const),
        })
      );
    }
  );

  server.post(
    "/join",
    {
      // Yoklama 5 sn = 12/dk; yeniden bağlanma payı.
      config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
      schema: { body: GuestJoinRequestSchema, response: { 200: ApiSuccessSchema(GuestJoinResponseSchema) } },
    },
    async (request, reply) => {
      const { t, name, guestSession } = request.body;

      // 1) belirteç → toplantı (aksi hâlde aynı 404)
      const meeting = await resolveMeeting(t);

      // 2) LiveKit yapılandırması YALNIZCA geçerli belirteç sahibine bildirilir
      if (!isLiveKitConfigured()) throw new LiveKitNotConfiguredError();

      // 3) pencere: başlangıçtan 15 dk önce açılır
      const now = new Date();
      const opensAt = meetingOpensAt(meeting);
      if (now.getTime() < opensAt.getTime()) throw new MeetingNotOpenError("not_yet_open", opensAt, "The meeting is not open yet.");

      // 4) misafir oturumu
      let guestId: string;
      let displayName: string;
      let session: string;
      if (guestSession) {
        const verified = verifyGuestSession(guestSession, meeting.id);
        if (!verified) throw new MeetingLinkInvalidError();
        const guest = await app.prisma.externalMeetingGuest.findFirst({ where: { id: verified.guestId, meetingId: meeting.id } });
        if (!guest || guest.removedAt) throw new MeetingLinkInvalidError();
        await app.prisma.externalMeetingGuest.update({ where: { id: guest.id }, data: { lastSeenAt: now }, select: { id: true } });
        guestId = guest.id;
        displayName = guest.displayName;
        session = guestSession;
      } else {
        if (name === undefined) throw new ValidationError("Name is required.", { name: ["Name is required."] });
        const normalized = normalizeGuestName(name);
        if (!normalized.ok) throw new ValidationError(normalized.reason, { name: [normalized.reason] });
        const sessions = await app.prisma.externalMeetingGuest.count({ where: { meetingId: meeting.id } });
        if (sessions >= MAX_GUEST_SESSIONS_PER_MEETING) throw new MeetingFullError("The meeting is full.");
        const created = await app.prisma.externalMeetingGuest.create({
          data: { meetingId: meeting.id, displayName: normalized.name, lastSeenAt: now },
          select: { id: true },
        });
        guestId = created.id;
        displayName = normalized.name;
        session = issueGuestSession(guestId, meeting.id, meeting.endsAt);
      }

      // 5) bekleme kapısı: ev sahibi odada değilse (ve doğrudan alma kapalıysa) token VERİLMEZ
      let present: string[] | null = null;
      let listFailed = false;
      try {
        present = await listMeetingParticipants(meeting.roomName);
      } catch (err) {
        listFailed = true;
        app.log.warn({ err, meetingId: meeting.id }, "Toplantı katılımcı listesi okunamadı.");
      }
      // Server API yok (`null`) → ev sahibi token'ı almış mı (yedek); okuma hatası → güvenli tarafta kal: bekle.
      const hostPresent = listFailed ? false : present === null ? meeting.hostJoinedAt !== null : present.some((id) => id.startsWith(MEETING_HOST_IDENTITY_PREFIX));
      if (!meeting.autoAdmitGuests && !hostPresent) {
        return reply.send(ok({ status: "waiting" as const, guestSession: session, pollAfterSec: POLL_AFTER_SEC }));
      }

      // 6) kapasite: ev sahibi DAHİL toplam. Ev sahibi koltuğu her zaman ayrılır (doğrudan alma açıkken ev sahibi
      // henüz gelmemiş olsa da misafirler son koltuğu dolduramaz).
      if (present !== null) {
        const ownIdentity = buildMeetingGuestIdentity(guestId);
        const guestsInRoom = present.filter((id) => id.startsWith(MEETING_GUEST_IDENTITY_PREFIX) && id !== ownIdentity).length;
        if (guestsInRoom >= meeting.maxParticipants - 1) throw new MeetingFullError("The meeting is full.");
      }

      // 7) token
      try {
        await ensureMeetingRoom(meeting.roomName, meeting.maxParticipants);
      } catch (err) {
        app.log.warn({ err, meetingId: meeting.id }, "Toplantı odası önceden yapılandırılamadı (best-effort) — katılım engellenmedi.");
      }
      const token = await createMeetingGuestToken({ roomName: meeting.roomName, guestId, displayName, endsAt: meeting.endsAt });
      const firstAdmit = await app.prisma.externalMeetingGuest.updateMany({ where: { id: guestId, admittedAt: null }, data: { admittedAt: now } });
      if (firstAdmit.count > 0) {
        await logAudit(app, {
          actorId: null,
          actorEmail: null,
          action: "meeting.guest.joined",
          targetType: "ExternalMeeting",
          targetId: meeting.id,
          metadata: { guestId },
          ipAddress: null,
        });
      }
      return reply.send(
        ok({ status: "ready" as const, guestSession: session, token: token.token, serverUrl: token.serverUrl, roomName: token.roomName, expiresAt: token.expiresAt })
      );
    }
  );
}
