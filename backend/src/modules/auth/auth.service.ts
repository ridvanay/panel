import type { FastifyInstance } from "fastify";
import type { User } from "@prisma/client";
import { hashPassword, verifyPassword } from "../../lib/password";
import { generateOpaqueToken, hashToken } from "../../lib/tokens";
import { signAccessToken, signChallengeToken } from "../../lib/jwt";
import { ConflictError, UnauthorizedError, NotFoundError, ForbiddenError } from "../../lib/errors";
import { toUserDto } from "../../mappers";
import { env } from "../../config/env";

interface RequestMeta {
  userAgent?: string;
  ipAddress?: string;
}

export interface TokenIssue {
  accessToken: string;
  accessTokenExpiresAt: Date;
  refreshToken: string;
}

/** `login()` (şifre doğru + 2FA kapalı) ve `POST /auth/2fa/verify` (2FA doğrulandıktan sonra) tarafından paylaşılır. */
export async function issueTokenPair(app: FastifyInstance, user: User, meta: RequestMeta): Promise<TokenIssue> {
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

  // Sıfırdan kurulan bir ortamda ilk kayıt olan kullanıcı otomatik ADMIN olur —
  // aksi halde `/admin/*` uçlarına erişebilecek hiç kimse olmaz (kilitlenme).
  const userCount = await app.prisma.user.count();

  const passwordHash = await hashPassword(input.password);
  const user = await app.prisma.user.create({
    data: { email, passwordHash, name: input.name, role: userCount === 0 ? "ADMIN" : undefined },
  });

  const tokens = await issueTokenPair(app, user, meta);
  return { user, tokens };
}

/** §10.4 Güvenlik & 2FA — `login()`'ün 2FA açık/kapalı iki farklı sonucunu ayırt eden discriminated union. */
export type LoginResult =
  | { twoFactorRequired: true; challengeToken: string }
  | { twoFactorRequired: false; user: User; tokens: TokenIssue };

export async function login(
  app: FastifyInstance,
  input: { email: string; password: string },
  meta: RequestMeta
): Promise<LoginResult> {
  const user = await app.prisma.user.findUnique({ where: { email: input.email.toLowerCase() } });
  // E-posta ve şifre hatalarını ayırt etmiyoruz: hangi alanın yanlış olduğunu sızdırmamak için.
  if (!user || !(await verifyPassword(user.passwordHash, input.password))) {
    throw new UnauthorizedError("E-posta veya şifre hatalı.");
  }

  // `authenticate()`/`refresh()` zaten SUSPENDED kullanıcıları reddediyor (bkz. middleware/authenticate.ts),
  // yani askıya alınmış biri buradan geçse bile hiçbir korumalı uca erişemez. Ama burada erken
  // reddetmezsek: (a) kullanıcıya kafa karıştırıcı şekilde "giriş başarılı, tokenlar alındı" izlenimi
  // verilip bir sonraki istekte 403 ile karşılaşılır, (b) kullanılamayacak bir refresh token DB'ye
  // yazılır, (c) audit log'da askıya alınmış bir hesap için yanıltıcı bir "auth.login SUCCESS" kaydı
  // oluşur. Bu yüzden aynı mesajla (authenticate.ts ile tutarlı) burada da erken reddediyoruz.
  if (user.status === "SUSPENDED") {
    throw new ForbiddenError("Hesabınız askıya alınmış.");
  }

  // §10.4: 2FA açıksa şifre doğru olsa bile token çifti HEMEN verilmez — önce
  // POST /auth/2fa/verify ile TOTP/backup kodu doğrulanmalı (bkz. modules/security).
  if (user.twoFactorEnabled) {
    const challengeToken = signChallengeToken(user.id);
    return { twoFactorRequired: true, challengeToken };
  }

  await app.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

  const tokens = await issueTokenPair(app, user, meta);
  return { twoFactorRequired: false, user, tokens };
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
  if (user.status === "SUSPENDED") {
    throw new ForbiddenError("Hesabınız askıya alınmış.");
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

/**
 * Şifre sıfırlama token'ı üretir ve DB'ye (hash'lenmiş) kaydeder. `forgotPassword`
 * (kullanıcı kendi başlatır) ve admin-users modülündeki yeni kullanıcı oluşturma akışı
 * (admin başlatır, kullanıcı ilk şifresini böyle belirler) bu fonksiyonu paylaşır.
 */
export async function createPasswordResetToken(app: FastifyInstance, userId: string): Promise<string> {
  const rawToken = generateOpaqueToken();
  await app.prisma.passwordResetToken.create({
    data: {
      userId,
      tokenHash: hashToken(rawToken),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    },
  });
  return rawToken;
}

export async function forgotPassword(app: FastifyInstance, email: string) {
  const user = await app.prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  // Kullanıcı yoksa sessizce çık — e-posta enumeration'ı önlemek için route her zaman 202 döner.
  if (!user) return;

  const rawToken = await createPasswordResetToken(app, user.id);

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
