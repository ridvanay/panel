import crypto from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { authenticate } from "../../middleware/authenticate";
import { requireSiteRole } from "../../middleware/site-rbac";
import { requireModuleEnabled } from "../../middleware/module-guard";
import { ROLES_ADMIN } from "../../lib/site-roles";
import { ok } from "../../lib/envelope";
import { ApiSuccessSchema } from "../../schemas/common";
import { LiveKitNotConfiguredError, NotFoundError, QaListenerNotAllowedError, TwoFactorRequiredError } from "../../lib/errors";
import { logAudit } from "../../lib/audit";
import { createQaListenerToken, isLiveKitConfigured, removeRoomParticipant } from "./lib/livekit";
import { AppointmentIdParamSchema } from "./telehealth.schemas";

/**
 * Paket C (2026-10-18, kullanıcı onaylı kırmızı çizgi istisnası) — ADMIN kalite kontrol dinleyicisi.
 * YENİ YÜZEY = YENİ DOSYA: `telehealth.livekit.routes.ts` (hasta/doktor `meeting-token`) ve
 * `telehealth.admin.routes.ts` DEĞİŞMEZ; bu dosya `app.ts`'de `/admin/telehealth/appointments`
 * prefix'iyle AYRICA kaydedilir.
 *
 * Kayıt modeli: şema/migration YOK — her oturum `AuditLog`'a iki satır olarak yazılır
 * (`joined` + `left`, `metadata.sessionId` ile eşlenir; `targetType+targetId` indeksi mevcut).
 * Giriş anı = token üretimi (admin onay penceresini geçip gerekçe yazdığı an); çıkış anı =
 * istemcinin `leave` çağrısı. `leave` hiç gelmezse (tarayıcı çöktü vb.) geçmişte "çıkış kaydı yok"
 * görünür — dürüst eksiklik, uydurma bir çıkış zamanı yazılmaz.
 */

export const QA_LISTENER_JOINED_ACTION = "telehealth.qa_listener.joined";
export const QA_LISTENER_LEFT_ACTION = "telehealth.qa_listener.left";

const ListenerTokenRequestSchema = z.object({
  reason: z.string().trim().min(10, "Gerekçe en az 10 karakter olmalı.").max(500),
});

const ListenerTokenResponseSchema = z.object({
  token: z.string(),
  serverUrl: z.string(),
  roomName: z.string(),
  expiresAt: z.string(),
  sessionId: z.string().uuid(),
});

const ListenerSessionParamSchema = AppointmentIdParamSchema.extend({ sessionId: z.string().uuid() });

const ListenerHistoryEntrySchema = z.object({
  sessionId: z.string(),
  adminEmail: z.string().nullable(),
  reason: z.string().nullable(),
  joinedAt: z.string(),
  leftAt: z.string().nullable(),
});

type JoinedMetadata = { sessionId?: string; reason?: string; identity?: string; roomName?: string };

function readMetadata(value: unknown): JoinedMetadata {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JoinedMetadata) : {};
}

/** `/admin/telehealth/appointments` prefix'i altında bağlanır — YALNIZCA ADMIN. */
export async function adminTelehealthQaListenerRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>();
  server.addHook("preHandler", requireModuleEnabled("telehealth"));
  server.addHook("preHandler", authenticate);
  server.addHook("preHandler", requireSiteRole(...ROLES_ADMIN));

  /** Katılım ve ayrılış 2FA'sı etkin ADMIN hesabı gerektirir — DB'den taze okunur (oturum sırasında kapatılmış olabilir). */
  async function assertTwoFactorEnabled(userId: string) {
    const user = await app.prisma.user.findUnique({ where: { id: userId }, select: { twoFactorEnabled: true } });
    if (user?.twoFactorEnabled !== true) throw new TwoFactorRequiredError();
  }

  server.post(
    "/:id/listener-token",
    {
      config: { rateLimit: { max: 5, timeWindow: "1 minute" } },
      schema: {
        params: AppointmentIdParamSchema,
        body: ListenerTokenRequestSchema,
        response: { 200: ApiSuccessSchema(ListenerTokenResponseSchema) },
      },
    },
    async (request, reply) => {
      await assertTwoFactorEnabled(request.user!.id);
      if (!isLiveKitConfigured()) throw new LiveKitNotConfiguredError();

      const appointment = await app.prisma.appointment.findUnique({
        where: { id: request.params.id },
        select: { id: true, status: true, meetingRoomName: true, booking: { select: { meetingRoomName: true } } },
      });
      if (!appointment) throw new NotFoundError("Randevu bulunamadı.");
      // Dinleyici bir görüşmeyi BAŞLATAMAZ (SCHEDULED→IN_PROGRESS geçişi yalnızca hasta/doktor
      // `meeting-token`'ında olur) ve biten bir görüşmeye giremez.
      if (appointment.status !== "IN_PROGRESS") throw new QaListenerNotAllowedError();

      // `meeting-token` İLE AYNI oda çözümü — çoklu slot booking'de kanonik oda booking'indir.
      const roomName = appointment.booking ? appointment.booking.meetingRoomName : appointment.meetingRoomName;
      const listener = await createQaListenerToken({ roomName, userId: request.user!.id });
      const sessionId = crypto.randomUUID();

      // Güvenlik notu O-1 — `logAudit` hatayı YUTAR (fail-open); dinleyici kaydı ise ZORUNLU olduğu
      // için doğrudan yazılır: DB yazımı başarısız olursa istek 500 ile düşer ve token istemciye
      // HİÇ dönmez (kayıtsız dinleme yok). `metadata`'ya token/URL YAZILMAZ (lib/audit.ts kuralı).
      await app.prisma.auditLog.create({
        data: {
          actorId: request.user!.id,
          actorEmail: request.user!.email,
          action: QA_LISTENER_JOINED_ACTION,
          status: "SUCCESS",
          targetType: "Appointment",
          targetId: appointment.id,
          metadata: { sessionId, reason: request.body.reason, identity: listener.identity, roomName, tokenExpiresAt: listener.expiresAt },
          ipAddress: request.ip,
        },
      });

      return reply.send(
        ok({ token: listener.token, serverUrl: listener.serverUrl, roomName: listener.roomName, expiresAt: listener.expiresAt, sessionId })
      );
    }
  );

  /**
   * Ayrılış — yalnızca oturumu AÇAN admin kapatabilir (başkasının oturumu → 404). İdempotent: ikinci
   * çağrı (ör. "Ayrıl" + `pagehide`) yeni satır yazmaz. 2FA kontrolü BİLİNÇLİ OLARAK yok: ayrılış
   * kaydı her koşulda yazılabilmeli.
   */
  server.post(
    "/:id/listener-sessions/:sessionId/leave",
    {
      config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
      schema: { params: ListenerSessionParamSchema, response: { 204: z.undefined() } },
    },
    async (request, reply) => {
      const { id, sessionId } = request.params;
      const sessionFilter = { path: ["sessionId"], equals: sessionId };
      const joined = await app.prisma.auditLog.findFirst({
        where: { action: QA_LISTENER_JOINED_ACTION, targetType: "Appointment", targetId: id, actorId: request.user!.id, metadata: sessionFilter },
        select: { createdAt: true, metadata: true },
      });
      if (!joined) throw new NotFoundError("Dinleyici oturumu bulunamadı.");

      const alreadyLeft = await app.prisma.auditLog.findFirst({
        where: { action: QA_LISTENER_LEFT_ACTION, targetType: "Appointment", targetId: id, metadata: sessionFilter },
        select: { id: true },
      });
      if (alreadyLeft) return reply.code(204).send();

      const leftAt = new Date();
      await logAudit(app, {
        actorId: request.user!.id,
        actorEmail: request.user!.email,
        action: QA_LISTENER_LEFT_ACTION,
        targetType: "Appointment",
        targetId: id,
        metadata: { sessionId, durationSeconds: Math.max(0, Math.round((leftAt.getTime() - joined.createdAt.getTime()) / 1000)) },
        ipAddress: request.ip,
      });

      const { roomName, identity } = readMetadata(joined.metadata);
      if (roomName && identity) {
        try {
          const removed = await removeRoomParticipant(roomName, identity);
          if (!removed) app.log.info("LIVEKIT_INTERNAL_URL boş — QA dinleyicisi sunucu tarafında odadan çıkarılmadı (istemci zaten ayrıldı).");
        } catch (err) {
          // Katılımcı zaten ayrılmış olabilir (LiveKit "not found") — kayıt yazıldı, akış bozulmaz.
          app.log.warn({ err }, "QA dinleyicisi odadan sunucu tarafında çıkarılamadı (best-effort).");
        }
      }

      return reply.code(204).send();
    }
  );

  /** Randevu detayındaki "Dinleyici geçmişi" — en yeni oturum önce. */
  server.get(
    "/:id/listener-history",
    {
      schema: { params: AppointmentIdParamSchema, response: { 200: ApiSuccessSchema(z.array(ListenerHistoryEntrySchema)) } },
    },
    async (request, reply) => {
      const rows = await app.prisma.auditLog.findMany({
        where: {
          targetType: "Appointment",
          targetId: request.params.id,
          action: { in: [QA_LISTENER_JOINED_ACTION, QA_LISTENER_LEFT_ACTION] },
        },
        orderBy: { createdAt: "desc" },
        take: 200,
        select: { action: true, actorEmail: true, metadata: true, createdAt: true },
      });

      const leftAtBySession = new Map<string, Date>();
      for (const row of rows) {
        const { sessionId } = readMetadata(row.metadata);
        if (row.action === QA_LISTENER_LEFT_ACTION && sessionId) leftAtBySession.set(sessionId, row.createdAt);
      }

      const entries = rows
        .filter((row) => row.action === QA_LISTENER_JOINED_ACTION)
        .map((row) => {
          const meta = readMetadata(row.metadata);
          const sessionId = meta.sessionId ?? "";
          return {
            sessionId,
            adminEmail: row.actorEmail,
            reason: typeof meta.reason === "string" ? meta.reason : null,
            joinedAt: row.createdAt.toISOString(),
            leftAt: leftAtBySession.get(sessionId)?.toISOString() ?? null,
          };
        });

      return reply.send(ok(entries));
    }
  );
}
