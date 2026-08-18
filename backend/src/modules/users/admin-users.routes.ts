import crypto from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { Prisma, type SiteRole, type SiteUserStatus } from "@prisma/client";
import { z } from "zod";
import { authenticate } from "../../middleware/authenticate";
import { requireSiteRole } from "../../middleware/site-rbac";
import { ok } from "../../lib/envelope";
import { ApiSuccessSchema } from "../../schemas/common";
import { AdminUserSchema } from "../../schemas/entities";
import { toAdminUserDto } from "../../mappers";
import { ConflictError, NotFoundError } from "../../lib/errors";
import { parseCursor, buildPageMeta } from "../../lib/pagination";
import { hashPassword } from "../../lib/password";
import { createPasswordResetToken } from "../auth/auth.service";
import { sendPasswordResetEmail } from "../email-templates/email-templates.service";
import { logAudit } from "../../lib/audit";
import { env } from "../../config/env";
import { runSerializable } from "../../lib/serializable-tx";
import {
  AdminUserIdParamSchema,
  CreateAdminUserRequestSchema,
  ListAdminUsersQuerySchema,
  UpdateAdminUserRoleRequestSchema,
  UpdateAdminUserStatusRequestSchema,
} from "./admin-users.schemas";

const CreateAdminUserResponseSchema = z.object({
  user: AdminUserSchema,
  emailStatus: z.enum(["sent", "failed"]),
});

// Diğer admin uçlarıyla paylaşılan global limitten (env.RATE_LIMIT_MAX) bağımsız, hassas
// kullanıcı yönetimi işlemlerine (oluşturma/rol/durum değişikliği) özel savunma-derinliği
// üst sınırı — bu uçlar zaten requireSiteRole("ADMIN") ile korunuyor, düşük risk ama
// ele geçirilmiş bir admin oturumunun toplu istismarını sınırlar (bkz. security-agent denetimi).
const ADMIN_USERS_RATE_LIMIT = { max: 20, timeWindow: "1 minute" };

/**
 * Bir kullanıcının hâlâ en az bir aktif ADMIN'in kalıp kalmayacağını kontrol eder.
 * `excludeUserId` üzerinde işlem yapılan kullanıcıdır (rol/durum değişikliği henüz
 * uygulanmadan önce çağrılır, bu yüzden hedef kullanıcı sayıma dahil edilmez).
 *
 * `tx` parametresi ÖNEMLİ: bu her zaman aşağıdaki `update` ile AYNI Serializable
 * transaction içinde çağrılmalıdır. Aksi halde check (count) ve write (update) ayrı
 * ayrı yürütülür ve iki eşzamanlı istek (ör. iki farklı admin'i aynı anda demote/suspend
 * etmek) TOCTOU (check-then-act) race'i ile sistemde sıfır aktif admin bırakabilir.
 */
async function assertNotLastActiveAdmin(tx: Prisma.TransactionClient, excludeUserId: string): Promise<void> {
  const remainingAdmins = await tx.user.count({
    where: { role: "ADMIN", status: "ACTIVE", id: { not: excludeUserId } },
  });
  if (remainingAdmins === 0) {
    throw new ConflictError("Sistemde en az bir yönetici kalmalı.");
  }
}

/** `/admin/users` prefix'i altında bağlanır (bkz. app.ts) — tüm uçlar yalnızca ADMIN. */
export async function adminUsersRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>();
  server.addHook("preHandler", authenticate);
  server.addHook("preHandler", requireSiteRole("ADMIN"));

  server.get(
    "/",
    { schema: { querystring: ListAdminUsersQuerySchema, response: { 200: ApiSuccessSchema(z.array(AdminUserSchema)) } } },
    async (request, reply) => {
      const { cursor, limit, includeDeleted } = request.query;
      const cursorSeq = parseCursor(cursor);

      // Varsayılan olarak `DELETED` kullanıcılar listeden filtrelenir (yumuşak silme —
      // bkz. DELETE /admin/users/{userId}); `includeDeleted=true` ile dahil edilirler.
      const rows = await app.prisma.user.findMany({
        where: {
          ...(cursorSeq ? { seq: { gt: cursorSeq } } : {}),
          ...(includeDeleted ? {} : { status: { not: "DELETED" } }),
        },
        orderBy: { seq: "asc" },
        take: limit,
      });

      return reply.send(ok(rows.map(toAdminUserDto), buildPageMeta(rows, limit)));
    }
  );

  server.post(
    "/",
    {
      config: { rateLimit: ADMIN_USERS_RATE_LIMIT },
      schema: { body: CreateAdminUserRequestSchema, response: { 201: ApiSuccessSchema(CreateAdminUserResponseSchema) } },
    },
    async (request, reply) => {
      const { name, email, role } = request.body;
      const emailLower = email.toLowerCase();

      // `email` benzersizdir ve yumuşak silme satırı DB'de KORUR (bkz. DELETE /admin/users/{userId}
      // açıklaması) — bu yüzden P2002'nin genel "Bu kayıt zaten mevcut." mesajına düşmeden ÖNCE,
      // hedef e-postanın silinmiş bir kullanıcıya ait olup olmadığını ayırt edip admin'e doğru
      // sonraki adımı (restore) gösteriyoruz.
      const existing = await app.prisma.user.findUnique({ where: { email: emailLower } });
      if (existing) {
        if (existing.status === "DELETED") {
          throw new ConflictError("Bu e-posta silinmiş bir kullanıcıya ait. Önce kullanıcıyı geri alın.");
        }
        throw new ConflictError("Bu e-posta adresi zaten kayıtlı.");
      }

      // Kullanılamaz rastgele bir şifre ile oluşturulur; gerçek şifresini aşağıdaki
      // reset token'ıyla kendisi belirler (bkz. createPasswordResetToken).
      const passwordHash = await hashPassword(crypto.randomBytes(32).toString("hex"));

      const user = await app.prisma.user.create({
        data: { name, email: emailLower, passwordHash, role: role ?? "EDITOR" },
      });

      const rawToken = await createPasswordResetToken(app, user.id);
      const setPasswordUrl = `${env.FRONTEND_URL}/reset-password?token=${rawToken}`;

      // Şifre belirleme bağlantısı ARTIK ne response'ta ne de log'da düz metin dönmez (bkz.
      // security-agent kararı — token sızıntısı temizliği). E-posta gönderimi best-effort'tur:
      // başarısız olursa kullanıcı kaydı GERİ ALINMAZ (admin panelde zaten oluşturulmuş
      // görünür) — admin'e "giriş ekranından 'şifremi unuttum' ile devam edin" denilebilir,
      // bu mevcut `POST /auth/forgot-password` akışını kullanır (ayrı bir "resend" ucu
      // GEREKMEZ, bkz. görev notları).
      let emailStatus: "sent" | "failed";
      try {
        await sendPasswordResetEmail(app, { email: user.email, name: user.name }, setPasswordUrl);
        emailStatus = "sent";
      } catch (err) {
        app.log.error({ err, userId: user.id }, "Yeni kullanıcı için şifre belirleme e-postası gönderilemedi");
        emailStatus = "failed";
      }

      await logAudit(app, {
        actorId: request.user!.id,
        actorEmail: request.user!.email,
        action: "user.create",
        targetType: "User",
        targetId: user.id,
        metadata: { email: user.email, role: user.role },
        ipAddress: request.ip,
      });

      return reply.code(201).send(ok({ user: toAdminUserDto(user), emailStatus }));
    }
  );

  server.patch(
    "/:userId/role",
    {
      config: { rateLimit: ADMIN_USERS_RATE_LIMIT },
      schema: {
        params: AdminUserIdParamSchema,
        body: UpdateAdminUserRoleRequestSchema,
        response: { 200: ApiSuccessSchema(AdminUserSchema) },
      },
    },
    async (request, reply) => {
      const { role } = request.body;
      let previousRole: SiteRole | undefined;

      const user = await runSerializable(app, async (tx) => {
        const target = await tx.user.findUnique({ where: { id: request.params.userId } });
        // `PATCH /status` ile TUTARLI: `DELETED` kullanıcılar var olmayan kayıt gibi davranılır —
        // soft-delete edilmiş (ve varsayılan listede görünmeyen) bir hesabın rolü sessizce
        // yükseltilip/düşürülüp, restore sonrası kimsenin fark etmediği bir ayrıcalık
        // değişikliğiyle geri dönmesini önler (security-agent denetimi, bkz. DELETE
        // /admin/users/{userId} açıklaması). Rol değişikliği için önce restore edilmelidir.
        if (!target || target.status === "DELETED") throw new NotFoundError("Kullanıcı bulunamadı.");
        previousRole = target.role;

        if (target.role === "ADMIN" && role !== "ADMIN") {
          await assertNotLastActiveAdmin(tx, target.id);
        }

        return tx.user.update({ where: { id: target.id }, data: { role } });
      });

      await logAudit(app, {
        actorId: request.user!.id,
        actorEmail: request.user!.email,
        action: "user.role_change",
        targetType: "User",
        targetId: user.id,
        metadata: { from: previousRole, to: role },
        ipAddress: request.ip,
      });

      return reply.send(ok(toAdminUserDto(user)));
    }
  );

  server.patch(
    "/:userId/status",
    {
      config: { rateLimit: ADMIN_USERS_RATE_LIMIT },
      schema: {
        params: AdminUserIdParamSchema,
        body: UpdateAdminUserStatusRequestSchema,
        response: { 200: ApiSuccessSchema(AdminUserSchema) },
      },
    },
    async (request, reply) => {
      if (request.params.userId === request.user!.id) {
        throw new ConflictError("Kendi hesabınızı askıya alamazsınız.");
      }

      const { status } = request.body;
      let previousStatus: SiteUserStatus | undefined;

      const user = await runSerializable(app, async (tx) => {
        const target = await tx.user.findUnique({ where: { id: request.params.userId } });
        // `DELETED` kullanıcılar var olmayan kayıt gibi davranılır — bu uç gövdesi yalnızca
        // `ACTIVE|SUSPENDED` kabul eder, silinmiş bir kullanıcının durumu BURADAN değiştirilemez
        // (geri alma için bkz. POST /admin/users/{userId}/restore).
        if (!target || target.status === "DELETED") throw new NotFoundError("Kullanıcı bulunamadı.");
        previousStatus = target.status;

        if (target.role === "ADMIN" && status === "SUSPENDED") {
          await assertNotLastActiveAdmin(tx, target.id);
        }

        return tx.user.update({ where: { id: target.id }, data: { status } });
      });

      await logAudit(app, {
        actorId: request.user!.id,
        actorEmail: request.user!.email,
        action: "user.status_change",
        targetType: "User",
        targetId: user.id,
        metadata: { from: previousStatus, to: status },
        ipAddress: request.ip,
      });

      return reply.send(ok(toAdminUserDto(user)));
    }
  );

  server.delete(
    "/:userId",
    {
      config: { rateLimit: ADMIN_USERS_RATE_LIMIT },
      schema: {
        params: AdminUserIdParamSchema,
        response: { 200: ApiSuccessSchema(AdminUserSchema) },
      },
    },
    async (request, reply) => {
      if (request.params.userId === request.user!.id) {
        throw new ConflictError("Kendi hesabınızı silemezsiniz.");
      }

      const user = await runSerializable(app, async (tx) => {
        const target = await tx.user.findUnique({ where: { id: request.params.userId } });
        // Silme idempotent DEĞİLDİR — zaten `DELETED` olan bir kullanıcı da 404 döner
        // (bkz. openapi.yaml `DELETE /admin/users/{userId}`).
        if (!target || target.status === "DELETED") throw new NotFoundError("Kullanıcı bulunamadı.");

        if (target.role === "ADMIN" && target.status === "ACTIVE") {
          await assertNotLastActiveAdmin(tx, target.id);
        }

        const deletedAt = new Date();
        const updated = await tx.user.update({
          where: { id: target.id },
          data: { status: "DELETED", deletedAt },
        });

        // Yan etkiler — AYNI Serializable transaction içinde (bkz. openapi.yaml açıklaması):
        // aktif oturumlar anında düşer, bekleyen şifre sıfırlama bağlantıları geçersizleşir.
        await tx.refreshToken.updateMany({
          where: { userId: target.id, revoked: false },
          data: { revoked: true },
        });
        await tx.passwordResetToken.updateMany({
          where: { userId: target.id, usedAt: null },
          data: { usedAt: deletedAt },
        });

        return updated;
      });

      await logAudit(app, {
        actorId: request.user!.id,
        actorEmail: request.user!.email,
        action: "user.delete",
        targetType: "User",
        targetId: user.id,
        metadata: { email: user.email },
        ipAddress: request.ip,
      });

      return reply.send(ok(toAdminUserDto(user)));
    }
  );

  server.post(
    "/:userId/restore",
    {
      config: { rateLimit: ADMIN_USERS_RATE_LIMIT },
      schema: {
        params: AdminUserIdParamSchema,
        response: { 200: ApiSuccessSchema(AdminUserSchema) },
      },
    },
    async (request, reply) => {
      const user = await runSerializable(app, async (tx) => {
        const target = await tx.user.findUnique({ where: { id: request.params.userId } });
        if (!target) throw new NotFoundError("Kullanıcı bulunamadı.");
        if (target.status !== "DELETED") throw new ConflictError("Bu kullanıcı silinmemiş.");

        // Rol silme öncesindeki değeriyle korunur (silme rolü değiştirmez) — bu yüzden burada
        // yalnızca status/deletedAt geri alınır. Oturumlar KASITLI OLARAK geri GELMEZ (bkz.
        // openapi.yaml açıklaması); kullanıcı yeniden giriş yapmalıdır.
        return tx.user.update({
          where: { id: target.id },
          data: { status: "ACTIVE", deletedAt: null },
        });
      });

      await logAudit(app, {
        actorId: request.user!.id,
        actorEmail: request.user!.email,
        action: "user.restore",
        targetType: "User",
        targetId: user.id,
        metadata: { email: user.email },
        ipAddress: request.ip,
      });

      return reply.send(ok(toAdminUserDto(user)));
    }
  );
}
