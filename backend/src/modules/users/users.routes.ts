import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { authenticate } from "../../middleware/authenticate";
import { ok } from "../../lib/envelope";
import { ApiSuccessSchema } from "../../schemas/common";
import { UserSchema } from "../../schemas/entities";
import { toUserDto } from "../../mappers";
import { NotFoundError, UnauthorizedError, ValidationError } from "../../lib/errors";
import { hashPassword, verifyPassword } from "../../lib/password";
import { REFRESH_COOKIE_NAME } from "../../lib/cookies";
import { hashToken } from "../../lib/tokens";
import { logAudit } from "../../lib/audit";
import { SENSITIVE_ACTION_RATE_LIMIT } from "../../lib/rate-limit";
import { UpdateUserRequestSchema, ChangePasswordRequestSchema } from "./users.schemas";

export default async function usersRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>();
  server.addHook("preHandler", authenticate);

  server.get("/me", { schema: { response: { 200: ApiSuccessSchema(UserSchema) } } }, async (request, reply) => {
    const user = await app.prisma.user.findUnique({ where: { id: request.user!.id } });
    if (!user) throw new NotFoundError("Kullanıcı bulunamadı.");
    return reply.send(ok(toUserDto(user)));
  });

  server.patch(
    "/me",
    { schema: { body: UpdateUserRequestSchema, response: { 200: ApiSuccessSchema(UserSchema) } } },
    async (request, reply) => {
      const user = await app.prisma.user.update({
        where: { id: request.user!.id },
        data: request.body,
      });
      return reply.send(ok(toUserDto(user)));
    }
  );

  // Site-rol şartı YOK — herkes yalnızca KENDİ şifresini değiştirir (bkz. openapi.yaml
  // /users/me/change-password ve architect-scope-toast-and-account.md §3.2).
  server.post(
    "/me/change-password",
    {
      config: { rateLimit: SENSITIVE_ACTION_RATE_LIMIT },
      schema: { body: ChangePasswordRequestSchema, response: { 204: z.undefined() } },
    },
    async (request, reply) => {
      const user = await app.prisma.user.findUnique({ where: { id: request.user!.id } });
      if (!user || !(await verifyPassword(user.passwordHash, request.body.currentPassword))) {
        await logAudit(app, {
          actorId: request.user!.id,
          actorEmail: request.user!.email,
          action: "security.password_change",
          status: "FAILURE",
          ipAddress: request.ip,
        });
        // Mesaj `/2fa/disable` ile birebir aynı — bilgi sızdırmama + terminoloji birliği.
        throw new UnauthorizedError("Şifre hatalı.");
      }

      if (request.body.newPassword === request.body.currentPassword) {
        throw new ValidationError("Yeni şifre mevcut şifreden farklı olmalı.", {
          newPassword: ["Yeni şifre mevcut şifreden farklı olmalı."],
        });
      }

      // argon2 async olduğu için hash'i transaction DIŞINDA hesaplıyoruz.
      const passwordHash = await hashPassword(request.body.newPassword);

      const rawRefreshToken = request.cookies[REFRESH_COOKIE_NAME];
      const currentHash = rawRefreshToken ? hashToken(rawRefreshToken) : undefined;

      await app.prisma.$transaction([
        app.prisma.user.update({
          where: { id: user.id },
          data: { passwordHash },
        }),
        // Mevcut oturum HARİÇ tüm refresh token'lar iptal edilir — `/2fa/disable` ile
        // birebir tutarlı politika (bkz. security.routes.ts:138-153).
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
        action: "security.password_change",
        targetType: "User",
        targetId: user.id,
        ipAddress: request.ip,
      });

      return reply.code(204).send();
    }
  );
}
