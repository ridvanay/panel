import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import type { ConsultationRecording } from "@prisma/client";
import { requireModuleEnabled } from "../../middleware/module-guard";
import { authenticateOptional } from "../../middleware/authenticate";
import { ok } from "../../lib/envelope";
import { ApiSuccessSchema } from "../../schemas/common";
import { ConsultationRecordingSchema } from "../../schemas/entities";
import { toConsultationRecordingDto } from "../../mappers";
import {
  AppointmentNotJoinableError,
  LiveKitNotConfiguredError,
  NotFoundError,
  RecordingAlreadyActiveError,
  RecordingAlreadyExistsError,
  RecordingConsentExpiredError,
  RecordingConsentNotPendingError,
  RecordingNotActiveError,
  RecordingNotConfiguredError,
} from "../../lib/errors";
import { logAudit } from "../../lib/audit";
import { assertBookingPatientOnlyAccess, type BookingAccessSubject } from "../../lib/telehealth-access";
import {
  AccessTokenQuerySchema,
  AppointmentIdParamSchema,
  RECORDING_CONSENT_TTL_MS,
  RECORDING_CONSENT_VERSION,
  RecordingConsentRequestSchema,
} from "./telehealth.schemas";
import { getBookingJoinWindow, isWithinJoinWindow } from "./lib/booking";
import { isLiveKitConfigured } from "./lib/livekit";
import { isRecordingConfigured, startRoomCompositeRecording, stopRoomCompositeRecording } from "./lib/livekit-egress";
import { sendRecordingSignal } from "./lib/livekit-signal";

/**
 * `.claude/architect-scope-telehealth-template.md` (TUR 3, bağlayıcı) — integration-agent'ın TEK
 * SAHASI: `POST /appointments/{id}/recording/start|consent|stop`. `telehealth.routes.ts`'e
 * (backend-agent'ın dosyası) KASITLI OLARAK DOKUNULMAZ — bu ayrı dosya `app.ts`'de KENDİ BAŞINA
 * kaydedilir (`telehealth.livekit.routes.ts` İLE AYNI desen). Public `/appointments` yüzeyine
 * EKLENİR. `GET .../recording`, `GET .../recording/content`, `DELETE .../recording`
 * backend-agent'ın sahasıdır (LiveKit SDK'sına dokunmazlar) — BU DOSYADA YOKTUR.
 */

const RECORDING_APPOINTMENT_INCLUDE = {
  doctor: { select: { userId: true } },
  booking: {
    select: {
      meetingRoomName: true,
      accessTokenHash: true,
      paymentStatus: true,
      patientUserId: true,
      appointments: { select: { startsAt: true, endsAt: true } },
    },
  },
  recording: true,
} as const;

type RecordingAppointment = {
  id: string;
  status: string;
  startsAt: Date;
  endsAt: Date;
  meetingRoomName: string;
  patientUserId: string | null;
  accessTokenHash: string;
  doctor: { userId: string | null };
  booking: {
    meetingRoomName: string;
    accessTokenHash: string;
    paymentStatus: string;
    patientUserId: string | null;
    appointments: readonly { startsAt: Date; endsAt: Date }[];
  } | null;
  recording: ConsultationRecording | null;
};

const RECORDING_RATE_LIMIT = { max: 10, timeWindow: "1 minute" } as const;

/** `/complete` ucuyla (telehealth.livekit.routes.ts) BİREBİR AYNI eşik — misafir `?t=` GEÇERSİZDİR. */
function isDoctorOrAdmin(appointment: RecordingAppointment, request: { user?: { id: string; role: string } }): boolean {
  if (request.user?.role === "ADMIN") return true;
  return Boolean(request.user && appointment.doctor.userId && appointment.doctor.userId === request.user.id);
}

/**
 * Booking VARSA booking'in erişim öznesi, YOKSA (bookingId null — TUR 2 öncesi tekil randevu)
 * randevunun KENDİ alanları kullanılır — `telehealth.livekit.routes.ts::isAuthorizedForMeetingAccess`
 * İLE AYNI ilke, `assertBookingPatientOnlyAccess`'in beklediği şekle uyarlanmış hâli.
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

/** [TCT] §9.7.6 — booking'e bağlıysa TEK oda booking'in kendisidir, aksi hâlde randevunun kendi odası. */
function resolveRoomName(appointment: RecordingAppointment): string {
  return appointment.booking ? appointment.booking.meetingRoomName : appointment.meetingRoomName;
}

/** `meeting-token` ucuyla (telehealth.livekit.routes.ts) BİREBİR AYNI katılım penceresi hesabı. */
function isAppointmentJoinable(appointment: RecordingAppointment): boolean {
  const now = new Date();
  if (appointment.booking) {
    const { joinableFrom, joinableUntil } = getBookingJoinWindow(appointment.booking.appointments, appointment.booking.paymentStatus);
    return Boolean(joinableFrom && joinableUntil && now >= joinableFrom && now <= joinableUntil);
  }
  return isWithinJoinWindow(now, appointment.startsAt, appointment.endsAt);
}

function isConsentExpired(recording: ConsultationRecording): boolean {
  return Date.now() > recording.consentRequestedAt.getTime() + RECORDING_CONSENT_TTL_MS;
}

/**
 * `consentExpiresAt` — istemcinin geri sayımı içindir (openapi.yaml `ConsultationRecording.
 * consentExpiresAt` notu). Yalnızca `PENDING_CONSENT`'ken anlamlıdır ama diğer durumlarda da
 * SAF/yan etkisiz bir hesaplama olduğu için (en son rıza isteminin TTL'i) TÜM durumlarda AYNI
 * formülle üretilir — mapper'ın "route hesaplar" ilkesiyle TUTARLI tek bir kaynak.
 */
function computeConsentExpiresAtIso(recording: ConsultationRecording): string {
  return new Date(recording.consentRequestedAt.getTime() + RECORDING_CONSENT_TTL_MS).toISOString();
}

/** `/appointments` prefix'i altında bağlanır (bkz. app.ts, FAZ B) — PUBLIC, opsiyonel kimlik doğrulama. */
export async function telehealthRecordingRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>();
  server.addHook("preHandler", requireModuleEnabled("telehealth"));
  server.addHook("preHandler", requireModuleEnabled("telehealth-recording"));
  server.addHook("preHandler", authenticateOptional);

  server.post(
    "/appointments/:id/recording/start",
    {
      config: { rateLimit: RECORDING_RATE_LIMIT },
      schema: {
        params: AppointmentIdParamSchema,
        response: { 200: ApiSuccessSchema(ConsultationRecordingSchema) },
      },
    },
    async (request, reply) => {
      // Ön koşul sırası (bağlayıcı, openapi.yaml) — modül guard'larından SONRA, randevu var mı
      // hiç sorgulanmadan ÖNCE: LiveKit → S3/webhook yapılandırması.
      if (!isLiveKitConfigured()) throw new LiveKitNotConfiguredError();
      if (!isRecordingConfigured()) throw new RecordingNotConfiguredError();

      const appointment = await app.prisma.appointment.findUnique({
        where: { id: request.params.id },
        include: RECORDING_APPOINTMENT_INCLUDE,
      });
      if (!appointment) throw new NotFoundError("Randevu bulunamadı.");

      if (!isDoctorOrAdmin(appointment, request)) throw new NotFoundError("Randevu bulunamadı.");

      if (appointment.status !== "SCHEDULED" && appointment.status !== "IN_PROGRESS") {
        throw new AppointmentNotJoinableError();
      }
      if (!isAppointmentJoinable(appointment)) {
        throw new AppointmentNotJoinableError();
      }

      const existing = appointment.recording;
      if (existing) {
        const stillPending = existing.status === "PENDING_CONSENT" && !isConsentExpired(existing);
        if (stillPending || existing.status === "RECORDING" || existing.status === "PROCESSING") {
          throw new RecordingAlreadyActiveError();
        }
        if (existing.status === "COMPLETED" || existing.status === "FAILED") {
          throw new RecordingAlreadyExistsError();
        }
        // Kalan durumlar (PENDING_CONSENT + TTL dolmuş, VEYA CONSENT_DENIED) — satır YENİDEN
        // KULLANILIR (`patientConsentDeniedAt` aşağıdaki upsert'te YAZILMADIĞI için KORUNUR).
      }

      const now = new Date();
      const recording = await app.prisma.consultationRecording.upsert({
        where: { appointmentId: appointment.id },
        create: {
          appointmentId: appointment.id,
          status: "PENDING_CONSENT",
          consentRequestedAt: now,
          doctorConsentAt: now,
          doctorConsentVersion: RECORDING_CONSENT_VERSION,
        },
        update: {
          status: "PENDING_CONSENT",
          consentRequestedAt: now,
          doctorConsentAt: now,
          doctorConsentVersion: RECORDING_CONSENT_VERSION,
        },
      });

      await logAudit(app, {
        actorId: request.user?.id ?? null,
        actorEmail: request.user?.email ?? null,
        action: "telehealth.recording.consent_requested",
        targetType: "Appointment",
        targetId: appointment.id,
        metadata: { recordingId: recording.id },
        ipAddress: request.ip,
      });

      const consentExpiresAt = computeConsentExpiresAtIso(recording);
      await sendRecordingSignal(app, resolveRoomName(appointment), {
        v: 1,
        appointmentId: appointment.id,
        recordingId: recording.id,
        status: "PENDING_CONSENT",
        consentVersion: RECORDING_CONSENT_VERSION,
        consentExpiresAt,
      });

      return reply.send(ok(toConsultationRecordingDto(recording, consentExpiresAt)));
    }
  );

  server.post(
    "/appointments/:id/recording/consent",
    {
      config: { rateLimit: RECORDING_RATE_LIMIT },
      schema: {
        params: AppointmentIdParamSchema,
        querystring: AccessTokenQuerySchema,
        body: RecordingConsentRequestSchema,
        response: { 200: ApiSuccessSchema(ConsultationRecordingSchema) },
      },
    },
    async (request, reply) => {
      const appointment = await app.prisma.appointment.findUnique({
        where: { id: request.params.id },
        include: RECORDING_APPOINTMENT_INCLUDE,
      });
      if (!appointment) throw new NotFoundError("Randevu bulunamadı.");

      // §TUR 3 madde 2 — YALNIZCA hasta; doktor/ADMIN hastanın YERİNE rıza VEREMEZ.
      assertBookingPatientOnlyAccess(resolveAccessSubject(appointment), { user: request.user, providedToken: request.query.t });

      const recording = appointment.recording;
      if (!recording || recording.status !== "PENDING_CONSENT") {
        throw new RecordingConsentNotPendingError();
      }
      if (isConsentExpired(recording)) {
        throw new RecordingConsentExpiredError();
      }

      const roomName = resolveRoomName(appointment);

      if (!request.body.granted) {
        const updated = await app.prisma.consultationRecording.update({
          where: { id: recording.id },
          data: { status: "CONSENT_DENIED", patientConsentDeniedAt: new Date() },
        });

        await logAudit(app, {
          actorId: request.user?.id ?? null,
          actorEmail: request.user?.email ?? null,
          action: "telehealth.recording.consent_denied",
          targetType: "Appointment",
          targetId: appointment.id,
          metadata: { recordingId: recording.id },
          ipAddress: request.ip,
        });
        await sendRecordingSignal(app, roomName, {
          v: 1,
          appointmentId: appointment.id,
          recordingId: recording.id,
          status: "CONSENT_DENIED",
          consentVersion: RECORDING_CONSENT_VERSION,
          consentExpiresAt: null,
        });

        return reply.send(ok(toConsultationRecordingDto(updated, computeConsentExpiresAtIso(updated))));
      }

      // **MUTLAK KURAL** (görev özeti) — `startRoomCompositeRecording(` bu dosyada SADECE burada
      // çağrılır, ve SADECE aşağıdaki `updateMany`'nin `count === 1` döndürmesinden SONRA.
      const now = new Date();
      const consentClaim = await app.prisma.consultationRecording.updateMany({
        where: { id: recording.id, status: "PENDING_CONSENT" },
        data: { patientConsentAt: now, patientConsentVersion: RECORDING_CONSENT_VERSION },
      });
      if (consentClaim.count !== 1) {
        // Eşzamanlı ikinci istek/TTL yarışı — rıza ZATEN başka bir istek tarafından claim edildi.
        throw new RecordingConsentNotPendingError();
      }

      await logAudit(app, {
        actorId: request.user?.id ?? null,
        actorEmail: request.user?.email ?? null,
        action: "telehealth.recording.consent_granted",
        targetType: "Appointment",
        targetId: appointment.id,
        metadata: { recordingId: recording.id },
        ipAddress: request.ip,
      });

      let finalRecording: ConsultationRecording;
      try {
        const { egressId } = await startRoomCompositeRecording({ roomName, recordingId: recording.id });
        finalRecording = await app.prisma.consultationRecording.update({
          where: { id: recording.id },
          data: { status: "RECORDING", egressId, startedAt: now },
        });
        await logAudit(app, {
          actorId: request.user?.id ?? null,
          actorEmail: request.user?.email ?? null,
          action: "telehealth.recording.started",
          targetType: "Appointment",
          targetId: appointment.id,
          metadata: { recordingId: recording.id },
          ipAddress: request.ip,
        });
        await sendRecordingSignal(app, roomName, {
          v: 1,
          appointmentId: appointment.id,
          recordingId: recording.id,
          status: "RECORDING",
          consentVersion: RECORDING_CONSENT_VERSION,
          consentExpiresAt: null,
        });
      } catch (err) {
        // Rıza GEÇERLİDİR (yukarıda zaten yazıldı) — teknik Egress hatası hastanın eyleminin
        // başarısızlığı DEĞİLDİR; bu yüzden yanıt yine 200 döner (`failureReason` istemciye SIZMAZ).
        const message = err instanceof Error ? err.message : "Görüşme kaydı başlatılırken bilinmeyen bir hata oluştu.";
        finalRecording = await app.prisma.consultationRecording.update({
          where: { id: recording.id },
          data: { status: "FAILED", failureReason: message },
        });
        await sendRecordingSignal(app, roomName, {
          v: 1,
          appointmentId: appointment.id,
          recordingId: recording.id,
          status: "FAILED",
          consentVersion: RECORDING_CONSENT_VERSION,
          consentExpiresAt: null,
        });
      }

      return reply.send(ok(toConsultationRecordingDto(finalRecording, computeConsentExpiresAtIso(finalRecording))));
    }
  );

  server.post(
    "/appointments/:id/recording/stop",
    {
      config: { rateLimit: RECORDING_RATE_LIMIT },
      schema: {
        params: AppointmentIdParamSchema,
        response: { 200: ApiSuccessSchema(ConsultationRecordingSchema) },
      },
    },
    async (request, reply) => {
      const appointment = await app.prisma.appointment.findUnique({
        where: { id: request.params.id },
        include: RECORDING_APPOINTMENT_INCLUDE,
      });
      if (!appointment) throw new NotFoundError("Randevu bulunamadı.");

      if (!isDoctorOrAdmin(appointment, request)) throw new NotFoundError("Randevu bulunamadı.");

      const recording = appointment.recording;
      if (!recording || recording.status !== "RECORDING" || !recording.egressId) {
        throw new RecordingNotActiveError();
      }

      await stopRoomCompositeRecording(recording.egressId);
      const updated = await app.prisma.consultationRecording.update({
        where: { id: recording.id },
        data: { status: "PROCESSING" },
      });

      await logAudit(app, {
        actorId: request.user?.id ?? null,
        actorEmail: request.user?.email ?? null,
        action: "telehealth.recording.stopped",
        targetType: "Appointment",
        targetId: appointment.id,
        metadata: { recordingId: recording.id },
        ipAddress: request.ip,
      });
      await sendRecordingSignal(app, resolveRoomName(appointment), {
        v: 1,
        appointmentId: appointment.id,
        recordingId: recording.id,
        status: "PROCESSING",
        consentVersion: RECORDING_CONSENT_VERSION,
        consentExpiresAt: null,
      });

      return reply.send(ok(toConsultationRecordingDto(updated, computeConsentExpiresAtIso(updated))));
    }
  );
}
