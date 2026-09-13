import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { requireModuleEnabled } from "../../middleware/module-guard";
import { authenticateOptional } from "../../middleware/authenticate";
import { ok } from "../../lib/envelope";
import { ApiSuccessSchema } from "../../schemas/common";
import { ConsultationRecordingSchema } from "../../schemas/entities";
import { toConsultationRecordingDto } from "../../mappers";
import { NotFoundError, RecordingNotAvailableError } from "../../lib/errors";
import { logAudit } from "../../lib/audit";
import { assertBookingHealthDataAccess, assertBookingPatientOrAdminAccess, type BookingAccessSubject } from "../../lib/telehealth-access";
import { AccessTokenQuerySchema, AppointmentIdParamSchema, RECORDING_CONSENT_TTL_MS, RecordingContentQuerySchema } from "./telehealth.schemas";
import { telehealthRecordingStorage } from "../../lib/telehealth-recording-storage";
import { createBinaryDecryptStream } from "../../lib/binary-crypto";
import { purgeRecordingFile } from "../../lib/telehealth-recording-archive";

/**
 * backend-agent'ın FAZ B sahası — `telehealth.recording.routes.ts` (integration-agent, LiveKit
 * Egress'i BAŞLATAN/DURDURAN uçlar) İLE KARIŞTIRILMAMALI: BU dosya LiveKit SDK'sına HİÇ
 * DOKUNMAZ, yalnızca ZATEN VAR OLAN bir `ConsultationRecording` satırının durumunu okur/içeriğini
 * akıtır/siler. Guard zinciri integration-agent'ın dosyasıyla BİREBİR AYNIDIR (aynı modül
 * anahtarları, aynı `authenticateOptional`) — iki dosya AYNI `/appointments` public yüzeyinde
 * KENDİ BAŞINA `app.ts`'te kaydedilir (`telehealth.livekit.routes.ts` İLE AYNI desen).
 */

const RECORDING_APPOINTMENT_INCLUDE = {
  doctor: { select: { userId: true } },
  booking: {
    select: {
      accessTokenHash: true,
      patientUserId: true,
      appointments: { select: { endsAt: true } },
    },
  },
  recording: true,
} as const;

type RecordingAppointment = {
  id: string;
  endsAt: Date;
  patientUserId: string | null;
  accessTokenHash: string;
  doctor: { userId: string | null };
  booking: {
    accessTokenHash: string;
    patientUserId: string | null;
    appointments: readonly { endsAt: Date }[];
  } | null;
  recording: import("@prisma/client").ConsultationRecording | null;
};

/**
 * `telehealth.recording.routes.ts::resolveAccessSubject` İLE AYNI ilke (KASITLI KOD TEKRARI,
 * cross-dosya bağımlılığından daha iyi — bkz. görev notu): booking VARSA booking'in erişim
 * öznesi, YOKSA (bookingId null — TUR 2 öncesi tekil randevu) randevunun KENDİ alanları.
 */
function resolveAccessSubject(appointment: RecordingAppointment): BookingAccessSubject {
  if (appointment.booking) {
    return {
      patientUserId: appointment.booking.patientUserId,
      accessTokenHash: appointment.booking.accessTokenHash,
      doctor: { userId: appointment.doctor.userId },
      appointments: appointment.booking.appointments,
    };
  }
  return {
    patientUserId: appointment.patientUserId,
    accessTokenHash: appointment.accessTokenHash,
    doctor: { userId: appointment.doctor.userId },
    appointments: [{ endsAt: appointment.endsAt }],
  };
}

/** `telehealth.recording.routes.ts::computeConsentExpiresAtIso` İLE AYNI formül (küçük tekrar, bkz. dosya üstü notu). */
function computeConsentExpiresAtIso(recording: { consentRequestedAt: Date }): string {
  return new Date(recording.consentRequestedAt.getTime() + RECORDING_CONSENT_TTL_MS).toISOString();
}

function isAdminActor(request: { user?: { role: string } }): boolean {
  return request.user?.role === "ADMIN";
}

/** `/appointments` prefix'i altında bağlanır (bkz. app.ts, FAZ B) — PUBLIC, opsiyonel kimlik doğrulama. */
export async function telehealthRecordingAccessRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>();
  server.addHook("preHandler", requireModuleEnabled("telehealth"));
  server.addHook("preHandler", requireModuleEnabled("telehealth-recording"));
  server.addHook("preHandler", authenticateOptional);

  server.get(
    "/appointments/:id/recording",
    {
      config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
      schema: {
        params: AppointmentIdParamSchema,
        querystring: AccessTokenQuerySchema,
        response: { 200: ApiSuccessSchema(ConsultationRecordingSchema.nullable()) },
      },
    },
    async (request, reply) => {
      const appointment = await app.prisma.appointment.findUnique({
        where: { id: request.params.id },
        include: RECORDING_APPOINTMENT_INCLUDE,
      });
      if (!appointment) throw new NotFoundError("Randevu bulunamadı.");

      // §9.7.5 madde 7 disiplini — hasta + booking'in doktoru + ADMIN. MANAGER/EDITOR YOK.
      assertBookingHealthDataAccess(resolveAccessSubject(appointment), { user: request.user, providedToken: request.query.t });

      const recording = appointment.recording;
      if (!recording) {
        // Kayıt satırı YOKSA bu normal bir durumdur ("bu randevu için hiç kayıt başlatılmadı") —
        // 404 DEĞİL, `data: null`. Bu SADECE bir durum okumasıdır, audit YAZILMAZ.
        return reply.send(ok(null));
      }

      return reply.send(ok(toConsultationRecordingDto(recording, computeConsentExpiresAtIso(recording))));
    }
  );

  server.get(
    "/appointments/:id/recording/content",
    {
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
      schema: {
        params: AppointmentIdParamSchema,
        querystring: RecordingContentQuerySchema,
      },
    },
    async (request, reply) => {
      const appointment = await app.prisma.appointment.findUnique({
        where: { id: request.params.id },
        include: RECORDING_APPOINTMENT_INCLUDE,
      });
      if (!appointment) throw new NotFoundError("Randevu bulunamadı.");

      assertBookingHealthDataAccess(resolveAccessSubject(appointment), { user: request.user, providedToken: request.query.t });

      const recording = appointment.recording;
      if (!recording || recording.status !== "COMPLETED" || recording.deletedAt !== null || recording.storagePath === null) {
        throw new RecordingNotAvailableError();
      }

      const { disposition } = request.query;

      // §9.7.5 madde 6 disiplini (bkz. telehealth.routes.ts::intake_document.accessed) — her
      // başarılı erişim denetlenir, `storagePath`/dosya adı/URL ASLA yazılmaz.
      await logAudit(app, {
        actorId: request.user?.id ?? null,
        actorEmail: request.user?.email ?? null,
        action: disposition === "inline" ? "telehealth.recording.accessed" : "telehealth.recording.downloaded",
        targetType: "Appointment",
        targetId: appointment.id,
        metadata: { appointmentId: appointment.id, recordingId: recording.id, viaAdmin: isAdminActor(request) },
        ipAddress: request.ip,
      });

      const source = await telehealthRecordingStorage.openReadStream(recording.storagePath);
      const decrypted = source.pipe(createBinaryDecryptStream());
      // `.pipe()` hata olaylarını OTOMATİK ilettirmez (Node stream davranışı, bkz.
      // telehealth-recording-archive.ts İLE AYNI desen) — kaynak akış hata verirse şifre çözme
      // akışını da elle hataya düşürürüz.
      source.on("error", (err) => decrypted.destroy(err));
      // Bozuk/kurcalanmış veri (auth tag doğrulaması `flush()`'ta başarısız olursa) VEYA
      // depolama/şifre çözme hatası — sessiz bozuk indirme YOK, bağlantı KESİLİR.
      decrypted.on("error", (err) => {
        request.log.error({ err, recordingId: recording.id }, "Görüşme kaydı içeriği akışında hata — bağlantı kesiliyor.");
        reply.raw.destroy();
      });

      return reply
        .header("Content-Type", "video/mp4")
        .header("Content-Disposition", `${disposition}; filename="gorusme-kaydi-${recording.seq}.mp4"`)
        .header("Cache-Control", "no-store")
        .header("X-Content-Type-Options", "nosniff")
        .send(decrypted);
    }
  );

  server.delete(
    "/appointments/:id/recording",
    {
      schema: {
        params: AppointmentIdParamSchema,
        querystring: AccessTokenQuerySchema,
        response: { 200: ApiSuccessSchema(ConsultationRecordingSchema) },
      },
    },
    async (request, reply) => {
      const appointment = await app.prisma.appointment.findUnique({
        where: { id: request.params.id },
        include: RECORDING_APPOINTMENT_INCLUDE,
      });
      if (!appointment) throw new NotFoundError("Randevu bulunamadı.");

      // KVKK md.11 — hasta (oturum/`?t=`) veya ADMIN; doktor DAHİL DEĞİL (doktor bir hastanın
      // kaydını SİLEMEZ, bu yüzden ayrı bir "silme onay kuyruğu" GEREKMEZ).
      assertBookingPatientOrAdminAccess(resolveAccessSubject(appointment), { user: request.user, providedToken: request.query.t });

      const recording = appointment.recording;
      if (!recording || recording.status !== "COMPLETED" || recording.deletedAt !== null) {
        throw new RecordingNotAvailableError();
      }

      await purgeRecordingFile(app, recording.id);

      const updated = await app.prisma.consultationRecording.findUniqueOrThrow({ where: { id: recording.id } });

      const viaAdmin = isAdminActor(request);
      await logAudit(app, {
        actorId: request.user?.id ?? null,
        actorEmail: request.user?.email ?? null,
        action: "telehealth.recording.deleted",
        targetType: "Appointment",
        targetId: appointment.id,
        metadata: { appointmentId: appointment.id, recordingId: recording.id, reason: viaAdmin ? "admin" : "subject_request", viaAdmin },
        ipAddress: request.ip,
      });

      return reply.send(ok(toConsultationRecordingDto(updated, computeConsentExpiresAtIso(updated))));
    }
  );
}
