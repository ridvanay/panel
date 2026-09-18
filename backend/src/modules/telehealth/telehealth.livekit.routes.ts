import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { requireModuleEnabled } from "../../middleware/module-guard";
import { authenticateOptional } from "../../middleware/authenticate";
import { ok } from "../../lib/envelope";
import { ApiSuccessSchema } from "../../schemas/common";
import { AppointmentSchema } from "../../schemas/entities";
import { toAppointmentDto } from "../../mappers";
import { AppointmentNotJoinableError, LiveKitNotConfiguredError, NotFoundError } from "../../lib/errors";
import { hashToken } from "../../lib/tokens";
import { timingSafeEqualHex } from "../../lib/api-key";
import { logAudit } from "../../lib/audit";
import { AppointmentIdParamSchema, AccessTokenQuerySchema, CompleteAppointmentRequestSchema } from "./telehealth.schemas";
import { createMeetingToken, ensureRoomConfigured, isLiveKitConfigured } from "./lib/livekit";
import { computeEarlyJoinAuditMetadata } from "./lib/early-join";
import { encryptSecret } from "../../lib/crypto";
import { sanitizeRichHtml } from "../../lib/html-sanitize";

/**
 * `.claude/architect-scope-telehealth-template.md` §4.4/§4.5/§8/§9.4/§9.5/§12 — integration-agent'ın
 * TEK SAHASI. `telehealth.routes.ts`'e (backend-agent'ın dosyası) KASITLI OLARAK DOKUNULMAZ; bu ayrı
 * dosya `app.ts`'de KENDİ BAŞINA kaydedilir. Public `/appointments` prefix'i altında bağlanır.
 */

const WITH_APPOINTMENT_DOCTOR = {
  doctor: { select: { id: true, title: true, fullName: true, slug: true, userId: true } },
} as const;

const MeetingTokenResponseSchema = z.object({
  token: z.string(),
  serverUrl: z.string(),
  roomName: z.string(),
  expiresAt: z.string(),
});

type AppointmentAccessSubject = {
  patientUserId: string | null;
  accessTokenHash: string;
  doctor: { id: string; userId: string | null };
};

/**
 * [TCT] §9.7.6 (bağlayıcı, integration-agent'ın bu tur uyarlaması) — booking'e bağlı bir randevu
 * için `Appointment.accessTokenHash` YALNIZCA deprecated tek-slot `POST /appointments` akışının
 * istemciye döndürdüğü token'dır (bkz. `lib/booking.ts::bookAppointment`). Çoklu-slot
 * `POST /appointments/bookings` akışında istemciye YALNIZCA booking'in KENDİ token'ı döner
 * (`AppointmentBooking.accessTokenHash`) — bu yüzden booking-bağlı bir randevuda İKİ token da
 * (randevunun KENDİ + booking'in) kabul edilir (geriye dönük uyumluluk + yeni akış, İKİSİ
 * BİRDEN). `bookingAccessTokenHash` YOKSA (bookingId null — bu tur ÖNCESİ tekil randevu) yalnızca
 * randevunun kendi hash'i karşılaştırılır (davranış DEĞİŞMEDİ).
 */
function isAuthorizedForMeetingAccess(
  appointment: AppointmentAccessSubject,
  request: { user?: { id: string; role: string }; providedToken?: string },
  bookingAccessTokenHash?: string | null
): { authorized: boolean; isDoctor: boolean } {
  if (request.user) {
    if (request.user.role === "ADMIN") return { authorized: true, isDoctor: false };
    if (appointment.patientUserId && appointment.patientUserId === request.user.id) {
      return { authorized: true, isDoctor: false };
    }
    if (appointment.doctor.userId && appointment.doctor.userId === request.user.id) {
      return { authorized: true, isDoctor: true };
    }
  }
  // §8 madde 2 (bağlayıcı, security-agent düzeltmesi) — sabit zamanlı karşılaştırma
  // (`telehealth.routes.ts::assertAppointmentAccess` İLE AYNI disiplin, düz `===` YASAK).
  if (request.providedToken) {
    const providedHash = hashToken(request.providedToken);
    if (timingSafeEqualHex(providedHash, appointment.accessTokenHash)) {
      return { authorized: true, isDoctor: false };
    }
    if (bookingAccessTokenHash && timingSafeEqualHex(providedHash, bookingAccessTokenHash)) {
      return { authorized: true, isDoctor: false };
    }
  }
  return { authorized: false, isDoctor: false };
}

/** `/appointments` prefix'i altında bağlanır (bkz. app.ts) — PUBLIC, opsiyonel kimlik doğrulama. */
export async function telehealthLiveKitRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>();
  server.addHook("preHandler", requireModuleEnabled("telehealth"));
  server.addHook("preHandler", authenticateOptional);

  server.post(
    "/appointments/:id/meeting-token",
    {
      // §8 madde 1 (bağlayıcı) — hız sınırı 10 istek/dk.
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
      schema: {
        params: AppointmentIdParamSchema,
        querystring: AccessTokenQuerySchema,
        response: { 200: ApiSuccessSchema(MeetingTokenResponseSchema) },
      },
    },
    async (request, reply) => {
      // §4.4 madde 3 (bağlayıcı) — yapılandırılmamışken 503, randevu var mı/erişim var mı hiç
      // sorgulanmaz (istemciye anlamlı ve hızlı bir "bu kurulumda kapalı" cevabı).
      if (!isLiveKitConfigured()) {
        throw new LiveKitNotConfiguredError();
      }

      // [TCT] §9.7.6 (bağlayıcı) — booking'e bağlı bir randevuda oda/katılım penceresi/token
      // kanonik olarak booking üzerinden çözülür (bkz. aşağıdaki `booking` bloğu). `select`
      // yalnızca ihtiyaç duyulan alt kümeyi taşır (§8.5 minimum ifşa — mapper'a değil, doğrudan
      // Prisma sorgusuna DB düzeyinde uygulanır).
      const appointment = await app.prisma.appointment.findUnique({
        where: { id: request.params.id },
        include: {
          ...WITH_APPOINTMENT_DOCTOR,
          booking: {
            select: {
              meetingRoomName: true,
              accessTokenHash: true,
              paymentStatus: true,
            },
          },
        },
      });
      if (!appointment) throw new NotFoundError("Randevu bulunamadı.");

      const booking = appointment.booking;

      const { authorized, isDoctor } = isAuthorizedForMeetingAccess(
        appointment,
        { user: request.user, providedToken: request.query.t },
        booking?.accessTokenHash
      );
      if (!authorized) throw new NotFoundError("Randevu bulunamadı.");

      if (appointment.status !== "SCHEDULED" && appointment.status !== "IN_PROGRESS") {
        throw new AppointmentNotJoinableError();
      }

      // integration-agent görev notu (2026-09-15, "Katılım penceresi bypass'ını ödeme durumuna göre
      // genelleştir") — dar 10dk-önce/15dk-sonra saat penceresi (`getBookingJoinWindow`/
      // `isWithinJoinWindow`) TAMAMEN KALDIRILDI; artık hem doktor HEM hasta AYNI kurala tabi.
      // status kontrolü (üstte, SCHEDULED/IN_PROGRESS) DEĞİŞMEDEN KALIR. Booking'e bağlıysa TEK
      // şart `paymentStatus === "PAID"` (ödenmemiş bir görüşmeye HİÇKİMSE — doktor da dahil —
      // giremez); booking'e bağlı DEĞİLSE (deprecated tekil randevu akışı, `paymentStatus`
      // kavramı YOK) `appointment.status`'ün kendisi zaten SCHEDULED/IN_PROGRESS ise yeterli
      // (üstteki kontrolle AYNI şart, ayrıca zaman penceresi UYGULANMAZ). `isDoctor` bu kararda
      // ARTIK KULLANILMAZ — sadece katılımcı türü/audit için (aşağıda, DEĞİŞMEDİ).
      const isJoinable = booking ? booking.paymentStatus === "PAID" : true;
      if (!isJoinable) {
        throw new AppointmentNotJoinableError();
      }

      // [TCT] §9.7.6 (bağlayıcı) — "Çoklu slot = TEK oda": booking'e bağlıysa KANONİK oda
      // `AppointmentBooking.meetingRoomName`'dir (aksi hâlde hasta ikinci slotta odadan düşer).
      const roomName = booking ? booking.meetingRoomName : appointment.meetingRoomName;

      // 2026-09-19 (kullanıcı talebi) — boşta kalan odaların otomatik kapanması: BEST-EFFORT,
      // LiveKit Server API'sine ulaşılamazsa/oda zaten varsa görüşme akışı BOZULMAZ (bkz.
      // lib/livekit.ts::ensureRoomConfigured dosya başı yorumu) — yalnızca loglanır.
      try {
        await ensureRoomConfigured(roomName);
      } catch (err) {
        app.log.warn({ err, roomName }, "LiveKit odası açık timeout'larla önceden yapılandırılamadı (best-effort) — katılım engellenmedi.");
      }

      const meeting = await createMeetingToken({
        roomName,
        participant: isDoctor ? { kind: "doctor", id: appointment.doctor.id } : { kind: "patient", id: appointment.id },
      });

      // İlk başarılı token üretiminde TEK SEFERLİK geçiş — `updateMany` + `status: "SCHEDULED"`
      // koşulu, eşzamanlı iki çağrının `startedAt`'i İKİ KEZ YAZMASINI engeller (ikincisi 0 satır
      // etkiler, sessizce no-op).
      if (appointment.status === "SCHEDULED") {
        await app.prisma.appointment.updateMany({
          where: { id: appointment.id, status: "SCHEDULED" },
          data: { status: "IN_PROGRESS", startedAt: new Date() },
        });
      }

      // §8 madde 1 (bağlayıcı) — başarılı HER üretimde audit. `metadata`'ya token/URL YAZILMAZ.
      // [ASD] §1.2/§1.3 (bağlayıcı) — `earlyJoin`/`minutesBeforeStart` SUNUCU saatinden
      // `appointment.startsAt`ten hesaplanır, istemciden ASLA gelmez. Backend bu bilgiyi
      // SADECE loglar — katılımı REDDETMEZ (kontrol tamamen frontend modalindedir).
      await logAudit(app, {
        actorId: request.user?.id ?? null,
        actorEmail: request.user?.email ?? null,
        action: "telehealth.meeting_token.issued",
        targetType: "Appointment",
        targetId: appointment.id,
        metadata: {
          participantKind: isDoctor ? "doctor" : "patient",
          viaAdmin: request.user?.role === "ADMIN",
          ...computeEarlyJoinAuditMetadata(appointment.startsAt),
        },
        ipAddress: request.ip,
      });

      return reply.send(ok(meeting));
    }
  );

  server.post(
    "/appointments/:id/complete",
    {
      schema: {
        params: AppointmentIdParamSchema,
        body: CompleteAppointmentRequestSchema,
        response: { 200: ApiSuccessSchema(AppointmentSchema) },
      },
    },
    async (request, reply) => {
      const appointment = await app.prisma.appointment.findUnique({
        where: { id: request.params.id },
        include: WITH_APPOINTMENT_DOCTOR,
      });
      if (!appointment) throw new NotFoundError("Randevu bulunamadı.");

      // §4.5 son madde — yalnızca doktorun bağlı `User`'ı veya `ADMIN`. Misafir `accessToken`'ı
      // BURADA GEÇERSİZDİR (bir randevuyu tamamlamak hasta yetkisinde bir eylem DEĞİLDİR).
      const isAdmin = request.user?.role === "ADMIN";
      const isDoctor = Boolean(request.user && appointment.doctor.userId && appointment.doctor.userId === request.user.id);
      if (!isAdmin && !isDoctor) throw new NotFoundError("Randevu bulunamadı.");

      // Epikriz/konsültasyon notu opsiyoneldir — boş/undefined ise mevcut davranış (yalnızca
      // status/`endedAt`) DEĞİŞMEZ, var olan bir not SİLİNMEZ (bkz. telehealth.schemas.ts). Tiptap
      // editörünün ürettiği ham HTML DB'ye yazılmadan ÖNCE `sanitizeRichHtml` ile temizlenir —
      // "tek temizleme yolu" ilkesi (bkz. lib/html-sanitize.ts dosya başı yorumu). Boş bir Tiptap
      // editörü etiketten arındırılınca boş kalan HTML üretebilir (ör. `<p></p>`) — bu durumda not
      // YOK sayılır (basit bir etiket-soyma + trim kontrolü yeterli, aşırı mühendislik gerekmez).
      const rawNote = request.body?.note?.trim();
      const sanitizedNote = rawNote ? sanitizeRichHtml(rawNote) : "";
      const strippedNote = sanitizedNote.replace(/<[^>]*>/g, "").trim();
      const hasNote = strippedNote.length > 0;

      const updated = await app.prisma.appointment.update({
        where: { id: appointment.id },
        data: {
          status: "COMPLETED",
          // İdempotency — randevu zaten COMPLETED iken doktor notu SONRADAN düzenliyorsa (ör. bir
          // yazım hatasını düzeltmek için `/complete`'i ikinci kez çağırıyorsa) `endedAt` gerçek
          // seans bitiş zaman damgası olarak KALIR, ikinci düzenlemede KAYMAZ.
          endedAt: appointment.endedAt ?? new Date(),
          ...(hasNote
            ? { consultationNoteCiphertext: encryptSecret(sanitizedNote), consultationNoteUpdatedAt: new Date() }
            : {}),
        },
        include: { doctor: { select: { id: true, title: true, fullName: true, slug: true } } },
      });

      if (hasNote) {
        // §8 madde 2 disiplini (`telehealth.intake_note.accessed` ile AYNI) — `metadata`'ya NOT
        // İÇERİĞİ ASLA YAZILMAZ.
        await logAudit(app, {
          actorId: request.user?.id ?? null,
          actorEmail: request.user?.email ?? null,
          action: "telehealth.consultation_note.updated",
          targetType: "Appointment",
          targetId: appointment.id,
          ipAddress: request.ip,
        });
      }

      return reply.send(ok(toAppointmentDto(updated)));
    }
  );
}
