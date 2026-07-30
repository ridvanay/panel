import type { FastifyInstance } from "fastify";
import type { User } from "@prisma/client";
import { hashPassword, verifyPassword } from "../../lib/password";
import { generateOpaqueToken, hashToken } from "../../lib/tokens";
import { signAccessToken } from "../../lib/jwt";
import { ConflictError, UnauthorizedError, NotFoundError } from "../../lib/errors";
import { toUserDto } from "../../mappers";
import { env } from "../../config/env";

interface RequestMeta {
  userAgent?: string;
  ipAddress?: string;
}

interface TokenIssue {
  accessToken: string;
  accessTokenExpiresAt: Date;
  refreshToken: string;
}

async function issueTokenPair(app: FastifyInstance, user: User, meta: RequestMeta): Promise<TokenIssue> {
  const { token: accessToken, expiresAt: accessTokenExpiresAt } = signAccessToken({
    sub: user.id,
    email: user.email,
  });

  const refreshToken = generateOpaqueToken();
  const expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);

  await app.prisma.refreshToken.create({
    data: {
      userId: user.id,
      tokenHash: hashToken(refreshToken),
      expiresAt,
      userAgent: meta.userAgent,
      ipAddress: meta.ipAddress,
    },
  });

  return { accessToken, accessTokenExpiresAt, refreshToken };
}

export async function register(
  app: FastifyInstance,
  input: { email: string; password: string; name: string },
  meta: RequestMeta
) {
  const email = input.email.toLowerCase();
  const existing = await app.prisma.user.findUnique({ where: { email } });
  if (existing) {
    throw new ConflictError("Bu e-posta adresi zaten kayıtlı.");
  }

  const passwordHash = await hashPassword(input.password);
  const user = await app.prisma.user.create({
    data: { email, passwordHash, name: input.name },
  });

  const tokens = await issueTokenPair(app, user, meta);
  return { user, tokens };
}

export async function login(app: FastifyInstance, input: { email: string; password: string }, meta: RequestMeta) {
  const user = await app.prisma.user.findUnique({ where: { email: input.email.toLowerCase() } });
  // E-posta ve şifre hatalarını ayırt etmiyoruz: hangi alanın yanlış olduğunu sızdırmamak için.
  if (!user || !(await verifyPassword(user.passwordHash, input.password))) {
    throw new UnauthorizedError("E-posta veya şifre hatalı.");
  }

  const tokens = await issueTokenPair(app, user, meta);
  return { user, tokens };
}

export async function refresh(app: FastifyInstance, rawRefreshToken: string | undefined, meta: RequestMeta) {
  if (!rawRefreshToken) {
    throw new UnauthorizedError("Refresh token bulunamadı.");
  }

  const tokenHash = hashToken(rawRefreshToken);
  const existing = await app.prisma.refreshToken.findUnique({ where: { tokenHash } });

  if (!existing) {
    throw new UnauthorizedError("Geçersiz refresh token.");
  }

  if (existing.revoked) {
    // Zaten iptal edilmiş bir token tekrar kullanılmaya çalışıldı — çalıntı token belirtisi.
    // Önlem: kullanıcının tüm oturumlarını sonlandır.
    await app.prisma.refreshToken.updateMany({
      where: { userId: existing.userId, revoked: false },
      data: { revoked: true },
    });
    throw new UnauthorizedError("Oturum güvenlik nedeniyle sonlandırıldı, lütfen tekrar giriş yapın.");
  }

  if (existing.expiresAt.getTime() < Date.now()) {
    throw new UnauthorizedError("Refresh token süresinin dolmuş.");
  }

  const user = await app.prisma.user.findUnique({ where: { id: existing.userId } });
  if (!user) {
    throw new UnauthorizedError();
  }

  const { token: accessToken, expiresAt: accessTokenExpiresAt } = signAccessToken({
    sub: user.id,
    email: user.email,
  });
  const newRefreshToken = generateOpaqueToken();
  const newExpiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
  const newTokenHash = hashToken(newRefreshToken);

  await app.prisma.$transaction([
    app.prisma.refreshToken.update({
      where: { id: existing.id },
      data: { revoked: true, replacedByTokenHash: newTokenHash },
    }),
    app.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: newTokenHash,
        expiresAt: newExpiresAt,
        userAgent: meta.userAgent,
        ipAddress: meta.ipAddress,
      },
    }),
  ]);

  return { accessToken, accessTokenExpiresAt, refreshToken: newRefreshToken };
}

export async function logout(app: FastifyInstance, rawRefreshToken: string | undefined) {
  if (!rawRefreshToken) return;
  const tokenHash = hashToken(rawRefreshToken);
  await app.prisma.refreshToken.updateMany({
    where: { tokenHash, revoked: false },
    data: { revoked: true },
  });
}

export async function forgotPassword(app: FastifyInstance, email: string) {
  const user = await app.prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  // Kullanıcı yoksa sessizce çık — e-posta enumeration'ı önlemek için route her zaman 202 döner.
  if (!user) return;

  const rawToken = generateOpaqueToken();
  await app.prisma.passwordResetToken.create({
    data: {
      userId: user.id,
      tokenHash: hashToken(rawToken),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    },
  });

  // TODO(email-provider): Resend/SES entegre edilene kadar bağlantı sadece loglanır.
  app.log.info(
    { resetUrl: `${env.FRONTEND_URL}/reset-password?token=${rawToken}` },
    "Şifre sıfırlama bağlantısı (e-posta sağlayıcısı bağlanana kadar dev-log)"
  );
}

export async function resetPassword(app: FastifyInstance, rawToken: string, newPassword: string) {
  const tokenHash = hashToken(rawToken);
  const resetToken = await app.prisma.passwordResetToken.findUnique({ where: { tokenHash } });

  if (!resetToken || resetToken.usedAt || resetToken.expiresAt.getTime() < Date.now()) {
    throw new UnauthorizedError("Geçersiz veya süresi dolmuş sıfırlama bağlantısı.");
  }

  const passwordHash = await hashPassword(newPassword);

  await app.prisma.$transaction([
    app.prisma.user.update({ where: { id: resetToken.userId }, data: { passwordHash } }),
    app.prisma.passwordResetToken.update({ where: { id: resetToken.id }, data: { usedAt: new Date() } }),
    app.prisma.refreshToken.updateMany({
      where: { userId: resetToken.userId, revoked: false },
      data: { revoked: true },
    }),
  ]);
}

export async function getSession(app: FastifyInstance, userId: string) {
  const user = await app.prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    throw new NotFoundError("Kullanıcı bulunamadı.");
  }

  const memberships = await app.prisma.membership.findMany({
    where: { userId, status: "ACTIVE" },
    select: { organizationId: true, role: true },
  });

  return { user: toUserDto(user), memberships };
}
