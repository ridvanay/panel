import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { authenticate } from "../../middleware/authenticate";
import { requireSiteRole } from "../../middleware/site-rbac";
import { ROLES_ADMIN } from "../../lib/site-roles";
import { ok } from "../../lib/envelope";
import { ApiSuccessSchema } from "../../schemas/common";
import { logAudit } from "../../lib/audit";
import { verifyPassword } from "../../lib/password";
import { decryptSecret } from "../../lib/crypto";
import { SENSITIVE_ACTION_RATE_LIMIT } from "../../lib/rate-limit";
import { verifyAndConsumeTotp, TOTP_REUSED_MESSAGE } from "../../lib/two-factor";
import { StepUpInvalidCodeError, TwoFactorRequiredError, UnauthorizedError, ValidationError } from "../../lib/errors";
import { STAFF_TWO_FACTOR_MIN_GRACE_DAYS, STAFF_TWO_FACTOR_ROLES, getStaffTwoFactorRequiredAt } from "../../lib/staff-two-factor";

/**
 * Paket G (2026-10-19) — personel (ADMIN/MANAGER) için zorunlu 2FA anahtarı. Genel
 * `PATCH /admin/settings`'e BİLİNÇLİ OLARAK eklenmedi (o şema bu alanı kabul etmez, public
 * `GET /settings` de döndürmez): açma/kapama 2FA'sı etkin ADMIN + şifre + TOTP step-up ister ve
 * audit'lenir. `app.ts`'de `/admin/settings/staff-two-factor` prefix'iyle kaydedilir.
 */

const SETTINGS_ID = "singleton";
const DAY_MS = 24 * 60 * 60 * 1000;

const StaffTwoFactorPolicySchema = z.object({
  requiredAt: z.string().nullable(),
  minGraceDays: z.number().int(),
  staffWithoutTwoFactor: z.array(z.object({ id: z.string(), email: z.string(), role: z.string() })),
});

const UpdateStaffTwoFactorPolicySchema = z.object({
  requiredAt: z.string().datetime().nullable(),
  password: z.string().min(1, "Şifrenizi girin."),
  code: z.string().regex(/^\d{6}$/, "6 haneli doğrulama kodunu girin."),
});

async function readPolicy(app: FastifyInstance) {
  const [requiredAt, staffWithoutTwoFactor] = await Promise.all([
    getStaffTwoFactorRequiredAt(app.prisma),
    app.prisma.user.findMany({
      where: { role: { in: [...STAFF_TWO_FACTOR_ROLES] }, status: "ACTIVE", twoFactorEnabled: false },
      select: { id: true, email: true, role: true },
      orderBy: { email: "asc" },
    }),
  ]);
  return { requiredAt: requiredAt?.toISOString() ?? null, minGraceDays: STAFF_TWO_FACTOR_MIN_GRACE_DAYS, staffWithoutTwoFactor };
}

export async function adminStaffTwoFactorRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>();
  server.addHook("preHandler", authenticate);
  server.addHook("preHandler", requireSiteRole(...ROLES_ADMIN));

  server.get("/", { schema: { response: { 200: ApiSuccessSchema(StaffTwoFactorPolicySchema) } } }, async (_request, reply) => {
    return reply.send(ok(await readPolicy(app)));
  });

  server.put(
    "/",
    {
      config: { rateLimit: SENSITIVE_ACTION_RATE_LIMIT },
      schema: { body: UpdateStaffTwoFactorPolicySchema, response: { 200: ApiSuccessSchema(StaffTwoFactorPolicySchema) } },
    },
    async (request, reply) => {
      const actorId = request.user!.id;
      const actor = await app.prisma.user.findUniqueOrThrow({
        where: { id: actorId },
        select: { passwordHash: true, twoFactorEnabled: true, twoFactorSecret: true },
      });
      // Kilitlenme önlemi — anahtarı yalnızca kendi 2FA'sı etkin bir yönetici değiştirebilir.
      if (!actor.twoFactorEnabled || !actor.twoFactorSecret) throw new TwoFactorRequiredError();

      // Tarih kontrolü step-up'tan ÖNCE — geçersiz tarih yüzünden TOTP kodu boşa tüketilmesin.
      const requiredAt = request.body.requiredAt ? new Date(request.body.requiredAt) : null;
      if (requiredAt && requiredAt.getTime() < Date.now() + STAFF_TWO_FACTOR_MIN_GRACE_DAYS * DAY_MS - 60_000) {
        const message = `Zorunluluk tarihi en az ${STAFF_TWO_FACTOR_MIN_GRACE_DAYS} gün ileride olmalı.`;
        throw new ValidationError(message, { requiredAt: [message] });
      }

      const fail = async (reason: string) =>
        logAudit(app, {
          actorId,
          actorEmail: request.user!.email,
          action: "security.staff_2fa_policy_updated",
          status: "FAILURE",
          metadata: { reason },
          ipAddress: request.ip,
        });

      if (!(await verifyPassword(actor.passwordHash, request.body.password))) {
        await fail("password_invalid");
        throw new UnauthorizedError("Şifre hatalı.");
      }
      const totp = await verifyAndConsumeTotp(app.prisma, actorId, decryptSecret(actor.twoFactorSecret), request.body.code);
      if (totp !== "ok") {
        await fail(totp === "reused" ? "code_reused" : "code_invalid");
        throw totp === "reused" ? new StepUpInvalidCodeError(TOTP_REUSED_MESSAGE) : new StepUpInvalidCodeError();
      }

      const previous = await getStaffTwoFactorRequiredAt(app.prisma);
      await app.prisma.siteSettings.upsert({
        where: { id: SETTINGS_ID },
        create: { id: SETTINGS_ID, staffTwoFactorRequiredAt: requiredAt },
        update: { staffTwoFactorRequiredAt: requiredAt },
      });

      await logAudit(app, {
        actorId,
        actorEmail: request.user!.email,
        action: "security.staff_2fa_policy_updated",
        targetType: "SiteSettings",
        targetId: SETTINGS_ID,
        metadata: { previousRequiredAt: previous?.toISOString() ?? null, requiredAt: requiredAt?.toISOString() ?? null },
        ipAddress: request.ip,
      });

      return reply.send(ok(await readPolicy(app)));
    }
  );
}
