import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { authenticate } from "../../middleware/authenticate";
import { ok } from "../../lib/envelope";
import { ApiSuccessSchema } from "../../schemas/common";
import { AuthResponseSchema, AuthSessionSchema, AuthTokensSchema } from "../../schemas/entities";
import { toUserDto } from "../../mappers";
import { REFRESH_COOKIE_NAME, refreshCookieOptions } from "../../lib/cookies";
import { logAudit } from "../../lib/audit";
import { ForbiddenError, UnauthorizedError } from "../../lib/errors";
import * as authService from "./auth.service";
import {
  ForgotPasswordRequestSchema,
  LoginRequestSchema,
  RegisterRequestSchema,
  ResetPasswordRequestSchema,
} from "./auth.schemas";

const AUTH_RATE_LIMIT = { max: 5, timeWindow: "1 minute" };

export default async function authRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>();

  server.post(
    "/register",
    {
      config: { rateLimit: AUTH_RATE_LIMIT },
      schema: { body: RegisterRequestSchema, response: { 201: ApiSuccessSchema(AuthResponseSchema) } },
    },
    async (request, reply) => {
      const { user, tokens } = await authService.register(app, request.body, {
        userAgent: request.headers["user-agent"],
        ipAddress: request.ip,
      });

      reply.setCookie(REFRESH_COOKIE_NAME, tokens.refreshToken, refreshCookieOptions());
      return reply.code(201).send(
        ok({
          user: toUserDto(user),
          tokens: { accessToken: tokens.accessToken, accessTokenExpiresAt: tokens.accessTokenExpiresAt.toISOString() },
        })
      );
    }
  );

  server.post(
    "/login",
    {
      config: { rateLimit: AUTH_RATE_LIMIT },
      schema: { body: LoginRequestSchema, response: { 200: ApiSuccessSchema(AuthResponseSchema) } },
    },
    async (request, reply) => {
      try {
        const { user, tokens } = await authService.login(app, request.body, {
          userAgent: request.headers["user-agent"],
          ipAddress: request.ip,
        });

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
