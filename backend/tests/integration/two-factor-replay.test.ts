import crypto from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { authenticator } from "otplib";
import { buildTestApp } from "../helpers/build-test-app";
import { resetDatabase } from "../helpers/reset-db";
import { encryptSecret } from "../../src/lib/crypto";
import { hashPassword } from "../../src/lib/password";
import { hashBackupCode } from "../../src/lib/backup-codes";
import { matchTotpStep, TOTP_STEP_MS } from "../../src/lib/totp";
import { signAccessToken, signTwoFactorSetupToken } from "../../src/lib/jwt";

/**
 * Paket G (2026-10-19) — TOTP tekrar kullanım koruması (`twoFactorLastUsedStep`) ve yedek kod
 * tüketiminin atomikliği. Giriş 2FA adımı, admin step-up ve `/2fa/enable` aynı korumayı paylaşır.
 */

const PASSWORD = "Sifre12345!";

/** Pencere 0 olduğu için kod adım sınırında geçersizleşebilir — sınıra 4 sn'den az kaldıysa sonraki adımı bekle. */
async function awaitFreshTotpStep() {
  const remaining = TOTP_STEP_MS - (Date.now() % TOTP_STEP_MS);
  if (remaining < 4000) await new Promise((r) => setTimeout(r, remaining + 50));
}

describe("TOTP tekrar kullanımı ve yedek kod yarışı (Paket G)", () => {
  let app: FastifyInstance;

  async function createTwoFactorUser(role: "USER" | "ADMIN" = "USER") {
    const email = `totp-${crypto.randomUUID()}@example.com`;
    const secret = authenticator.generateSecret();
    const user = await app.prisma.user.create({
      data: {
        email,
        name: "TOTP Kullanıcı",
        passwordHash: await hashPassword(PASSWORD),
        role,
        status: "ACTIVE",
        emailVerifiedAt: new Date(),
        twoFactorEnabled: true,
        twoFactorSecret: encryptSecret(secret),
        twoFactorVerifiedAt: new Date(),
      },
    });
    return { user, email, secret };
  }

  async function challengeFor(email: string): Promise<string> {
    const res = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email, password: PASSWORD }, remoteAddress: nextIp() });
    expect(res.statusCode).toBe(200);
    const challengeToken = res.json().data.challengeToken as string | undefined;
    expect(challengeToken).toBeTruthy();
    return challengeToken!;
  }

  function verify(challengeToken: string, code: string) {
    return app.inject({ method: "POST", url: "/api/v1/auth/2fa/verify", payload: { challengeToken, code }, remoteAddress: nextIp() });
  }

  let ipCounter = 0;
  function nextIp() {
    ipCounter += 1;
    return `10.40.${Math.floor(ipCounter / 250)}.${(ipCounter % 250) + 1}`;
  }

  beforeAll(async () => {
    app = await buildTestApp();
    await resetDatabase(app.prisma);
  });

  afterAll(async () => {
    await resetDatabase(app.prisma);
    await app.close();
  });

  it("matchTotpStep — doğru kod o anki adımı döndürür, yanlış kod null (pencere 0)", () => {
    const secret = authenticator.generateSecret();
    const now = Date.now();
    const code = authenticator.clone({ epoch: now }).generate(secret);
    expect(matchTotpStep(secret, code, now)).toBe(Math.floor(now / TOTP_STEP_MS));
    expect(matchTotpStep(secret, code, now + 2 * TOTP_STEP_MS)).toBeNull();
    expect(matchTotpStep(secret, "000000" === code ? "111111" : "000000", now)).toBeNull();
  });

  it("giriş: aynı kod ikinci kez kullanılamaz (401, 'az önce kullanıldı'); adım kaydedilir", async () => {
    const { user, email, secret } = await createTwoFactorUser();
    await awaitFreshTotpStep();
    const code = authenticator.generate(secret);

    expect((await verify(await challengeFor(email), code)).statusCode).toBe(200);
    const again = await verify(await challengeFor(email), code);
    expect(again.statusCode).toBe(401);
    expect(again.json().error.message).toMatch(/az önce kullanıldı/);

    const stored = await app.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(stored.twoFactorLastUsedStep).toBe(Math.floor(Date.now() / TOTP_STEP_MS));
  });

  it("giriş: aynı kodla eşzamanlı iki doğrulamadan YALNIZCA biri başarılı", async () => {
    const { email, secret } = await createTwoFactorUser();
    const [c1, c2] = [await challengeFor(email), await challengeFor(email)];
    await awaitFreshTotpStep();
    const code = authenticator.generate(secret);
    const results = await Promise.all([verify(c1, code), verify(c2, code)]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 401]);
  });

  it("yedek kod: eşzamanlı iki kullanımdan YALNIZCA biri başarılı, ikinci kez kullanılamaz", async () => {
    const { user, email } = await createTwoFactorUser();
    await app.prisma.backupCode.create({ data: { userId: user.id, codeHash: hashBackupCode("ABCD-EFGH") } });
    const [c1, c2] = [await challengeFor(email), await challengeFor(email)];
    const results = await Promise.all([verify(c1, "ABCD-EFGH"), verify(c2, "ABCD-EFGH")]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 401]);
    expect((await verify(await challengeFor(email), "ABCD-EFGH")).statusCode).toBe(401);
  });

  it("admin step-up: girişte kullanılan kod 2FA sıfırlama onayında yeniden kullanılamaz", async () => {
    const admin = await createTwoFactorUser("ADMIN");
    const target = await createTwoFactorUser("USER");
    await awaitFreshTotpStep();
    const code = authenticator.generate(admin.secret);
    expect((await verify(await challengeFor(admin.email), code)).statusCode).toBe(200);

    const res = await app.inject({
      method: "POST",
      url: `/api/v1/admin/users/${target.user.id}/2fa/reset`,
      headers: { authorization: `Bearer ${signAccessToken({ sub: admin.user.id, email: admin.email }).token}` },
      payload: { code },
      remoteAddress: nextIp(),
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.message).toMatch(/az önce kullanıldı/);
    const unchanged = await app.prisma.user.findUniqueOrThrow({ where: { id: target.user.id } });
    expect(unchanged.twoFactorEnabled).toBe(true);
  });

  it("/2fa/enable kurulum kodunun adımını kaydeder; /2fa/disable adımı temizler", async () => {
    const email = `enable-${crypto.randomUUID()}@example.com`;
    const user = await app.prisma.user.create({
      data: { email, name: "Kurulum", passwordHash: await hashPassword(PASSWORD), role: "USER", status: "ACTIVE", emailVerifiedAt: new Date() },
    });
    const auth = { authorization: `Bearer ${signAccessToken({ sub: user.id, email }).token}` };
    const secret = authenticator.generateSecret();
    const setupToken = signTwoFactorSetupToken(user.id, secret);
    await awaitFreshTotpStep();
    const code = authenticator.generate(secret);

    const enabled = await app.inject({
      method: "POST",
      url: "/api/v1/admin/settings/security/2fa/enable",
      headers: auth,
      payload: { setupToken, code, password: PASSWORD },
      remoteAddress: nextIp(),
    });
    expect(enabled.statusCode).toBe(200);
    expect((await app.prisma.user.findUniqueOrThrow({ where: { id: user.id } })).twoFactorLastUsedStep).toBe(matchTotpStep(secret, code));

    // Kurulum kodu hemen ardından girişte kullanılamaz.
    expect((await verify(await challengeFor(email), code)).statusCode).toBe(401);

    const disabled = await app.inject({
      method: "POST",
      url: "/api/v1/admin/settings/security/2fa/disable",
      headers: auth,
      payload: { password: PASSWORD },
      remoteAddress: nextIp(),
    });
    expect(disabled.statusCode).toBe(204);
    expect((await app.prisma.user.findUniqueOrThrow({ where: { id: user.id } })).twoFactorLastUsedStep).toBeNull();
  });
});
