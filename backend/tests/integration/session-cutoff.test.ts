import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { authenticator } from "otplib";

/**
 * Paket G (2026-10-19) — `User.sessionsValidAfter`: 2FA sıfırlama, şifremi unuttum ile sıfırlama
 * ve admin'in şifre belirlemesi anında AÇIK access token'lar da (15 dk dolmadan) geçersiz olur.
 * Damgadan SONRA üretilen token'lar çalışır; damga yoksa davranış değişmez.
 */
const sendMailMock = vi.fn();
vi.mock("../../src/lib/mail", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/lib/mail")>();
  return { ...actual, sendMail: (...args: unknown[]) => sendMailMock(...args) };
});

import { buildTestApp } from "../helpers/build-test-app";
import { resetDatabase } from "../helpers/reset-db";
import { encryptSecret } from "../../src/lib/crypto";
import { hashPassword } from "../../src/lib/password";
import { signAccessToken, signChallengeToken } from "../../src/lib/jwt";
import { jwtPrivateKey } from "../../src/lib/keys";
import { awaitFreshTotpStep } from "../helpers/totp";
import { createPasswordResetToken } from "../../src/modules/auth/auth.service";

const PASSWORD = "Sifre12345!";

describe("Erişim token'ı iptali — sessionsValidAfter (Paket G)", () => {
  let app: FastifyInstance;
  let ipCounter = 0;
  const nextIp = () => {
    ipCounter += 1;
    return `10.50.${Math.floor(ipCounter / 250)}.${(ipCounter % 250) + 1}`;
  };

  async function createUser(role: "USER" | "ADMIN", opts: { twoFactor?: boolean } = {}) {
    const email = `cutoff-${crypto.randomUUID()}@example.com`;
    const secret = authenticator.generateSecret();
    const user = await app.prisma.user.create({
      data: {
        email,
        name: "Test Kullanıcı",
        passwordHash: await hashPassword(PASSWORD),
        role,
        status: "ACTIVE",
        emailVerifiedAt: new Date(),
        ...(opts.twoFactor ? { twoFactorEnabled: true, twoFactorSecret: encryptSecret(secret), twoFactorVerifiedAt: new Date() } : {}),
      },
    });
    return { user, email, secret, token: signAccessToken({ sub: user.id, email }).token };
  }

  function me(token: string) {
    return app.inject({ method: "GET", url: "/api/v1/auth/me", headers: { authorization: `Bearer ${token}` }, remoteAddress: nextIp() });
  }

  beforeAll(async () => {
    app = await buildTestApp();
    await resetDatabase(app.prisma);
    sendMailMock.mockResolvedValue({ messageId: "test" });
  });

  afterAll(async () => {
    await resetDatabase(app.prisma);
    await app.close();
  });

  it("damga yoksa token çalışır; damgadan önce üretilen 401, sonra üretilen 200", async () => {
    const { user, email, token } = await createUser("USER");
    expect((await me(token)).statusCode).toBe(200);

    await new Promise((r) => setTimeout(r, 5));
    await app.prisma.user.update({ where: { id: user.id }, data: { sessionsValidAfter: new Date() } });
    const before = await me(token);
    expect(before.statusCode).toBe(401);
    expect(before.json().error.message).toMatch(/Oturumunuz sonlandırıldı/);

    const fresh = signAccessToken({ sub: user.id, email }).token;
    expect((await me(fresh)).statusCode).toBe(200);
  });

  it("eski (ims claim'siz) token: saniyelik iat ile karşılaştırılır", async () => {
    const { user, email } = await createUser("USER");
    const legacy = jwt.sign({ sub: user.id, email }, jwtPrivateKey, { algorithm: "RS256", expiresIn: 900 });
    expect((await me(legacy)).statusCode).toBe(200);
    await app.prisma.user.update({ where: { id: user.id }, data: { sessionsValidAfter: new Date(Date.now() + 1500) } });
    expect((await me(legacy)).statusCode).toBe(401);
  });

  it("admin 2FA sıfırlaması hedefin açık access token'ını HEMEN düşürür (/2fa/setup dahil)", async () => {
    const admin = await createUser("ADMIN", { twoFactor: true });
    const target = await createUser("USER", { twoFactor: true });
    expect((await me(target.token)).statusCode).toBe(200);

    await awaitFreshTotpStep();
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/admin/users/${target.user.id}/2fa/reset`,
      headers: { authorization: `Bearer ${admin.token}` },
      payload: { code: authenticator.generate(admin.secret) },
      remoteAddress: nextIp(),
    });
    expect(res.statusCode).toBe(200);

    expect((await me(target.token)).statusCode).toBe(401);
    const setup = await app.inject({
      method: "POST",
      url: "/api/v1/admin/settings/security/2fa/setup",
      headers: { authorization: `Bearer ${target.token}` },
      remoteAddress: nextIp(),
    });
    expect(setup.statusCode).toBe(401);
    // Sıfırlamayı yapan admin etkilenmez.
    expect((await me(admin.token)).statusCode).toBe(200);
  });

  it("şifremi unuttum ile sıfırlama açık token'ı düşürür; sıfırlama öncesi alınmış 2FA challenge'ı da geçersiz", async () => {
    const target = await createUser("USER", { twoFactor: true });
    const oldChallenge = signChallengeToken(target.user.id);
    await new Promise((r) => setTimeout(r, 1100));

    const rawToken = await createPasswordResetToken(app, target.user.id);
    const reset = await app.inject({
      method: "POST",
      url: "/api/v1/auth/reset-password",
      payload: { token: rawToken, newPassword: "YeniSifre123!" },
      remoteAddress: nextIp(),
    });
    expect([200, 204]).toContain(reset.statusCode);
    expect((await me(target.token)).statusCode).toBe(401);

    await awaitFreshTotpStep();
    const verify = await app.inject({
      method: "POST",
      url: "/api/v1/auth/2fa/verify",
      payload: { challengeToken: oldChallenge, code: authenticator.generate(target.secret) },
      remoteAddress: nextIp(),
    });
    expect(verify.statusCode).toBe(401);
  });

  it("admin'in şifre belirlemesi hedefin açık token'ını düşürür", async () => {
    const admin = await createUser("ADMIN");
    const target = await createUser("USER");
    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/admin/users/${target.user.id}/password`,
      headers: { authorization: `Bearer ${admin.token}` },
      payload: { password: "YeniSifre123!" },
      remoteAddress: nextIp(),
    });
    expect(res.statusCode).toBe(200);
    expect((await me(target.token)).statusCode).toBe(401);
    expect((await me(admin.token)).statusCode).toBe(200);
  });

  it("şifre değiştirme: 'diğer cihazları hemen kapat' diğer cihazın token'ını düşürür, mevcut oturum yeni token ile sürer", async () => {
    const { user, email } = await createUser("USER");
    const login = async () => {
      const res = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email, password: PASSWORD }, remoteAddress: nextIp() });
      expect(res.statusCode).toBe(200);
      return { access: res.json().data.tokens.accessToken as string, cookie: res.cookies.find((c) => c.name === "refresh_token")!.value };
    };
    const thisDevice = await login();
    const otherDevice = await login();

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/users/me/change-password",
      headers: { authorization: `Bearer ${thisDevice.access}`, cookie: `refresh_token=${thisDevice.cookie}` },
      payload: { currentPassword: PASSWORD, newPassword: "YeniSifre123!", revokeOtherSessions: true },
      remoteAddress: nextIp(),
    });
    expect(res.statusCode).toBe(200);
    const newAccess = res.json().data.accessToken as string;

    expect((await me(otherDevice.access)).statusCode).toBe(401);
    expect((await me(thisDevice.access)).statusCode).toBe(401);
    expect((await me(newAccess)).statusCode).toBe(200);

    // Mevcut cihazın refresh token'ı korunur; diğerininki iptal.
    const refreshThis = await app.inject({ method: "POST", url: "/api/v1/auth/refresh", cookies: { refresh_token: thisDevice.cookie }, remoteAddress: nextIp() });
    expect(refreshThis.statusCode).toBe(200);
    const refreshOther = await app.inject({ method: "POST", url: "/api/v1/auth/refresh", cookies: { refresh_token: otherDevice.cookie }, remoteAddress: nextIp() });
    expect(refreshOther.statusCode).toBe(401);
    const audit = await app.prisma.auditLog.findFirstOrThrow({ where: { action: "security.password_change", targetId: user.id } });
    expect(audit.metadata).toMatchObject({ revokeOtherSessions: true });
  });

  it("şifre değiştirme: seçenek yoksa davranış aynı (204, diğer cihazın access token'ı süresi dolana kadar çalışır)", async () => {
    const { email } = await createUser("USER");
    const tokens = await Promise.all(
      [0, 1].map(async () => {
        const res = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email, password: PASSWORD }, remoteAddress: nextIp() });
        return res.json().data.tokens.accessToken as string;
      })
    );
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/users/me/change-password",
      headers: { authorization: `Bearer ${tokens[0]}` },
      payload: { currentPassword: PASSWORD, newPassword: "YeniSifre123!" },
      remoteAddress: nextIp(),
    });
    expect(res.statusCode).toBe(204);
    expect((await me(tokens[1]!)).statusCode).toBe(200);
  });
});
