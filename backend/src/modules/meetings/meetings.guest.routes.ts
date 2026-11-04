import type { FastifyInstance, FastifyReply } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { requireModuleEnabled } from "../../middleware/module-guard";
import { ok } from "../../lib/envelope";
import { ApiSuccessSchema } from "../../schemas/common";
import { LiveKitNotConfiguredError, MeetingFullError, MeetingLinkInvalidError, MeetingNotOpenError, ValidationError } from "../../lib/errors";
import crypto from "node:crypto";
import { hashToken } from "../../lib/tokens";
import { canHostMeetings } from "../../lib/meeting-host";
import { MemoryRateLimiter } from "../../lib/memory-rate-limit";
import { ipRateKey } from "../service-consultations/service-ip";
import { logAudit } from "../../lib/audit";
import { isLiveKitConfigured } from "../telehealth/lib/livekit";
import {
  MEETING_GUEST_IDENTITY_PREFIX,
  MEETING_HOST_IDENTITY_PREFIX,
  buildMeetingGuestIdentity,
  createMeetingGuestToken,
  ensureMeetingRoom,
  listMeetingCountedIdentities,
  listMeetingParticipants,
} from "../telehealth/lib/meeting-livekit";
import { GUEST_TOKEN_REGEX, issueGuestSession, verifyGuestSession, verifyGuestToken } from "./meeting-tokens";
import { normalizeGuestName } from "./meeting-guest-name";
import { GuestJoinRequestSchema, GuestJoinResponseSchema, GuestPreflightRequestSchema, GuestPreflightResponseSchema } from "./meetings.schemas";
import { MAX_GUEST_SESSIONS_PER_MEETING, hostDisplayName, meetingOpensAt, serviceCoordinatorLabel } from "./meetings.service";

const POLL_AFTER_SEC = 5;
/** Misafir oturumu sayımı yalnızca bu pencerede oluşturulanları sayar (bot doldurma tavanı süresiz kilitlemesin). */
const GUEST_SESSION_WINDOW_MS = 24 * 60 * 60_000;
/** IP başına toplantı başına en çok bu kadar YENİ misafir oturumu (24 sa). IP saklanmaz: bellek içi, anahtar özetlenir. */
const MIN_SESSIONS_PER_IP_PER_MEETING = 20;
/** Paket AM: aynı ofis ağından (tek IP) ev sahibi dahil `maxParticipants` kişi + yenilemeler girebilmeli: max(20, maxParticipants × 4). */
export function sessionsPerIpPerMeeting(maxParticipants: number): number {
  return Math.max(MIN_SESSIONS_PER_IP_PER_MEETING, maxParticipants * 4);
}
export const guestSessionIpLimiter = new MemoryRateLimiter(MIN_SESSIONS_PER_IP_PER_MEETING, GUEST_SESSION_WINDOW_MS);

/**
 * Paket AM — oran sınırları (bellek içi; anahtarlar sha256, ham IP saklanmaz). Bu uçlar genel `RATE_LIMIT_MAX` kovasından
 * muaftır (`config.rateLimit: false`): kendi sınırları aşağıdadır, bekleme yoklaması genel kovayı tüketmez.
 *  - INVALID: geçersiz belirteç / oturum denemeleri için IP başına AYRI kova (kaba kuvvet koruması; anahtar parçalama ile aşılamaz).
 *  - JOIN: IP + toplantı + misafir oturumu (oturum yoksa IP + toplantı) başına.
 *  - PREFLIGHT: IP + toplantı başına.
 */
export const GUEST_INVALID_TOKEN_MAX_PER_MIN = 30;
export const GUEST_JOIN_MAX_PER_MIN = 30;
export const GUEST_PREFLIGHT_MAX_PER_MIN = 60;
const RATE_WINDOW_MS = 60_000;
export const guestInvalidTokenLimiter = new MemoryRateLimiter(GUEST_INVALID_TOKEN_MAX_PER_MIN, RATE_WINDOW_MS);
export const guestJoinLimiter = new MemoryRateLimiter(GUEST_JOIN_MAX_PER_MIN, RATE_WINDOW_MS);
export const guestPreflightLimiter = new MemoryRateLimiter(GUEST_PREFLIGHT_MAX_PER_MIN, RATE_WINDOW_MS);

const sha = (...parts: string[]) => crypto.createHash("sha256").update(parts.join("|")).digest("hex");

/** 429 + `Retry-After` (saniye); gövde proje zarfı (error-handler 429 dalı). */
function throwRateLimited(reply: FastifyReply, retryAfterMs: number): never {
  const retryAfterSeconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
  reply.header("Retry-After", String(retryAfterSeconds));
  throw Object.assign(new Error(`Çok fazla istek. ${retryAfterSeconds} saniye sonra tekrar deneyin.`), { statusCode: 429, retryAfterSeconds });
}

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
            role: true,
            meetingHostGrantedAt: true,
            doctorProfile: { select: { id: true, fullName: true, publicName: true, isFounder: true } },
          },
        },
        // AI İş 3: hizmet görüşmesine bağlıysa ev sahibi adı "Patient Coordinator · <displayName>" olur.
        serviceConsultation: { select: { coordinator: { select: { displayName: true, isActive: true } } } },
      },
    });
    // Bulunan kayıtta ayrıca sabit zamanlı özet doğrulaması; bulunamayınca sahte karşılaştırma (süre dengesi).
    const valid = verifyGuestToken(rawToken, meeting?.guestTokenHash ?? null);
    if (!meeting || !valid || meeting.status !== "SCHEDULED" || Date.now() >= meeting.endsAt.getTime() || meeting.host.status !== "ACTIVE") {
      throw new MeetingLinkInvalidError();
    }
    // Ev sahibinin YETKİSİ de aranır (geri alınmış / rolü düşmüş ev sahibinin bağlantısı çalışmaz; tek tip 404).
    // Hizmet görüşmesinde kural AI İş 3 koordinatör uygunluğudur: EDITOR/MANAGER + aktif CoordinatorProfile + doktor profili yok.
    const host = meeting.host;
    const hostStillAllowed = meeting.serviceConsultation
      ? (host.role === "EDITOR" || host.role === "MANAGER") && !host.doctorProfile && meeting.serviceConsultation.coordinator.isActive
      : canHostMeetings(host);
    if (!hostStillAllowed) throw new MeetingLinkInvalidError();
    return meeting;
  }

  /**
   * ATOMİK geçersiz-deneme kovası: yer ÖNCEDEN ayrılır (tryConsume, DB'den önce, eşzamanlı N istekte sınır aşılmaz).
   * Kova doluysa DB'ye gitmeden 429. İstek tamamen geçerli çıkarsa `refund()` ile yer geri verilir; geçersizlikte
   * (belirteç veya guestSession) ayrılan yer kalır -> sayılır.
   */
  async function resolveMeetingLimited(request: { ip: string }, reply: FastifyReply, rawToken: string) {
    const ipKey = sha("invalid", ipRateKey(request.ip));
    const at = Date.now();
    const reserved = guestInvalidTokenLimiter.consume(ipKey, at);
    if (!reserved.allowed) throwRateLimited(reply, reserved.retryAfterMs);
    let refunded = false;
    const refund = () => {
      if (refunded) return;
      refunded = true;
      guestInvalidTokenLimiter.release(ipKey, at);
    };
    try {
      return { meeting: await resolveMeeting(rawToken), refund };
    } catch (err) {
      // Geçersizlik: yer kalır. Beklenmeyen (ör. DB) hata: kullanıcı suçu değil, geri ver.
      if (!(err instanceof MeetingLinkInvalidError)) refund();
      throw err;
    }
  }

  server.post(
    "/preflight",
    {
      config: { rateLimit: false },
      schema: { body: GuestPreflightRequestSchema, response: { 200: ApiSuccessSchema(GuestPreflightResponseSchema) } },
    },
    async (request, reply) => {
      const { meeting, refund } = await resolveMeetingLimited(request, reply, request.body.t);
      refund();
      const limit = guestPreflightLimiter.consume(sha("preflight", ipRateKey(request.ip), meeting.id));
      if (!limit.allowed) throwRateLimited(reply, limit.retryAfterMs);
      return reply.send(
        ok({
          title: meeting.title,
          hostName: meeting.serviceConsultation ? serviceCoordinatorLabel(meeting.serviceConsultation.coordinator.displayName) : hostDisplayName(meeting.host),
          purpose: meeting.serviceConsultation ? ("service_consultation" as const) : ("general" as const),
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
      // Yoklama 5 sn (+0–2 sn) ≈ 10–12/dk; sınır handler içinde (IP + toplantı + oturum).
      config: { rateLimit: false },
      schema: { body: GuestJoinRequestSchema, response: { 200: ApiSuccessSchema(GuestJoinResponseSchema) } },
    },
    async (request, reply) => {
      const { t, name, guestSession } = request.body;

      // 1) belirteç → toplantı (aksi hâlde aynı 404)
      const { meeting, refund } = await resolveMeetingLimited(request, reply, t);
      // guestSession geçersizse (imza / başka toplantı / misafir yok / çıkarılmış) aynı IP kovasında sayılır ve aynı 404 döner.
      const verifiedSession = guestSession ? verifyGuestSession(guestSession, meeting.id) : null;
      const existingGuest = verifiedSession ? await app.prisma.externalMeetingGuest.findFirst({ where: { id: verifiedSession.guestId, meetingId: meeting.id } }) : null;
      if (guestSession && (!existingGuest || existingGuest.removedAt)) throw new MeetingLinkInvalidError();
      refund();
      const joinLimit = guestJoinLimiter.consume(sha("join", ipRateKey(request.ip), meeting.id, verifiedSession?.guestId ?? ""));
      if (!joinLimit.allowed) throwRateLimited(reply, joinLimit.retryAfterMs);

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
      // Bu istekte AÇILAN satır + tüketilen IP oturum kotası (kapasite dolu çıkarsa geri alınır).
      let createdNow: { ipKey: string; at: number } | null = null;
      if (guestSession) {
        const guest = existingGuest!;
        await app.prisma.externalMeetingGuest.update({ where: { id: guest.id }, data: { lastSeenAt: now }, select: { id: true } });
        guestId = guest.id;
        displayName = guest.displayName;
        session = guestSession;
      } else {
        if (name === undefined) throw new ValidationError("Name is required.", { name: ["Name is required."] });
        const normalized = normalizeGuestName(name);
        if (!normalized.ok) throw new ValidationError(normalized.reason, { name: [normalized.reason] });
        // Tavan yalnızca çıkarılmamış ve son 24 saatte açılmış oturumları sayar; ek olarak IP başına toplantı başına max(20, maxParticipants × 4).
        const sessions = await app.prisma.externalMeetingGuest.count({
          where: { meetingId: meeting.id, removedAt: null, createdAt: { gte: new Date(now.getTime() - GUEST_SESSION_WINDOW_MS) } },
        });
        if (sessions >= MAX_GUEST_SESSIONS_PER_MEETING) throw new MeetingFullError("The meeting is full.");
        const ipKey = crypto.createHash("sha256").update(`${meeting.id}|${ipRateKey(request.ip)}`).digest("hex");
        if (!guestSessionIpLimiter.tryConsume(ipKey, now.getTime(), sessionsPerIpPerMeeting(meeting.maxParticipants))) throw new MeetingFullError("The meeting is full.");
        createdNow = { ipKey, at: now.getTime() };
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
        const capacity = meeting.maxParticipants - 1;
        const isOtherGuest = (id: string) => id.startsWith(MEETING_GUEST_IDENTITY_PREFIX) && id !== ownIdentity;
        let guestsInRoom = present.filter(isOtherGuest).length;
        if (guestsInRoom >= capacity) {
          // Paket AM: dolu görününce yalnız JOINED/ACTIVE kimlikleri say (JOINING/DISCONNECTED koltuk kaplamaz). Okunamazsa mevcut sayım.
          try {
            const counted = await listMeetingCountedIdentities(meeting.roomName);
            if (counted !== null) guestsInRoom = counted.filter(isOtherGuest).length;
          } catch (err) {
            app.log.warn({ err, meetingId: meeting.id }, "Toplantı katılımcı durumları okunamadı; durumsuz sayım kullanıldı.");
          }
        }
        if (guestsInRoom >= capacity) {
          // Paket AM (AM-QA-1): dolu toplantı yeni misafir satırı bırakmaz ve IP oturum kotasını tüketmez.
          // (guestSession ile gelen yeniden deneme zaten satır açmaz.) Bekleme durumunda satır korunur (yukarıda döner).
          if (createdNow) {
            await app.prisma.externalMeetingGuest.deleteMany({ where: { id: guestId, admittedAt: null } });
            guestSessionIpLimiter.release(createdNow.ipKey, createdNow.at);
          }
          throw new MeetingFullError("The meeting is full.");
        }
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
