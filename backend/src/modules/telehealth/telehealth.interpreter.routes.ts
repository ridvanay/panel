import crypto from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { authenticate, authenticateOptional } from "../../middleware/authenticate";
import { requireSiteRole } from "../../middleware/site-rbac";
import { requireModuleEnabled } from "../../middleware/module-guard";
import { ok } from "../../lib/envelope";
import { ApiSuccessSchema } from "../../schemas/common";
import { AccessTokenQuerySchema } from "./telehealth.schemas";
import { AppointmentNotJoinableError, ConflictError, ForbiddenError, LiveKitNotConfiguredError, NotFoundError, TwoFactorRequiredError, ValidationError } from "../../lib/errors";
import { logAudit } from "../../lib/audit";
import { hashToken } from "../../lib/tokens";
import { timingSafeEqualHex } from "../../lib/api-key";
import { LOCALE_CODE_PATTERN } from "../../lib/localization";
import { assertBookingPatientOnlyAccess } from "../../lib/telehealth-access";
import { doctorDisplayName } from "../../lib/doctor-display-name";
import { createInterpreterToken, ensureRoomConfigured, isLiveKitConfigured, removeRoomParticipant } from "./lib/livekit";
import { parseLanguageSupport } from "./lib/language-support";
import {
  ACTIVE_ASSIGNMENT_STATUSES,
  INTERPRETER_AUDIT,
  bookingSpan,
  buildInterpreterIdentity,
  hasCurrentConfidentiality,
  interpreterParticipantName,
  nativeLanguageName,
  parseConfidentialityText,
  patientInitial,
  pickJoinableAppointment,
} from "./lib/interpreters";

/**
 * Paket AA — tercümanın kendi uçları (`/interpreter`, yalnızca `SiteRole.INTERPRETER`) ve hasta/doktor
 * tarafındaki küçük uçlar (`/appointments/...`). Hasta/doktor `meeting-token` ucu DEĞİŞMEZ; tercüman
 * token'ı bu dosyadaki ayrı uçtan üretilir.
 *
 * Tercümana açılan veri: tarih/saat, dil, doktorun görünen adı, hastanın yalnızca adının baş harfi.
 * Hasta belgeleri, intake cevapları, doktor notları, reçeteler ve kayıt dosyaları bu uçlardan DÖNMEZ
 * (mevcut uçlar da INTERPRETER rolüne erişim vermez).
 */

const AssignmentIdParamSchema = z.object({ id: z.string().uuid() });
const AppointmentIdParamSchema = z.object({ id: z.string().uuid() });
const BookingIdParamSchema = z.object({ bookingId: z.string().uuid() });

const InterpreterMeSchema = z.object({
  displayName: z.string(),
  languages: z.array(z.string()),
  timeZone: z.string(),
  isActive: z.boolean(),
  twoFactorEnabled: z.boolean(),
  confidentiality: z.object({
    accepted: z.boolean(),
    acceptedAt: z.string().nullable(),
    version: z.string(),
    textEn: z.string(),
    textTr: z.string(),
  }),
});

const InterpreterAssignmentSchema = z.object({
  id: z.string(),
  language: z.string(),
  languageName: z.string(),
  status: z.enum(["ASSIGNED", "JOINED", "LEFT", "REMOVED", "CANCELLED"]),
  startsAt: z.string().nullable(),
  endsAt: z.string().nullable(),
  doctorDisplayName: z.string(),
  patientInitial: z.string(),
  canJoin: z.boolean(),
  past: z.boolean(),
});

const InterpreterTokenSchema = z.object({
  token: z.string(),
  serverUrl: z.string(),
  roomName: z.string(),
  expiresAt: z.string(),
  sessionId: z.string().uuid(),
});

const InterpreterInfoSchema = z.object({
  language: z.string(),
  languageName: z.string(),
  displayName: z.string(),
  status: z.enum(["ASSIGNED", "JOINED", "LEFT"]),
});

async function readTelehealthSettings(app: FastifyInstance) {
  return (await app.prisma.siteModule.findUnique({ where: { key: "telehealth" }, select: { settings: true } }))?.settings;
}

/** `/interpreter` — yalnızca INTERPRETER. Admin/doktor/CRM uçları zaten bu rolü reddeder. */
export async function interpreterRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>();
  server.addHook("preHandler", requireModuleEnabled("telehealth"));
  server.addHook("preHandler", authenticate);
  server.addHook("preHandler", requireSiteRole("INTERPRETER"));

  async function loadProfile(userId: string) {
    const profile = await app.prisma.interpreterProfile.findUnique({
      where: { userId },
      include: { user: { select: { twoFactorEnabled: true, status: true } } },
    });
    if (!profile) throw new ForbiddenError("Tercüman profili bulunamadı.");
    return profile;
  }

  server.get("/me", { schema: { response: { 200: ApiSuccessSchema(InterpreterMeSchema) } } }, async (request, reply) => {
    const [profile, settings] = await Promise.all([loadProfile(request.user!.id), readTelehealthSettings(app)]);
    const text = parseConfidentialityText(settings);
    return reply.send(
      ok({
        displayName: profile.displayName,
        languages: profile.languages,
        timeZone: profile.timeZone,
        isActive: profile.isActive,
        twoFactorEnabled: profile.user.twoFactorEnabled,
        confidentiality: {
          accepted: hasCurrentConfidentiality(profile, text),
          acceptedAt: profile.confidentialityAcceptedAt?.toISOString() ?? null,
          version: text.version,
          textEn: text.en,
          textTr: text.tr,
        },
      })
    );
  });

  /** Gizlilik taahhüdü onayı — gönderilen sürüm güncel metnin sürümü olmalı (eski metne onay verilmez). */
  server.post(
    "/confidentiality/accept",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } }, schema: { body: z.object({ version: z.string().min(8).max(64) }).strict(), response: { 204: z.undefined() } } },
    async (request, reply) => {
      const [profile, settings] = await Promise.all([loadProfile(request.user!.id), readTelehealthSettings(app)]);
      const text = parseConfidentialityText(settings);
      if (request.body.version !== text.version) throw new ConflictError("Taahhüt metni güncellendi; lütfen sayfayı yenileyip tekrar okuyun.");
      const acceptedAt = new Date();
      await app.prisma.interpreterProfile.update({ where: { id: profile.id }, data: { confidentialityAcceptedAt: acceptedAt, confidentialityVersion: text.version } });
      await logAudit(app, {
        actorId: request.user!.id,
        actorEmail: request.user!.email,
        action: INTERPRETER_AUDIT.confidentialityAccepted,
        targetType: "InterpreterProfile",
        targetId: profile.id,
        metadata: { version: text.version },
        ipAddress: request.ip,
      });
      return reply.code(204).send();
    }
  );

  server.get("/assignments", { schema: { response: { 200: ApiSuccessSchema(z.array(InterpreterAssignmentSchema)) } } }, async (request, reply) => {
    const profile = await loadProfile(request.user!.id);
    const rows = await app.prisma.appointmentInterpreter.findMany({
      where: { interpreterId: profile.id, status: { in: [...ACTIVE_ASSIGNMENT_STATUSES, "REMOVED"] } },
      include: {
        booking: {
          select: {
            patientName: true,
            paymentStatus: true,
            doctor: { select: { fullName: true, isFounder: true, publicName: true } },
            appointments: { select: { id: true, status: true, startsAt: true, endsAt: true } },
          },
        },
      },
      orderBy: { assignedAt: "desc" },
      take: 200,
    });
    const now = Date.now();
    const items = rows.map((row) => {
      const span = bookingSpan(row.booking.appointments.filter((a) => a.status !== "CANCELLED"));
      const active = ACTIVE_ASSIGNMENT_STATUSES.includes(row.status);
      const joinable = active && pickJoinableAppointment(row.booking) !== null;
      return {
        id: row.id,
        language: row.language,
        languageName: nativeLanguageName(row.language),
        status: row.status,
        startsAt: span?.startsAt.toISOString() ?? null,
        endsAt: span?.endsAt.toISOString() ?? null,
        doctorDisplayName: doctorDisplayName(row.booking.doctor),
        patientInitial: patientInitial(row.booking.patientName),
        canJoin: joinable,
        past: !joinable && (!active || (span ? span.endsAt.getTime() < now : true)),
      };
    });
    items.sort((a, b) => (a.startsAt ?? "").localeCompare(b.startsAt ?? ""));
    return reply.send(ok(items));
  });

  /**
   * Tercüman token'ı. Şartlar: 2FA etkin, profil aktif, güncel taahhüt onayı, aktif atama ve doktorun
   * erişim kuralı (randevu SCHEDULED/IN_PROGRESS + booking ödenmiş). Görüşme bitince/iptal edilince ya
   * da atama kaldırılınca token alınamaz. Tercüman görüşmeyi başlatmaz (randevu durumu değişmez).
   */
  server.post(
    "/assignments/:id/meeting-token",
    {
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
      schema: { params: AssignmentIdParamSchema, response: { 200: ApiSuccessSchema(InterpreterTokenSchema) } },
    },
    async (request, reply) => {
      if (!isLiveKitConfigured()) throw new LiveKitNotConfiguredError();
      const [profile, settings] = await Promise.all([loadProfile(request.user!.id), readTelehealthSettings(app)]);
      if (profile.user.twoFactorEnabled !== true) throw new TwoFactorRequiredError();
      if (!profile.isActive) throw new ForbiddenError("Tercüman hesabı pasif.");
      if (!hasCurrentConfidentiality(profile, parseConfidentialityText(settings))) {
        throw new ForbiddenError("Görüşmeye katılmadan önce gizlilik taahhüdünü onaylayın.");
      }

      const assignment = await app.prisma.appointmentInterpreter.findFirst({
        where: { id: request.params.id, interpreterId: profile.id },
        include: {
          booking: {
            select: {
              id: true,
              meetingRoomName: true,
              paymentStatus: true,
              appointments: { select: { id: true, status: true, startsAt: true, endsAt: true } },
            },
          },
        },
      });
      // Başkasının ataması / bilinmeyen kimlik → 404 (varlık sızdırılmaz).
      if (!assignment) throw new NotFoundError("Atama bulunamadı.");
      if (!ACTIVE_ASSIGNMENT_STATUSES.includes(assignment.status)) throw new AppointmentNotJoinableError();
      const appointment = pickJoinableAppointment(assignment.booking);
      if (!appointment) throw new AppointmentNotJoinableError();

      const roomName = assignment.booking.meetingRoomName;
      try {
        await ensureRoomConfigured(roomName);
      } catch (err) {
        app.log.warn({ err, roomName }, "LiveKit odası önceden yapılandırılamadı (best-effort) — katılım engellenmedi.");
      }
      const identity = buildInterpreterIdentity(profile.id, assignment.booking.id);
      const meeting = await createInterpreterToken({
        roomName,
        identity,
        displayName: interpreterParticipantName(profile.displayName, assignment.language),
        language: assignment.language,
      });

      // Ayrılış kaydı gelmeden yeniden katılım (bağlantı koptu vb.): önceki oturum kapatılır.
      if (assignment.status === "JOINED" && assignment.joinedAt) {
        await logAudit(app, {
          actorId: request.user!.id,
          actorEmail: request.user!.email,
          action: INTERPRETER_AUDIT.left,
          targetType: "AppointmentBooking",
          targetId: assignment.booking.id,
          metadata: {
            assignmentId: assignment.id,
            interpreterId: profile.id,
            bookingId: assignment.booking.id,
            language: assignment.language,
            durationSeconds: Math.max(0, Math.round((Date.now() - assignment.joinedAt.getTime()) / 1000)),
            reason: "rejoin",
          },
          ipAddress: request.ip,
        });
      }

      const sessionId = crypto.randomUUID();
      // Koşullu güncelleme: kontrol ile yazım arasında atama kaldırıldıysa (REMOVED/CANCELLED) ezilmez.
      const joinedRows = await app.prisma.appointmentInterpreter.updateMany({
        where: { id: assignment.id, status: { in: ACTIVE_ASSIGNMENT_STATUSES } },
        data: { status: "JOINED", joinedAt: new Date(), leftAt: null },
      });
      if (joinedRows.count === 0) throw new AppointmentNotJoinableError();
      // Metadata'ya token/URL YAZILMAZ.
      await logAudit(app, {
        actorId: request.user!.id,
        actorEmail: request.user!.email,
        action: INTERPRETER_AUDIT.joined,
        targetType: "AppointmentBooking",
        targetId: assignment.booking.id,
        metadata: { assignmentId: assignment.id, interpreterId: profile.id, bookingId: assignment.booking.id, appointmentId: appointment.id, language: assignment.language, sessionId },
        ipAddress: request.ip,
      });

      return reply.send(ok({ token: meeting.token, serverUrl: meeting.serverUrl, roomName: meeting.roomName, expiresAt: meeting.expiresAt, sessionId }));
    }
  );

  /** Ayrılış — idempotent; yalnızca JOINED iken kayıt yazar (oturum süresiyle). */
  server.post(
    "/assignments/:id/leave",
    { config: { rateLimit: { max: 20, timeWindow: "1 minute" } }, schema: { params: AssignmentIdParamSchema, response: { 204: z.undefined() } } },
    async (request, reply) => {
      const profile = await loadProfile(request.user!.id);
      const assignment = await app.prisma.appointmentInterpreter.findFirst({ where: { id: request.params.id, interpreterId: profile.id } });
      if (!assignment) throw new NotFoundError("Atama bulunamadı.");
      if (assignment.status !== "JOINED") return reply.code(204).send();
      const leftAt = new Date();
      const leftRows = await app.prisma.appointmentInterpreter.updateMany({ where: { id: assignment.id, status: "JOINED" }, data: { status: "LEFT", leftAt } });
      if (leftRows.count === 0) return reply.code(204).send();
      await logAudit(app, {
        actorId: request.user!.id,
        actorEmail: request.user!.email,
        action: INTERPRETER_AUDIT.left,
        targetType: "AppointmentBooking",
        targetId: assignment.bookingId,
        metadata: {
          assignmentId: assignment.id,
          interpreterId: profile.id,
          bookingId: assignment.bookingId,
          language: assignment.language,
          durationSeconds: assignment.joinedAt ? Math.max(0, Math.round((leftAt.getTime() - assignment.joinedAt.getTime()) / 1000)) : 0,
        },
        ipAddress: request.ip,
      });
      return reply.code(204).send();
    }
  );

  /** Kayıt uyarısı için yalnızca durum ("Bu görüşme kaydediliyor"); dosya/bağlantı dönmez. */
  server.get(
    "/assignments/:id/recording-status",
    { schema: { params: AssignmentIdParamSchema, response: { 200: ApiSuccessSchema(z.object({ status: z.string().nullable() })) } } },
    async (request, reply) => {
      const profile = await loadProfile(request.user!.id);
      const assignment = await app.prisma.appointmentInterpreter.findFirst({
        where: { id: request.params.id, interpreterId: profile.id, status: { in: ACTIVE_ASSIGNMENT_STATUSES } },
        select: { booking: { select: { appointments: { select: { id: true } } } } },
      });
      if (!assignment) throw new NotFoundError("Atama bulunamadı.");
      const recording = await app.prisma.consultationRecording.findFirst({
        where: { appointmentId: { in: assignment.booking.appointments.map((a) => a.id) } },
        orderBy: { createdAt: "desc" },
        select: { status: true },
      });
      return reply.send(ok({ status: recording?.status ?? null }));
    }
  );
}

/** Hasta/doktor: randevunun hastası, doktoru ya da geçerli `?t=` (meeting-token ile aynı kural). */
function hasParticipantAccess(
  appointment: { patientUserId: string | null; accessTokenHash: string; doctor: { userId: string | null } },
  request: { user?: { id: string }; providedToken?: string },
  bookingAccessTokenHash?: string | null
): { authorized: boolean; isDoctor: boolean } {
  if (request.user) {
    if (appointment.patientUserId && appointment.patientUserId === request.user.id) return { authorized: true, isDoctor: false };
    if (appointment.doctor.userId && appointment.doctor.userId === request.user.id) return { authorized: true, isDoctor: true };
  }
  if (request.providedToken) {
    const providedHash = hashToken(request.providedToken);
    if (timingSafeEqualHex(providedHash, appointment.accessTokenHash)) return { authorized: true, isDoctor: false };
    if (bookingAccessTokenHash && timingSafeEqualHex(providedHash, bookingAccessTokenHash)) return { authorized: true, isDoctor: false };
  }
  return { authorized: false, isDoctor: false };
}

/** Kök (`/`) altında bağlanır — `/appointments/...` hasta/doktor tarafı tercüman uçları. */
export async function appointmentInterpreterRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>();
  server.addHook("preHandler", requireModuleEnabled("telehealth"));
  server.addHook("preHandler", authenticateOptional);

  async function loadAppointment(id: string) {
    const appointment = await app.prisma.appointment.findUnique({
      where: { id },
      select: {
        id: true,
        bookingId: true,
        patientUserId: true,
        accessTokenHash: true,
        doctor: { select: { userId: true } },
        booking: { select: { accessTokenHash: true, meetingRoomName: true } },
      },
    });
    if (!appointment) throw new NotFoundError("Randevu bulunamadı.");
    return appointment;
  }

  /** Ön-katılım bilgisi ("Bu görüşmeye bir tercüman katılıyor") ve oda içi etiket için. */
  server.get(
    "/appointments/:id/interpreter",
    { config: { rateLimit: { max: 30, timeWindow: "1 minute" } }, schema: { params: AppointmentIdParamSchema, querystring: AccessTokenQuerySchema, response: { 200: ApiSuccessSchema(InterpreterInfoSchema.nullable()) } } },
    async (request, reply) => {
      const appointment = await loadAppointment(request.params.id);
      const { authorized } = hasParticipantAccess(appointment, { user: request.user, providedToken: request.query.t }, appointment.booking?.accessTokenHash);
      if (!authorized) throw new NotFoundError("Randevu bulunamadı.");
      if (!appointment.bookingId) return reply.send(ok(null));
      const active = await app.prisma.appointmentInterpreter.findFirst({
        where: { bookingId: appointment.bookingId, status: { in: ACTIVE_ASSIGNMENT_STATUSES } },
        include: { interpreter: { select: { displayName: true } } },
      });
      if (!active) return reply.send(ok(null));
      return reply.send(
        ok({ language: active.language, languageName: nativeLanguageName(active.language), displayName: active.interpreter.displayName, status: active.status as "ASSIGNED" | "JOINED" | "LEFT" })
      );
    }
  );

  /** Doktor tercümanı görüşmeden çıkarır — atama `REMOVED`, tercüman odadan atılır ve yeni token alamaz. */
  server.post(
    "/appointments/:id/interpreter/remove",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } }, preHandler: authenticate, schema: { params: AppointmentIdParamSchema, response: { 204: z.undefined() } } },
    async (request, reply) => {
      const appointment = await loadAppointment(request.params.id);
      const { authorized, isDoctor } = hasParticipantAccess(appointment, { user: request.user });
      if (!authorized || !isDoctor) throw new NotFoundError("Randevu bulunamadı.");
      if (!appointment.bookingId || !appointment.booking) throw new NotFoundError("Aktif tercüman yok.");
      const active = await app.prisma.appointmentInterpreter.findFirst({ where: { bookingId: appointment.bookingId, status: { in: ACTIVE_ASSIGNMENT_STATUSES } } });
      if (!active) throw new NotFoundError("Aktif tercüman yok.");
      const now = new Date();
      await app.prisma.appointmentInterpreter.update({
        where: { id: active.id },
        data: { status: "REMOVED", removedById: request.user!.id, removedReason: "removed_by_doctor", ...(active.status === "JOINED" ? { leftAt: now } : {}) },
      });
      try {
        const removed = await removeRoomParticipant(appointment.booking.meetingRoomName, buildInterpreterIdentity(active.interpreterId, appointment.bookingId));
        if (!removed) app.log.warn("LIVEKIT_INTERNAL_URL boş — tercüman sunucu tarafında odadan çıkarılamadı; atama kapatıldı, yeni token alamaz.");
      } catch (err) {
        app.log.info({ err }, "Tercüman odadan çıkarılamadı (odada olmayabilir).");
      }
      if (active.status === "JOINED" && active.joinedAt) {
        await logAudit(app, {
          actorId: request.user!.id,
          actorEmail: request.user!.email,
          action: INTERPRETER_AUDIT.left,
          targetType: "AppointmentBooking",
          targetId: appointment.bookingId,
          metadata: {
            assignmentId: active.id,
            interpreterId: active.interpreterId,
            bookingId: appointment.bookingId,
            language: active.language,
            durationSeconds: Math.max(0, Math.round((now.getTime() - active.joinedAt.getTime()) / 1000)),
            reason: "removed_by_doctor",
          },
          ipAddress: request.ip,
        });
      }
      await logAudit(app, {
        actorId: request.user!.id,
        actorEmail: request.user!.email,
        action: INTERPRETER_AUDIT.removedByDoctor,
        targetType: "AppointmentBooking",
        targetId: appointment.bookingId,
        metadata: { assignmentId: active.id, interpreterId: active.interpreterId, appointmentId: appointment.id },
        ipAddress: request.ip,
      });
      return reply.code(204).send();
    }
  );

  /**
   * Hastanın "ücretsiz tercüman istiyorum" talebi — randevu oluşturma kuralını değiştirmez, yalnızca
   * ayrı bir kayıt açar. Yalnızca site ayarında `interpreterIncluded=true` iken kabul edilir.
   */
  server.put(
    "/appointments/bookings/:bookingId/interpreter-request",
    {
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
      schema: {
        params: BookingIdParamSchema,
        querystring: AccessTokenQuerySchema,
        body: z.object({ language: z.string().trim().toLowerCase().regex(LOCALE_CODE_PATTERN, "Geçersiz dil kodu.").nullable() }).strict(),
        response: { 204: z.undefined() },
      },
    },
    async (request, reply) => {
      const booking = await app.prisma.appointmentBooking.findUnique({
        where: { id: request.params.bookingId },
        select: { id: true, patientUserId: true, accessTokenHash: true, doctor: { select: { userId: true } }, appointments: { select: { endsAt: true, status: true } } },
      });
      if (!booking) throw new NotFoundError("Rezervasyon bulunamadı.");
      assertBookingPatientOnlyAccess(booking, { user: request.user, providedToken: request.query.t });
      // Biten / iptal edilen ya da geçmiş rezervasyona talep açılmaz (kaldırma her zaman serbest).
      const open = booking.appointments.some((a) => (a.status === "SCHEDULED" || a.status === "IN_PROGRESS" || a.status === "PENDING_PAYMENT") && a.endsAt.getTime() > Date.now());
      if (request.body.language !== null && !open) throw new ConflictError("Bu randevu için artık tercüman talep edilemez.");

      if (request.body.language === null) {
        await app.prisma.interpreterRequest.deleteMany({ where: { bookingId: booking.id } });
        return reply.code(204).send();
      }
      const support = parseLanguageSupport(await readTelehealthSettings(app));
      if (!support.interpreterIncluded) throw new ConflictError("Tercüman desteği şu anda sunulmuyor.");
      if (support.supportLanguages.length > 0 && !support.supportLanguages.includes(request.body.language)) {
        throw new ValidationError("Bu dilde tercüman desteği yok.", { language: ["Desteklenmeyen dil."] });
      }
      await app.prisma.interpreterRequest.upsert({
        where: { bookingId: booking.id },
        create: { bookingId: booking.id, language: request.body.language },
        update: { language: request.body.language, requestedAt: new Date() },
      });
      await logAudit(app, {
        actorId: request.user?.id ?? null,
        actorEmail: request.user?.email ?? null,
        action: INTERPRETER_AUDIT.requested,
        targetType: "AppointmentBooking",
        targetId: booking.id,
        metadata: { language: request.body.language },
        ipAddress: request.ip,
      });
      return reply.code(204).send();
    }
  );
}

