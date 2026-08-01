import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { authenticate } from "../../middleware/authenticate";
import { ok } from "../../lib/envelope";
import { ApiSuccessSchema } from "../../schemas/common";
import { SessionSchema } from "../../schemas/entities";
import { toSessionDto } from "../../mappers";
import { encryptSecret } from "../../lib/crypto";
import { generateSecret, buildOtpauthUrl, verifyTotp, generateQrCodeDataUrl } from "../../lib/totp";
import { generateBackupCodes, hashBackupCode } from "../../lib/backup-codes";
import { signTwoFactorSetupToken, verifyTwoFactorSetupToken } from "../../lib/jwt";
import { verifyPassword } from "../../lib/password";
import { REFRESH_COOKIE_NAME } from "../../lib/cookies";
import { hashToken } from "../../lib/tokens";
import { logAudit } from "../../lib/audit";
import { NotFoundError, UnauthorizedError } from "../../lib/errors";
import { SENSITIVE_ACTION_RATE_LIMIT } from "../../lib/rate-limit";
import {
  SetupTwoFactorResponseSchema,
  EnableTwoFactorRequestSchema,
  EnableTwoFactorResponseSchema,
  DisableTwoFactorRequestSchema,
  RegenerateBackupCodesRequestSchema,
  RegenerateBackupCodesResponseSchema,
  SessionIdParamSchema,
} from "./security.schemas";

/** Eski yedek kodları siler, 10 yeni üretir+hash'ler+kaydeder, düz metinleri döner. */
async function replaceBackupCodes(app: FastifyInstance, userId: string): Promise<string[]> {
  const codes = generateBackupCodes(10);
  await app.prisma.$transaction([
    app.prisma.backupCode.deleteMany({ where: { userId } }),
    app.prisma.backupCode.createMany({
      data: codes.map((code) => ({ userId, codeHash: hashBackupCode(code) })),
    }),
  ]);
  return codes;
}

/**
 * `/admin/settings/security/2fa` prefix'i altında bağlanır (bkz. app.ts) — `authenticate`
 * yeterli, site-rol şartı YOK: herkes yalnızca KENDİ hesabı için 2FA'yı yönetir.
 */
export async function securityTwoFactorRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>();
  server.addHook("preHandler", authenticate);

  server.post(
    "/setup",
    { schema: { response: { 200: ApiSuccessSchema(SetupTwoFactorResponseSchema) } } },
    async (request, reply) => {
      // Yeni secret üretilir ama HENÜZ DB'ye yazılmaz — `/enable` doğrulayana kadar
      // kısa ömürlü `setupToken` içinde taşınır (bkz. lib/jwt.ts::signTwoFactorSetupToken).
      const secret = generateSecret();
      const otpauthUrl = buildOtpauthUrl(secret, request.user!.email);
      const qrCodeDataUrl = await generateQrCodeDataUrl(otpauthUrl);
      const setupToken = signTwoFactorSetupToken(request.user!.id, secret);

      return reply.send(ok({ otpauthUrl, qrCodeDataUrl, setupToken }));
    }
  );

  server.post(
    "/enable",
    {
      schema: { body: EnableTwoFactorRequestSchema, response: { 200: ApiSuccessSchema(EnableTwoFactorResponseSchema) } },
    },
    async (request, reply) => {
      let payload: { sub: string; secret: string };
      try {
        payload = verifyTwoFactorSetupToken(request.body.setupToken);
      } catch {
        throw new UnauthorizedError("Geçersiz veya süresi dolmuş kurulum isteği.");
      }

      if (payload.sub !== request.user!.id) {
        throw new UnauthorizedError("Geçersiz kurulum isteği.");
      }

      if (!verifyTotp(payload.secret, request.body.code)) {
        throw new UnauthorizedError("Geçersiz doğrulama kodu.");
      }

      await app.prisma.user.update({
        where: { id: request.user!.id },
        data: {
          twoFactorEnabled: true,
          twoFactorSecret: encryptSecret(payload.secret),
          twoFactorVerifiedAt: new Date(),
        },
      });

      // Etkinleştirme her zaman yedek kod setini SIFIRLAR (önceki kurulumdan kalan
      // kullanılmamış kodlar varsa geçersiz kılınır).
      const backupCodes = await replaceBackupCodes(app, request.user!.id);

      await logAudit(app, {
        actorId: request.user!.id,
        actorEmail: request.user!.email,
        action: "security.2fa_enable",
        targetType: "User",
        targetId: request.user!.id,
        ipAddress: request.ip,
      });

      return reply.send(ok({ backupCodes }));
    }
  );

  server.post(
    "/disable",
    {
      config: { rateLimit: SENSITIVE_ACTION_RATE_LIMIT },
      schema: { body: DisableTwoFactorRequestSchema, response: { 204: z.undefined() } },
    },
    async (request, reply) => {
      const user = await app.prisma.user.findUnique({ where: { id: request.user!.id } });
      if (!user || !(await verifyPassword(user.passwordHash, request.body.password))) {
        await logAudit(app, {
          actorId: request.user!.id,
          actorEmail: request.user!.email,
          action: "security.2fa_disable",
          status: "FAILURE",
          ipAddress: request.ip,
        });
        throw new UnauthorizedError("Şifre hatalı.");
      }

      const rawRefreshToken = request.cookies[REFRESH_COOKIE_NAME];
      const currentHash = rawRefreshToken ? hashToken(rawRefreshToken) : undefined;

      await app.prisma.$transaction([
        app.prisma.user.update({
          where: { id: user.id },
          data: { twoFactorEnabled: false, twoFactorSecret: null, twoFactorVerifiedAt: null },
        }),
        app.prisma.backupCode.deleteMany({ where: { userId: user.id } }),
        // Mevcut oturum HARİÇ tüm refresh token'lar iptal edilir — 2FA kapatma hassas
        // bir işlem olduğu için diğer cihazlardaki oturumlar zorla sonlandırılır.
        app.prisma.refreshToken.updateMany({
          where: {
            userId: user.id,
            revoked: false,
            ...(currentHash ? { tokenHash: { not: currentHash } } : {}),
          },
          data: { revoked: true },
        }),
      ]);

      await logAudit(app, {
        actorId: user.id,
        actorEmail: user.email,
        action: "security.2fa_disable",
        targetType: "User",
        targetId: user.id,
        ipAddress: request.ip,
      });

      return reply.code(204).send();
    }
  );

  server.post(
    "/backup-codes/regenerate",
    {
      config: { rateLimit: SENSITIVE_ACTION_RATE_LIMIT },
      schema: {
        body: RegenerateBackupCodesRequestSchema,
        response: { 200: ApiSuccessSchema(RegenerateBackupCodesResponseSchema) },
      },
    },
    async (request, reply) => {
      const user = await app.prisma.user.findUnique({ where: { id: request.user!.id } });
      if (!user || !(await verifyPassword(user.passwordHash, request.body.password))) {
        await logAudit(app, {
          actorId: request.user!.id,
          actorEmail: request.user!.email,
          action: "security.2fa_backup_codes_regenerate",
          status: "FAILURE",
          ipAddress: request.ip,
        });
        throw new UnauthorizedError("Şifre hatalı.");
      }
      if (!user.twoFactorEnabled) {
        throw new UnauthorizedError("İki adımlı doğrulama etkin değil.");
      }

      const backupCodes = await replaceBackupCodes(app, user.id);

      await logAudit(app, {
        actorId: user.id,
        actorEmail: user.email,
        action: "security.2fa_backup_codes_regenerate",
        targetType: "User",
        targetId: user.id,
        ipAddress: request.ip,
      });

      return reply.send(ok({ backupCodes }));
    }
  );
}

/**
 * `/admin/settings/security/sessions` prefix'i altında bağlanır (bkz. app.ts) —
 * `authenticate` yeterli, herkes yalnızca KENDİ aktif oturumlarını yönetir.
 */
export async function securitySessionsRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>();
  server.addHook("preHandler", authenticate);

  server.get(
    "/",
    { schema: { response: { 200: ApiSuccessSchema(z.array(SessionSchema)) } } },
    async (request, reply) => {
      const rawRefreshToken = request.cookies[REFRESH_COOKIE_NAME];
      const currentHash = rawRefreshToken ? hashToken(rawRefreshToken) : undefined;

      const rows = await app.prisma.refreshToken.findMany({
        where: { userId: request.user!.id, revoked: false, expiresAt: { gt: new Date() } },
        orderBy: { createdAt: "desc" },
      });

      return reply.send(ok(rows.map((row) => toSessionDto(row, currentHash !== undefined && row.tokenHash === currentHash))));
    }
  );

  server.delete(
    "/:id",
    { schema: { params: SessionIdParamSchema, response: { 204: z.undefined() } } },
    async (request, reply) => {
      const session = await app.prisma.refreshToken.findUnique({ where: { id: request.params.id } });
      if (!session || session.userId !== request.user!.id) {
        throw new NotFoundError("Oturum bulunamadı.");
      }

      await app.prisma.refreshToken.update({ where: { id: session.id }, data: { revoked: true } });

      await logAudit(app, {
        actorId: request.user!.id,
        actorEmail: request.user!.email,
        action: "security.session_revoke",
        targetType: "RefreshToken",
        targetId: session.id,
        ipAddress: request.ip,
      });

      return reply.code(204).send();
    }
  );

  server.post(
    "/revoke-others",
    { schema: { response: { 204: z.undefined() } } },
    async (request, reply) => {
      const rawRefreshToken = request.cookies[REFRESH_COOKIE_NAME];
      const currentHash = rawRefreshToken ? hashToken(rawRefreshToken) : undefined;

      await app.prisma.refreshToken.updateMany({
        where: {
          userId: request.user!.id,
          revoked: false,
          ...(currentHash ? { tokenHash: { not: currentHash } } : {}),
        },
        data: { revoked: true },
      });

      await logAudit(app, {
        actorId: request.user!.id,
        actorEmail: request.user!.email,
        action: "security.session_revoke",
        metadata: { scope: "others" },
        ipAddress: request.ip,
      });

      return reply.code(204).send();
    }
  );
}
