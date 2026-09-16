import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { env } from "../../config/env";
import { authenticate } from "../../middleware/authenticate";
import { ok } from "../../lib/envelope";
import { ApiSuccessSchema } from "../../schemas/common";
import {
  AuthResponseSchema,
  AuthSessionSchema,
  AuthTokensSchema,
  LoginRequiresTwoFactorSchema,
  LoginRequiresEmailVerificationSchema,
  RegistrationPendingVerificationSchema,
} from "../../schemas/entities";
import { toUserDto } from "../../mappers";
import { REFRESH_COOKIE_NAME, refreshCookieOptions } from "../../lib/cookies";
import { logAudit } from "../../lib/audit";
import { ForbiddenError, UnauthorizedError } from "../../lib/errors";
import { verifyChallengeToken } from "../../lib/jwt";
import { decryptSecret } from "../../lib/crypto";
import { verifyTotp } from "../../lib/totp";
import { hashBackupCode } from "../../lib/backup-codes";
import { VERIFICATION_CODE_RESEND_RATE_LIMIT } from "../../lib/rate-limit";
import * as authService from "./auth.service";
import {
  ActivateAccountRequestSchema,
  ForgotPasswordRequestSchema,
  LoginRequestSchema,
  RegisterRequestSchema,
  ResendVerificationCodeRequestSchema,
  ResetPasswordRequestSchema,
  VerifyEmailRequestSchema,
  VerifyTwoFactorRequestSchema,
} from "./auth.schemas";

// "XXXX-XXXX" biçimli yedek kod deseni (bkz. lib/backup-codes.ts).
const BACKUP_CODE_PATTERN = /^[A-Z0-9]{4}-[A-Z0-9]{4}$/i;

// `max` — bkz. `config/env.ts::AUTH_RATE_LIMIT_MAX` (varsayılan 5, prod/dev'de bugünkü sabit
// değerle BİREBİR AYNI; yalnızca `backend/.env.e2e` test amaçlı yükseltir — security-agent onaylı).
const AUTH_RATE_LIMIT = { max: env.AUTH_RATE_LIMIT_MAX, timeWindow: "1 minute" };

export default async function authRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>();

  server.post(
    "/register",
    {
      config: { rateLimit: AUTH_RATE_LIMIT },
      schema: { body: RegisterRequestSchema, response: { 202: ApiSuccessSchema(RegistrationPendingVerificationSchema) } },
    },
    async (request, reply) => {
      // `.claude/architect-scope-guest-account-otp.md` §2.1 (bağlayıcı) — token/cookie ARTIK
      // VERİLMEZ. Kayıt sonrası kullanıcı `POST /auth/verify-email`e yönlendirilir.
      const result = await authService.register(app, request.body, {
        userAgent: request.headers["user-agent"],
        ipAddress: request.ip,
      });

      return reply.code(202).send(
        ok({
          verificationRequired: true as const,
          email: result.email,
          expiresAt: result.expiresAt.toISOString(),
          resendAvailableAt: result.resendAvailableAt.toISOString(),
        })
      );
    }
  );

  server.post(
    "/login",
    {
      config: { rateLimit: AUTH_RATE_LIMIT },
      schema: {
        body: LoginRequestSchema,
        response: {
          200: ApiSuccessSchema(z.union([AuthResponseSchema, LoginRequiresTwoFactorSchema, LoginRequiresEmailVerificationSchema])),
        },
      },
    },
    async (request, reply) => {
      try {
        const result = await authService.login(app, request.body, {
          userAgent: request.headers["user-agent"],
          ipAddress: request.ip,
        });

        if (result.twoFactorRequired) {
          // Şifre doğru — 2FA doğrulaması bekleniyor. Token/cookie HENÜZ verilmez
          // (bkz. auth.service.ts::login, POST /auth/2fa/verify).
          await logAudit(app, {
            actorId: null,
            actorEmail: request.body.email,
            action: "auth.login",
            status: "SUCCESS",
            metadata: { twoFactorChallenge: true },
            ipAddress: request.ip,
          });

          return reply.send(ok({ requiresTwoFactor: true as const, challengeToken: result.challengeToken }));
        }

        if (result.emailVerificationRequired) {
          // `.claude/architect-scope-guest-account-otp.md` §2.3 (bağlayıcı) — şifre DOĞRU ama
          // e-posta doğrulanmamış. Askıya alınmış hesap dalıyla AYNI desen: FORBIDDEN + reason.
          await logAudit(app, {
            actorId: null,
            actorEmail: request.body.email,
            action: "auth.login",
            status: "FORBIDDEN",
            metadata: { reason: "email_not_verified" },
            ipAddress: request.ip,
          });

          return reply.send(ok({ requiresEmailVerification: true as const, email: result.email }));
        }

        const { user, tokens } = result;

        await logAudit(app, {
          actorId: user.id,
          actorEmail: user.email,
          action: "auth.login",
          status: "SUCCESS",
          ipAddress: request.ip,
        });

        reply.setCookie(REFRESH_COOKIE_NAME, tokens.refreshToken, refreshCookieOptions());
        return reply.send(
          ok({
            user: toUserDto(user),
            tokens: { accessToken: tokens.accessToken, accessTokenExpiresAt: tokens.accessTokenExpiresAt.toISOString() },
          })
        );
      } catch (err) {
        if (err instanceof UnauthorizedError) {
          await logAudit(app, {
            actorId: null,
            actorEmail: request.body.email,
            action: "auth.login",
            status: "FAILURE",
            ipAddress: request.ip,
          });
        } else if (err instanceof ForbiddenError) {
          // Askıya alınmış bir hesapla giriş denemesi (bkz. auth.service.ts::login) — şifre
          // doğruydu ama hesap durumu izin vermedi, bu yüzden yanlış şifre denemelerinden
          // (FAILURE) ayırt edilebilmesi için FORBIDDEN olarak loglanır.
          await logAudit(app, {
            actorId: null,
            actorEmail: request.body.email,
            action: "auth.login",
            status: "FORBIDDEN",
            ipAddress: request.ip,
          });
        }
        throw err;
      }
    }
  );

  // §10.4 Güvenlik & 2FA — login() `requiresTwoFactor` döndürdüğünde bu uç TOTP/backup
  // kodunu doğrulayıp normal login ile AYNI token çiftini üretir (bkz. auth.service.ts::issueTokenPair).
  server.post(
    "/2fa/verify",
    {
      config: { rateLimit: AUTH_RATE_LIMIT },
      schema: { body: VerifyTwoFactorRequestSchema, response: { 200: ApiSuccessSchema(AuthResponseSchema) } },
    },
    async (request, reply) => {
      const { challengeToken, code } = request.body;

      let userId: string;
      try {
        userId = verifyChallengeToken(challengeToken).sub;
      } catch {
        throw new UnauthorizedError("Geçersiz veya süresi dolmuş doğrulama isteği.");
      }

      const user = await app.prisma.user.findUnique({
        where: { id: userId },
        include: { doctorProfile: { select: { id: true } } },
      });
      if (!user || !user.twoFactorEnabled || !user.twoFactorSecret) {
        throw new UnauthorizedError();
      }

      let verified = false;
      if (BACKUP_CODE_PATTERN.test(code)) {
        const codeHash = hashBackupCode(code);
        const backupCode = await app.prisma.backupCode.findFirst({
          where: { userId: user.id, codeHash, usedAt: null },
        });
        if (backupCode) {
          await app.prisma.backupCode.update({ where: { id: backupCode.id }, data: { usedAt: new Date() } });
          verified = true;
        }
      } else {
        verified = verifyTotp(decryptSecret(user.twoFactorSecret), code);
      }

      if (!verified) {
        await logAudit(app, {
          actorId: user.id,
          actorEmail: user.email,
          action: "auth.2fa_verify",
          status: "FAILURE",
          ipAddress: request.ip,
        });
        throw new UnauthorizedError("Geçersiz doğrulama kodu.");
      }

      await app.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
      const tokens = await authService.issueTokenPair(app, user, {
        userAgent: request.headers["user-agent"],
        ipAddress: request.ip,
      });

      await logAudit(app, {
        actorId: user.id,
        actorEmail: user.email,
        action: "auth.login",
        status: "SUCCESS",
        metadata: { via: "2fa" },
        ipAddress: request.ip,
      });

      reply.setCookie(REFRESH_COOKIE_NAME, tokens.refreshToken, refreshCookieOptions());
      return reply.send(
        ok({
          user: toUserDto(user),
          tokens: { accessToken: tokens.accessToken, accessTokenExpiresAt: tokens.accessTokenExpiresAt.toISOString() },
        })
      );
    }
  );

  // `.claude/architect-scope-guest-account-otp.md` §2/§4 (bağlayıcı) — kayıt sonrası (Özellik A)
  // e-posta doğrulaması. Başarıda normal login ile BİREBİR AYNI çıktı: `issueTokenPair` +
  // refresh cookie + `auth.login` audit kaydı (`metadata.via: "email_verification"`).
  server.post(
    "/verify-email",
    {
      config: { rateLimit: AUTH_RATE_LIMIT },
      schema: { body: VerifyEmailRequestSchema, response: { 200: ApiSuccessSchema(AuthResponseSchema) } },
    },
    async (request, reply) => {
      const { user, tokens } = await authService.verifyEmail(app, request.body, {
        userAgent: request.headers["user-agent"],
        ipAddress: request.ip,
      });

      await logAudit(app, {
        actorId: user.id,
        actorEmail: user.email,
        action: "auth.login",
        status: "SUCCESS",
        metadata: { via: "email_verification" },
        ipAddress: request.ip,
      });

      reply.setCookie(REFRESH_COOKIE_NAME, tokens.refreshToken, refreshCookieOptions());
      return reply.send(
        ok({
          user: toUserDto(user),
          tokens: { accessToken: tokens.accessToken, accessTokenExpiresAt: tokens.accessTokenExpiresAt.toISOString() },
        })
      );
    }
  );

  // §3.5 (bağlayıcı) — gövde YALNIZCA `email`; HER koşulda `202` döner (numaralandırma karşıtı
  // disiplin, `forgot-password` İLE AYNI). IP tabanlı `VERIFICATION_CODE_RESEND_RATE_LIMIT`
  // (2/dk) — hedef-başına asıl kısıt (`lib/otp.ts::issueVerificationCode`) DAHA ÖNEMLİDİR.
  server.post(
    "/resend-verification-code",
    {
      config: { rateLimit: VERIFICATION_CODE_RESEND_RATE_LIMIT },
      schema: { body: ResendVerificationCodeRequestSchema, response: { 202: z.undefined() } },
    },
    async (request, reply) => {
      await authService.resendVerificationCode(app, request.body.email);
      return reply.code(202).send();
    }
  );

  // `.claude/architect-scope-guest-account-otp.md` §5/§4.4 (bağlayıcı) — Özellik B'nin kapanış
  // adımı. Başarıda normal login ile BİREBİR AYNI çıktı (`metadata.via: "account_activation"`).
  server.post(
    "/activate-account",
    {
      config: { rateLimit: AUTH_RATE_LIMIT },
      schema: { body: ActivateAccountRequestSchema, response: { 200: ApiSuccessSchema(AuthResponseSchema) } },
    },
    async (request, reply) => {
      const { user, tokens } = await authService.activateAccount(app, request.body, {
        userAgent: request.headers["user-agent"],
        ipAddress: request.ip,
      });

      await logAudit(app, {
        actorId: user.id,
        actorEmail: user.email,
        action: "auth.login",
        status: "SUCCESS",
        metadata: { via: "account_activation" },
        ipAddress: request.ip,
      });

      reply.setCookie(REFRESH_COOKIE_NAME, tokens.refreshToken, refreshCookieOptions());
      return reply.send(
        ok({
          user: toUserDto(user),
          tokens: { accessToken: tokens.accessToken, accessTokenExpiresAt: tokens.accessTokenExpiresAt.toISOString() },
        })
      );
    }
  );

  server.post(
    "/refresh",
    { schema: { response: { 200: ApiSuccessSchema(AuthTokensSchema) } } },
    async (request, reply) => {
      const rawRefreshToken = request.cookies[REFRESH_COOKIE_NAME];
      const tokens = await authService.refresh(app, rawRefreshToken, {
        userAgent: request.headers["user-agent"],
        ipAddress: request.ip,
      });

      reply.setCookie(REFRESH_COOKIE_NAME, tokens.refreshToken, refreshCookieOptions());
      return reply.send(
        ok({ accessToken: tokens.accessToken, accessTokenExpiresAt: tokens.accessTokenExpiresAt.toISOString() })
      );
    }
  );

  server.post("/logout", { schema: { response: { 204: z.undefined() } } }, async (request, reply) => {
    const rawRefreshToken = request.cookies[REFRESH_COOKIE_NAME];
    await authService.logout(app, rawRefreshToken);
    reply.clearCookie(REFRESH_COOKIE_NAME, refreshCookieOptions());
    return reply.code(204).send();
  });

  server.post(
    "/forgot-password",
    {
      config: { rateLimit: AUTH_RATE_LIMIT },
      schema: { body: ForgotPasswordRequestSchema, response: { 202: z.undefined() } },
    },
    async (request, reply) => {
      await authService.forgotPassword(app, request.body.email);
      return reply.code(202).send();
    }
  );

  server.post(
    "/reset-password",
    {
      config: { rateLimit: AUTH_RATE_LIMIT },
      schema: { body: ResetPasswordRequestSchema, response: { 204: z.undefined() } },
    },
    async (request, reply) => {
      await authService.resetPassword(app, request.body.token, request.body.newPassword);
      return reply.code(204).send();
    }
  );

  server.get(
    "/me",
    { preHandler: authenticate, schema: { response: { 200: ApiSuccessSchema(AuthSessionSchema) } } },
    async (request, reply) => {
      const session = await authService.getSession(app, request.user!.id);
      return reply.send(ok(session));
    }
  );
}
