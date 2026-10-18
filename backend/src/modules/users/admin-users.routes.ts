import crypto from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { Prisma, type SiteRole, type SiteUserStatus } from "@prisma/client";
import { z } from "zod";
import { authenticate } from "../../middleware/authenticate";
import { requireSiteRole } from "../../middleware/site-rbac";
import { requirePanelAccess } from "../../middleware/panel-access";
import { ROLES_ADMIN } from "../../lib/site-roles";
import { ok } from "../../lib/envelope";
import { ApiSuccessSchema } from "../../schemas/common";
import { AdminUserSchema } from "../../schemas/entities";
import { toAdminUserDto } from "../../mappers";
import {
  AccountAlreadyActiveError,
  ApiError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  StepUpInvalidCodeError,
  StepUpTwoFactorNotEnabledError,
} from "../../lib/errors";
import { parseCursor, buildPageMeta } from "../../lib/pagination";
import { hashPassword } from "../../lib/password";
import { createPasswordResetToken } from "../auth/auth.service";
import { sendPasswordResetEmail } from "../email-templates/email-templates.service";
import { logAudit } from "../../lib/audit";
import { env } from "../../config/env";
import { runSerializable } from "../../lib/serializable-tx";
import { decryptSecret } from "../../lib/crypto";
import { generateOpaqueToken, hashToken } from "../../lib/tokens";
import { verifyTotp } from "../../lib/totp";
import { sendTwoFactorResetNotice } from "../../lib/security-notice-email";
import {
  AdminUserIdParamSchema,
  CreateAdminUserRequestSchema,
  EmailDispatchStatusSchema,
  ListAdminUsersQuerySchema,
  ResetUserTwoFactorRequestSchema,
  SetAdminUserPasswordRequestSchema,
  UpdateAdminUserRoleRequestSchema,
  UpdateAdminUserStatusRequestSchema,
} from "./admin-users.schemas";

const CreateAdminUserResponseSchema = z.object({
  user: AdminUserSchema,
  emailStatus: z.enum(["sent", "failed"]),
});

// Diğer admin uçlarıyla paylaşılan global limitten (env.RATE_LIMIT_MAX) bağımsız, hassas
// kullanıcı yönetimi işlemlerine (oluşturma/rol/durum değişikliği) özel savunma-derinliği
// üst sınırı — bu uçlar zaten requireSiteRole(...ROLES_ADMIN) ile korunuyor, düşük risk ama
// ele geçirilmiş bir admin oturumunun toplu istismarını sınırlar (bkz. security-agent denetimi).
const ADMIN_USERS_RATE_LIMIT = { max: 20, timeWindow: "1 minute" };

/**
 * 2026-10-18 (Paket B1) — 2FA sıfırlama step-up kodu içerir (TOTP tahmin yüzeyi): şifre doğrulayan
 * hassas uçlarla (`SENSITIVE_ACTION_RATE_LIMIT`) AYNI tavan.
 */
const TWO_FACTOR_RESET_RATE_LIMIT = { max: 5, timeWindow: "1 minute" };

/**
 * IP kovası tek başına yetmez (route-level limiter `onRequest`'te, `authenticate`'ten ÖNCE çalışır;
 * aktör id'si henüz bilinmez). Aktör bazlı ikinci kilit: son 15 dakikada aynı admin'in 5 başarısız
 * step-up denemesi varsa yeni deneme kodu doğrulamadan 429 alır. Sayaç audit log'dur (yeni tablo yok).
 */
const STEP_UP_FAILURE_WINDOW_MS = 15 * 60 * 1000;
const STEP_UP_MAX_FAILURES = 5;

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

const SUPPORT_ASSIGNABLE_ROLES: SiteRole[] = ["ADMIN", "MANAGER"];

/**
 * Bug düzeltmesi (2026-09-16, qa-agent raporu) — `support.service.ts::assertValidAssignmentTarget`
 * yalnızca ATAMA ANINDA rolü doğrular; kullanıcı SONRADAN ADMIN/MANAGER'dan düşürülürse
 * `SupportChatSession.assignedAgentId` DB'de kalıcı olarak geçersiz kalıyordu ve
 * `GET /admin/support/sessions` `SupportAgentSummarySchema.role` enum'ına ("ADMIN"|"MANAGER")
 * çarpıp 500 ile çöküyordu (TÜM personel için destek masasını kilitleyen, kendi kendine
 * düzelmeyen bir veri tutarsızlığı — kendi kendini onaramayan DoS). Rol ADMIN/MANAGER'dan
 * ÇIKARILDIĞINDA, o kullanıcıya atanmış tüm oturumların atamasını AYNI (serializable)
 * transaction içinde temizleriz — best-effort değil, atomik: rol değişikliğiyle
 * senkron, yarış durumu yok.
 */
async function clearSupportAssignmentsIfDemoted(
  app: FastifyInstance,
  tx: Prisma.TransactionClient,
  userId: string,
  previousRole: SiteRole,
  nextRole: SiteRole
): Promise<void> {
  const wasAssignable = SUPPORT_ASSIGNABLE_ROLES.includes(previousRole);
  const stillAssignable = SUPPORT_ASSIGNABLE_ROLES.includes(nextRole);
  if (!wasAssignable || stillAssignable) return;

  const { count } = await tx.supportChatSession.updateMany({
    where: { assignedAgentId: userId },
    data: { assignedAgentId: null, assignedAt: null },
  });
  if (count > 0) {
    app.log.warn(
      { userId, previousRole, nextRole, clearedSessionCount: count },
      "support: kullanıcının rolü ADMIN/MANAGER'dan düşürüldü, atanmış destek oturumları otomatik boşaltıldı"
    );
  }
}

/**
 * `/admin/users` prefix'i altında bağlanır (bkz. app.ts).
 * `.claude/architect-scope-rbac-5-tier.md` §5.3 satır 21 — tüm uçlar (okuma dahil) yalnızca
 * ADMIN — (a): MANAGER GET'te de 403 alır (kullanıcı listesi = PII + ayrıcalık yükseltme yüzeyi).
 */
export async function adminUsersRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>();
  server.addHook("preHandler", authenticate);
  server.addHook("preHandler", requirePanelAccess());
  server.addHook("preHandler", requireSiteRole(...ROLES_ADMIN));

  server.get(
    "/",
    { schema: { querystring: ListAdminUsersQuerySchema, response: { 200: ApiSuccessSchema(z.array(AdminUserSchema)) } } },
    async (request, reply) => {
      const { cursor, limit, includeDeleted, search } = request.query;
      const cursorSeq = parseCursor(cursor);

      // Varsayılan olarak `DELETED` kullanıcılar listeden filtrelenir (yumuşak silme —
      // bkz. DELETE /admin/users/{userId}); `includeDeleted=true` ile dahil edilirler.
      const rows = await app.prisma.user.findMany({
        where: {
          ...(cursorSeq ? { seq: { gt: cursorSeq } } : {}),
          ...(includeDeleted ? {} : { status: { not: "DELETED" } }),
          ...(search
            ? { OR: [{ name: { contains: search, mode: "insensitive" } }, { email: { contains: search, mode: "insensitive" } }] }
            : {}),
        },
        orderBy: { seq: "asc" },
        take: limit,
        include: { doctorProfile: { select: { id: true } } },
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

      // backend-agent bulgusu (2026-09-16) — `.claude/architect-scope-guest-account-otp.md` §2.5
      // (bağlayıcı) ile AYNI gerekçe: bir ADMIN'in bir kullanıcı oluşturması, o kullanıcının
      // e-posta sahipliğinin admin tarafından ZATEN vekaleten doğrulandığı anlamına gelir
      // (§2.5'in `resetPassword()`de zaten kabul ettiği ilke — "ADMIN'in oluşturduğu kullanıcılar"
      // AÇIKÇA örnek gösterilmişti, ama bu YOLA hiç uygulanmamıştı). `emailVerifiedAt` BURADA set
      // EDİLMEZSE ve SMTP arızalıysa/e-posta ulaşmazsa: kullanıcı şifresini `forgot-password` ile
      // ALAMAZ (o da SMTP gerektirir) VE aldığında bile `login()` yine `requiresEmailVerification`
      // döner (o da SMTP gerektirir) — çifte SMTP bağımlılığı hesabı KALICI OLARAK kilitler. Doktor
      // hesapları da BU uçtan oluşturulup sonra `DoctorProfile.userId`ye bağlandığı için (bkz.
      // telehealth.admin.routes.ts) bu düzeltme onları da kapsar.
      const user = await app.prisma.user.create({
        data: { name, email: emailLower, passwordHash, role: role ?? "EDITOR", emailVerifiedAt: new Date() },
        include: { doctorProfile: { select: { id: true } } },
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

        const updated = await tx.user.update({
          where: { id: target.id },
          data: { role },
          include: { doctorProfile: { select: { id: true } } },
        });

        await clearSupportAssignmentsIfDemoted(app, tx, target.id, target.role, role);

        return updated;
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

        return tx.user.update({
          where: { id: target.id },
          data: { status },
          include: { doctorProfile: { select: { id: true } } },
        });
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

  /**
   * `PATCH /admin/users/{userId}/password` — Süper Yönetici (ROLES_ADMIN, dosya-geneli hook)
   * hedef kullanıcının şifresini MANUEL belirler. SMTP çalışmadığında (`POST /admin/users`in
   * `emailStatus: "failed"` senaryosu) hesabın kilitli kalmasını çözen çıkış yolu — `assertNotLastActiveAdmin`
   * BURADA GEREKMEZ (şifre değişimi rolü/durumu değiştirmez).
   */
  server.patch(
    "/:userId/password",
    {
      config: { rateLimit: ADMIN_USERS_RATE_LIMIT },
      schema: {
        params: AdminUserIdParamSchema,
        body: SetAdminUserPasswordRequestSchema,
        response: { 200: ApiSuccessSchema(AdminUserSchema) },
      },
    },
    async (request, reply) => {
      const target = await app.prisma.user.findUnique({ where: { id: request.params.userId } });
      if (!target || target.status === "DELETED") throw new NotFoundError("Kullanıcı bulunamadı.");

      const passwordHash = await hashPassword(request.body.password);

      // Admin BAŞKA birinin şifresini değiştiriyor — "bu cihaz hariç" kavramı YOK
      // (`users.routes.ts::/me/change-password` İLE FARKLI, orada kullanıcı KENDİ oturumunu korur).
      // Hedef kullanıcının TÜM refresh token'ları iptal edilir; kullanıcı YENİ şifreyle YENİDEN
      // giriş yapmalıdır.
      const [, user] = await app.prisma.$transaction([
        app.prisma.refreshToken.updateMany({
          where: { userId: target.id, revoked: false },
          data: { revoked: true },
        }),
        app.prisma.user.update({
          where: { id: target.id },
          data: { passwordHash },
          include: { doctorProfile: { select: { id: true } } },
        }),
      ]);

      await logAudit(app, {
        actorId: request.user!.id,
        actorEmail: request.user!.email,
        action: "admin_users.password_reset",
        targetType: "User",
        targetId: user.id,
        metadata: { email: user.email },
        ipAddress: request.ip,
      });

      return reply.send(ok(toAdminUserDto(user)));
    }
  );

  /** 2026-10-18 (Paket B1) — tek kullanıcı; doktor detay sayfası bağlı hesabın 2FA/son giriş durumunu buradan okur. */
  server.get(
    "/:userId",
    { schema: { params: AdminUserIdParamSchema, response: { 200: ApiSuccessSchema(AdminUserSchema) } } },
    async (request, reply) => {
      const user = await app.prisma.user.findUnique({
        where: { id: request.params.userId },
        include: { doctorProfile: { select: { id: true } } },
      });
      if (!user) throw new NotFoundError("Kullanıcı bulunamadı.");
      return reply.send(ok(toAdminUserDto(user)));
    }
  );

  /**
   * 2026-10-18 (Paket B1) — `POST /admin/users/{userId}/2fa/reset`. Yalnızca ADMIN (dosya hook'u),
   * step-up: işlemi yapan ADMIN kendi TOTP kodunu girer. Admin kendi 2FA'sını bu yolla sıfırlayamaz
   * (kendi 2FA'sı için `/admin/settings/security/2fa/disable` şifreyle zaten vardır). Hedefin 2FA
   * alanları + yedek kodları temizlenir ve TÜM refresh token'ları iptal edilir — tek transaction.
   * Doktor portalı `twoFactorEnabled`'ı her istekte DB'den okuduğu için hedef bir sonraki girişte
   * kurulum ekranına düşer (`requireDoctorPortalAccess` → `TWO_FACTOR_REQUIRED`).
   */
  server.post(
    "/:userId/2fa/reset",
    {
      config: { rateLimit: TWO_FACTOR_RESET_RATE_LIMIT },
      schema: {
        params: AdminUserIdParamSchema,
        body: ResetUserTwoFactorRequestSchema,
        response: { 200: ApiSuccessSchema(EmailDispatchStatusSchema.extend({ user: AdminUserSchema })) },
      },
    },
    async (request, reply) => {
      const actorId = request.user!.id;
      const targetId = request.params.userId;
      if (targetId === actorId) {
        throw new ConflictError("Kendi 2FA'nızı bu yolla sıfırlayamazsınız; Güvenlik ayarlarından kapatabilirsiniz.");
      }

      const actor = await app.prisma.user.findUniqueOrThrow({
        where: { id: actorId },
        select: { twoFactorEnabled: true, twoFactorSecret: true },
      });
      if (!actor.twoFactorEnabled || !actor.twoFactorSecret) {
        throw new StepUpTwoFactorNotEnabledError();
      }

      const recentFailures = await app.prisma.auditLog.count({
        where: {
          actorId,
          action: "admin_users.2fa_reset",
          status: "FAILURE",
          createdAt: { gt: new Date(Date.now() - STEP_UP_FAILURE_WINDOW_MS) },
        },
      });
      if (recentFailures >= STEP_UP_MAX_FAILURES) {
        throw new ApiError(429, "RATE_LIMITED", "Çok fazla hatalı doğrulama denemesi. 15 dakika sonra tekrar deneyin.");
      }

      if (!verifyTotp(decryptSecret(actor.twoFactorSecret), request.body.code)) {
        await logAudit(app, {
          actorId,
          actorEmail: request.user!.email,
          action: "admin_users.2fa_reset",
          status: "FAILURE",
          targetType: "User",
          targetId,
          metadata: { reason: "step_up_failed" },
          ipAddress: request.ip,
        });
        throw new StepUpInvalidCodeError();
      }

      const target = await app.prisma.user.findUnique({ where: { id: targetId } });
      if (!target || target.status === "DELETED") throw new NotFoundError("Kullanıcı bulunamadı.");
      // security-review ORTA-2 — ele geçirilmiş bir admin oturumu diğer yöneticilerin 2FA'sını
      // kaldıramasın. Yönetici kendi 2FA'sını yedek kodla/Güvenlik ayarlarından yönetir.
      if (target.role === "ADMIN") {
        throw new ForbiddenError("Başka bir yöneticinin 2FA'sı bu yolla sıfırlanamaz.");
      }
      if (!target.twoFactorEnabled && !target.twoFactorSecret) {
        throw new ConflictError("Bu kullanıcının 2FA'sı zaten kapalı.");
      }

      const resetAt = new Date();
      const [user, , revoked] = await app.prisma.$transaction([
        app.prisma.user.update({
          where: { id: target.id },
          data: { twoFactorEnabled: false, twoFactorSecret: null, twoFactorVerifiedAt: null },
          include: { doctorProfile: { select: { id: true } } },
        }),
        app.prisma.backupCode.deleteMany({ where: { userId: target.id } }),
        app.prisma.refreshToken.updateMany({ where: { userId: target.id, revoked: false }, data: { revoked: true } }),
        // security-review — bekleyen şifre sıfırlama bağlantıları da kapanır (hesap kurtarma yüzeyi sıfırlanır).
        app.prisma.passwordResetToken.updateMany({ where: { userId: target.id, usedAt: null }, data: { usedAt: resetAt } }),
      ]);

      // Best-effort — e-posta gönderilemese de sıfırlama geri alınmaz; admin'e durum döner.
      let emailStatus: "sent" | "failed";
      try {
        await sendTwoFactorResetNotice(app, { email: user.email, name: user.name }, resetAt);
        emailStatus = "sent";
      } catch (err) {
        app.log.error({ err, userId: user.id }, "2FA sıfırlama bilgilendirme e-postası gönderilemedi");
        emailStatus = "failed";
      }

      await logAudit(app, {
        actorId,
        actorEmail: request.user!.email,
        action: "admin_users.2fa_reset",
        targetType: "User",
        targetId: user.id,
        metadata: { email: user.email, revokedSessionCount: revoked.count, isDoctor: user.doctorProfile !== null, emailStatus },
        ipAddress: request.ip,
      });

      return reply.send(ok({ user: toAdminUserDto(user), emailStatus }));
    }
  );

  /**
   * 2026-10-18 (Paket B1) — "Etkinleştirme e-postasını yeniden gönder". Yeni kullanıcı akışındaki
   * (`POST /admin/users`) şifre belirleme bağlantısını yeniden üretir; kullanıcı şifresini kendisi
   * belirler, 2FA'yı da ilk doktor portalı girişinde kendi cihazında kurar. Önceki kullanılmamış
   * bağlantılar geçersiz kılınır (yalnızca en son e-postadaki bağlantı çalışır). Yalnızca hiç giriş
   * yapmamış (`lastLoginAt === null`) hesaplar için — aksi hâlde `409 ACCOUNT_ALREADY_ACTIVE`.
   */
  server.post(
    "/:userId/resend-activation",
    {
      config: { rateLimit: ADMIN_USERS_RATE_LIMIT },
      schema: { params: AdminUserIdParamSchema, response: { 200: ApiSuccessSchema(EmailDispatchStatusSchema) } },
    },
    async (request, reply) => {
      if (request.params.userId === request.user!.id) {
        throw new ConflictError("Kendi hesabınıza etkinleştirme e-postası gönderemezsiniz.");
      }
      const target = await app.prisma.user.findUnique({ where: { id: request.params.userId } });
      if (!target || target.status === "DELETED") throw new NotFoundError("Kullanıcı bulunamadı.");
      if (target.status === "SUSPENDED") throw new ConflictError("Askıya alınmış kullanıcıya etkinleştirme e-postası gönderilemez.");
      // architect kararı — yalnızca HİÇ giriş yapmamış hesaplar: aksi hâlde bu uç ikinci bir
      // "admin tetikli parola sıfırlama" kanalına dönüşürdü (o iş için `PATCH /:userId/password` var).
      if (target.lastLoginAt !== null) throw new AccountAlreadyActiveError();

      // Eski bağlantıların iptali ile yenisinin üretimi TEK transaction'da (yarışta iki geçerli bağlantı kalmasın).
      const rawToken = generateOpaqueToken();
      await app.prisma.$transaction([
        app.prisma.passwordResetToken.updateMany({ where: { userId: target.id, usedAt: null }, data: { usedAt: new Date() } }),
        app.prisma.passwordResetToken.create({
          data: { userId: target.id, tokenHash: hashToken(rawToken), expiresAt: new Date(Date.now() + 60 * 60 * 1000) },
        }),
      ]);
      const setPasswordUrl = `${env.FRONTEND_URL}/reset-password?token=${rawToken}`;

      let emailStatus: "sent" | "failed";
      try {
        await sendPasswordResetEmail(app, { email: target.email, name: target.name }, setPasswordUrl);
        emailStatus = "sent";
      } catch (err) {
        app.log.error({ err, userId: target.id }, "Etkinleştirme (şifre belirleme) e-postası yeniden gönderilemedi");
        emailStatus = "failed";
      }

      await logAudit(app, {
        actorId: request.user!.id,
        actorEmail: request.user!.email,
        action: "admin_users.activation_resend",
        status: emailStatus === "sent" ? "SUCCESS" : "FAILURE",
        targetType: "User",
        targetId: target.id,
        metadata: { email: target.email },
        ipAddress: request.ip,
      });

      return reply.send(ok({ emailStatus }));
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
          include: { doctorProfile: { select: { id: true } } },
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
          include: { doctorProfile: { select: { id: true } } },
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
