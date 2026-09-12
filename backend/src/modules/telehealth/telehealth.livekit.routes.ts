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
import { getBookingJoinWindow, isWithinJoinWindow } from "./lib/booking";
import { createMeetingToken, isLiveKitConfigured } from "./lib/livekit";
import { encryptSecret } from "../../lib/crypto";

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
              appointments: { select: { startsAt: true, endsAt: true } },
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

      // [TCT] §9.7.6 madde 2/4 (bağlayıcı) — booking'e bağlıysa pencere TÜM booking açıklığı
      // üzerinden (`min(startsAt)-10dk … max(endsAt)+15dk`) hesaplanır VE `paymentStatus !==
      // "PAID"` ise `null`/`null` (asla katılınabilir görünmez) — `getBookingJoinWindow` bu ikisini
      // BİRLİKTE uygular. `bookingId` YOKSA (bu tur ÖNCESİ tekil randevu) DAVRANIŞ DEĞİŞMEDİ.
      let isJoinable: boolean;
      if (booking) {
        const { joinableFrom, joinableUntil } = getBookingJoinWindow(booking.appointments, booking.paymentStatus);
        const now = new Date();
        isJoinable = Boolean(joinableFrom && joinableUntil && now >= joinableFrom && now <= joinableUntil);
      } else {
        isJoinable = isWithinJoinWindow(new Date(), appointment.startsAt, appointment.endsAt);
      }
      if (!isJoinable) {
        throw new AppointmentNotJoinableError();
      }

      // [TCT] §9.7.6 (bağlayıcı) — "Çoklu slot = TEK oda": booking'e bağlıysa KANONİK oda
      // `AppointmentBooking.meetingRoomName`'dir (aksi hâlde hasta ikinci slotta odadan düşer).
      const meeting = await createMeetingToken({
        roomName: booking ? booking.meetingRoomName : appointment.meetingRoomName,
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
      await logAudit(app, {
        actorId: request.user?.id ?? null,
        actorEmail: request.user?.email ?? null,
        action: "telehealth.meeting_token.issued",
        targetType: "Appointment",
        targetId: appointment.id,
        metadata: { participantKind: isDoctor ? "doctor" : "patient", viaAdmin: request.user?.role === "ADMIN" },
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
      // status/`endedAt`) DEĞİŞMEZ, var olan bir not SİLİNMEZ (bkz. telehealth.schemas.ts).
      const note = request.body?.note?.trim();
      const hasNote = Boolean(note);

      const updated = await app.prisma.appointment.update({
        where: { id: appointment.id },
        data: {
          status: "COMPLETED",
          endedAt: new Date(),
          ...(hasNote
            ? { consultationNoteCiphertext: encryptSecret(note!), consultationNoteUpdatedAt: new Date() }
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
