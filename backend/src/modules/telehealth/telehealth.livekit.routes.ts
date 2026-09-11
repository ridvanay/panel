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
import { AppointmentIdParamSchema, AccessTokenQuerySchema } from "./telehealth.schemas";
import { isWithinJoinWindow } from "./lib/booking";
import { createMeetingToken, isLiveKitConfigured } from "./lib/livekit";

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
 * §4.5/§8 (bağlayıcı) — token/tamamlama uçlarına yalnızca 4 yoldan biri erişebilir: (a) oturum
 * sahibi hasta, (b) doğru `accessToken`'ı sunan misafir hasta, (c) doktorun bağlı `User`'ı,
 * (d) `SiteRole.ADMIN` — **MANAGER DAHİL DEĞİL** (görev talimatı §4.5'in birebir okunuşu;
 * `telehealth.routes.ts::assertAppointmentAccess`'teki genel randevu görüntüleme/iptal ADMIN+MANAGER
 * eşiğiyle KARIŞTIRILMAMALI — bu, ayrı ve daha dar bir yetki yüzeyidir). IDOR: yetkisiz erişim
 * `404` döner (randevunun varlığı SIZDIRILMAZ), `403` DEĞİL — `telehealth.routes.ts` İLE AYNI disiplin.
 */
function isAuthorizedForMeetingAccess(
  appointment: AppointmentAccessSubject,
  request: { user?: { id: string; role: string }; providedToken?: string }
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
  if (request.providedToken && timingSafeEqualHex(hashToken(request.providedToken), appointment.accessTokenHash)) {
    return { authorized: true, isDoctor: false };
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

      const appointment = await app.prisma.appointment.findUnique({
        where: { id: request.params.id },
        include: WITH_APPOINTMENT_DOCTOR,
      });
      if (!appointment) throw new NotFoundError("Randevu bulunamadı.");

      const { authorized, isDoctor } = isAuthorizedForMeetingAccess(appointment, {
        user: request.user,
        providedToken: request.query.t,
      });
      if (!authorized) throw new NotFoundError("Randevu bulunamadı.");

      if (appointment.status !== "SCHEDULED" && appointment.status !== "IN_PROGRESS") {
        throw new AppointmentNotJoinableError();
      }
      if (!isWithinJoinWindow(new Date(), appointment.startsAt, appointment.endsAt)) {
        throw new AppointmentNotJoinableError();
      }

      const meeting = await createMeetingToken({
        roomName: appointment.meetingRoomName,
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

      const updated = await app.prisma.appointment.update({
        where: { id: appointment.id },
        data: { status: "COMPLETED", endedAt: new Date() },
        include: { doctor: { select: { id: true, title: true, fullName: true, slug: true } } },
      });

      return reply.send(ok(toAppointmentDto(updated)));
    }
  );
}
