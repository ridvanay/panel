import crypto from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { authenticator } from "otplib";
import { buildTestApp } from "../helpers/build-test-app";
import { resetDatabase } from "../helpers/reset-db";
import { awaitFreshTotpStep } from "../helpers/totp";
import { encryptSecret } from "../../src/lib/crypto";
import { hashPassword } from "../../src/lib/password";
import { signAccessToken, signTwoFactorSetupToken } from "../../src/lib/jwt";
import { BREAK_GLASS_AUDIT_ACTION, BreakGlassError, resetUserTwoFactorBreakGlass } from "../../src/lib/break-glass-two-factor";

/**
 * Paket G (2026-10-19) — ADMIN/MANAGER için zorunlu 2FA (`SiteSettings.staffTwoFactorRequiredAt`),
 * anahtar uçları, son 2FA'lı yönetici koruması ve acil durum (break-glass) sıfırlaması.
 */

const PASSWORD = "Sifre12345!";
const DAY_MS = 24 * 60 * 60 * 1000;


describe("Personel için zorunlu 2FA (Paket G)", () => {
  let app: FastifyInstance;
  let ipCounter = 0;
  const nextIp = () => {
    ipCounter += 1;
    return `10.60.${Math.floor(ipCounter / 250)}.${(ipCounter % 250) + 1}`;
  };

  async function createUser(role: "ADMIN" | "MANAGER" | "EDITOR" | "USER", twoFactor: boolean) {
    const email = `staff-${crypto.randomUUID()}@example.com`;
    const secret = authenticator.generateSecret();
    const user = await app.prisma.user.create({
      data: {
        email,
        name: "Personel",
        passwordHash: await hashPassword(PASSWORD),
        role,
        status: "ACTIVE",
        emailVerifiedAt: new Date(),
        ...(twoFactor ? { twoFactorEnabled: true, twoFactorSecret: encryptSecret(secret), twoFactorVerifiedAt: new Date() } : {}),
      },
    });
    return { user, email, secret, token: signAccessToken({ sub: user.id, email }).token };
  }

  function call(method: "GET" | "POST" | "PUT" | "PATCH", url: string, token: string, payload?: unknown) {
    return app.inject({ method, url: `/api/v1${url}`, headers: { authorization: `Bearer ${token}` }, ...(payload ? { payload } : {}), remoteAddress: nextIp() });
  }

  async function setRequiredAt(date: Date | null) {
    await app.prisma.siteSettings.upsert({
      where: { id: "singleton" },
      create: { id: "singleton", staffTwoFactorRequiredAt: date },
      update: { staffTwoFactorRequiredAt: date },
    });
  }

  beforeAll(async () => {
    app = await buildTestApp();
    await resetDatabase(app.prisma);
  });

  afterAll(async () => {
    await resetDatabase(app.prisma);
    await app.close();
  });

  beforeEach(async () => {
    await setRequiredAt(null);
  });

  it("varsayılan KAPALI: 2FA'sız ADMIN panele erişir; /auth/me twoFactorSetupRequired=false", async () => {
    const admin = await createUser("ADMIN", false);
    expect((await call("GET", "/admin/users", admin.token)).statusCode).toBe(200);
    const me = (await call("GET", "/auth/me", admin.token)).json().data;
    expect(me.twoFactorSetupRequired).toBe(false);
    expect(me.staffTwoFactorRequiredAt).toBeNull();
  });

  it("bekleme süresi (gelecek tarih): erişim sürer, /auth/me tarihi döner", async () => {
    const future = new Date(Date.now() + 8 * DAY_MS);
    await setRequiredAt(future);
    const manager = await createUser("MANAGER", false);
    expect((await call("GET", "/admin/blog", manager.token)).statusCode).toBe(200);
    const me = (await call("GET", "/auth/me", manager.token)).json().data;
    expect(me.twoFactorSetupRequired).toBe(false);
    expect(me.staffTwoFactorRequiredAt).toBe(future.toISOString());
  });

  it("AKTİF: 2FA'sız ADMIN/MANAGER /admin/* uçlarında 403 TWO_FACTOR_SETUP_REQUIRED; muaf uçlar açık; EDITOR, 2FA'lı ADMIN ve diğer roller etkilenmez", async () => {
    await setRequiredAt(new Date(Date.now() - 1000));
    const admin = await createUser("ADMIN", false);
    const manager = await createUser("MANAGER", false);
    const editor = await createUser("EDITOR", false);
    const admin2fa = await createUser("ADMIN", true);
    const user = await createUser("USER", false);

    const blocked = await call("GET", "/admin/users", admin.token);
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json().error.code).toBe("TWO_FACTOR_SETUP_REQUIRED");
    expect((await call("GET", "/admin/blog", manager.token)).json().error.code).toBe("TWO_FACTOR_SETUP_REQUIRED");
    expect((await call("GET", "/admin/settings", admin.token)).statusCode).toBe(403);

    // Muaf uçlar — kilitlenme olmaz: oturum, profil ve 2FA kurulumu açık.
    const me = await call("GET", "/auth/me", admin.token);
    expect(me.statusCode).toBe(200);
    expect(me.json().data.twoFactorSetupRequired).toBe(true);
    expect((await call("GET", "/users/me", admin.token)).statusCode).toBe(200);
    expect((await call("POST", "/admin/settings/security/2fa/setup", admin.token)).statusCode).toBe(200);
    expect((await call("GET", "/admin/settings/security/sessions", admin.token)).statusCode).toBe(200);

    expect((await call("GET", "/admin/users", admin2fa.token)).statusCode).toBe(200);
    expect((await call("GET", "/admin/blog", editor.token)).statusCode).toBe(200);
    expect((await call("GET", "/auth/me", user.token)).json().data.twoFactorSetupRequired).toBe(false);
  });

  it("AKTİF: 2FA'sız ADMIN kurulumu tamamlayınca panele hemen erişir", async () => {
    await setRequiredAt(new Date(Date.now() - 1000));
    const admin = await createUser("ADMIN", false);
    const secret = authenticator.generateSecret();
    await awaitFreshTotpStep();
    const enable = await call("POST", "/admin/settings/security/2fa/enable", admin.token, {
      setupToken: signTwoFactorSetupToken(admin.user.id, secret),
      code: authenticator.generate(secret),
      password: PASSWORD,
    });
    expect(enable.statusCode).toBe(200);
    expect((await call("GET", "/admin/users", admin.token)).statusCode).toBe(200);
  });

  describe("anahtar uçları — GET/PUT /admin/settings/staff-two-factor", () => {
    it("2FA'sız ADMIN açamaz (403 TWO_FACTOR_REQUIRED); MANAGER 403", async () => {
      const admin = await createUser("ADMIN", false);
      const res = await call("PUT", "/admin/settings/staff-two-factor", admin.token, { requiredAt: null, password: PASSWORD, code: "123456" });
      expect(res.statusCode).toBe(403);
      expect(res.json().error.code).toBe("TWO_FACTOR_REQUIRED");
      const manager = await createUser("MANAGER", true);
      expect((await call("GET", "/admin/settings/staff-two-factor", manager.token)).statusCode).toBe(403);
    });

    it("şifre hatalı 401, kod hatalı 403, tarih 7 günden yakın 422; geçerli istek açar, audit'ler; null kapatır", async () => {
      const admin = await createUser("ADMIN", true);
      const noTwoFactor = await createUser("MANAGER", false);
      const in8Days = new Date(Date.now() + 8 * DAY_MS).toISOString();

      expect((await call("PUT", "/admin/settings/staff-two-factor", admin.token, { requiredAt: in8Days, password: "yanlis", code: "123456" })).statusCode).toBe(401);
      expect((await call("PUT", "/admin/settings/staff-two-factor", admin.token, { requiredAt: in8Days, password: PASSWORD, code: "000000" })).statusCode).toBe(403);

      await awaitFreshTotpStep();
      const tooSoon = await call("PUT", "/admin/settings/staff-two-factor", admin.token, {
        requiredAt: new Date(Date.now() + 2 * DAY_MS).toISOString(),
        password: PASSWORD,
        code: authenticator.generate(admin.secret),
      });
      expect(tooSoon.statusCode).toBe(422);
      // Tarih kontrolü step-up'tan önce — kod tüketilmedi, aynı kod geçerli istekte kullanılabilir.

      const okRes = await call("PUT", "/admin/settings/staff-two-factor", admin.token, { requiredAt: in8Days, password: PASSWORD, code: authenticator.generate(admin.secret) });
      expect(okRes.statusCode).toBe(200);
      const body = okRes.json().data;
      expect(body.requiredAt).toBe(in8Days);
      expect(body.minGraceDays).toBe(7);
      expect(body.staffWithoutTwoFactor.map((u: { email: string }) => u.email)).toContain(noTwoFactor.email);
      const audit = await app.prisma.auditLog.findFirst({ where: { action: "security.staff_2fa_policy_updated", status: "SUCCESS", actorId: admin.user.id } });
      expect(audit?.metadata).toMatchObject({ requiredAt: in8Days });

      // Alan public /settings ve genel PATCH /admin/settings üzerinden sızmaz/değişmez.
      const publicSettings = await app.inject({ method: "GET", url: "/api/v1/settings" });
      expect(JSON.stringify(publicSettings.json())).not.toContain("staffTwoFactorRequiredAt");
      await call("PATCH", "/admin/settings", admin.token, { staffTwoFactorRequiredAt: null });
      expect((await app.prisma.siteSettings.findUniqueOrThrow({ where: { id: "singleton" } })).staffTwoFactorRequiredAt?.toISOString()).toBe(in8Days);
    });
  });

  describe("son 2FA'lı yönetici koruması (anahtar doluyken)", () => {
    it("tek 2FA'lı ADMIN kendi 2FA'sını kapatamaz ve askıya alınamaz (409); ikinci 2FA'lı ADMIN varsa serbest", async () => {
      await app.prisma.user.updateMany({ where: { role: "ADMIN" }, data: { status: "SUSPENDED" } });
      await setRequiredAt(new Date(Date.now() + 8 * DAY_MS));
      const sole = await createUser("ADMIN", true);
      const plainAdmin = await createUser("ADMIN", false);

      const disable = await call("POST", "/admin/settings/security/2fa/disable", sole.token, { password: PASSWORD });
      expect(disable.statusCode).toBe(409);
      expect((await app.prisma.user.findUniqueOrThrow({ where: { id: sole.user.id } })).twoFactorEnabled).toBe(true);

      const suspend = await call("PATCH", `/admin/users/${sole.user.id}/status`, plainAdmin.token, { status: "SUSPENDED" });
      expect(suspend.statusCode).toBe(409);

      await createUser("ADMIN", true);
      expect((await call("POST", "/admin/settings/security/2fa/disable", sole.token, { password: PASSWORD })).statusCode).toBe(204);
    });

    it("anahtar KAPALIYKEN koruma devreye girmez (mevcut davranış)", async () => {
      await app.prisma.user.updateMany({ where: { role: "ADMIN" }, data: { status: "SUSPENDED" } });
      const sole = await createUser("ADMIN", true);
      expect((await call("POST", "/admin/settings/security/2fa/disable", sole.token, { password: PASSWORD })).statusCode).toBe(204);
    });
  });

  describe("acil durum (break-glass) sıfırlaması", () => {
    const meta = { osUser: "deploy", hostname: "prod-1" };

    it("varsayılan kuru çalışma: hiçbir şey değişmez; yanlış onay e-postası da kuru çalışmadır", async () => {
      const admin = await createUser("ADMIN", true);
      const dry = await resetUserTwoFactorBreakGlass(app.prisma, { email: admin.email, operator: "Operatör", ...meta });
      expect(dry.dryRun).toBe(true);
      const mismatch = await resetUserTwoFactorBreakGlass(app.prisma, { email: admin.email, operator: "Operatör", confirmEmail: "baska@example.com", ...meta });
      expect(mismatch.dryRun).toBe(true);
      expect((await app.prisma.user.findUniqueOrThrow({ where: { id: admin.user.id } })).twoFactorEnabled).toBe(true);
    });

    it("onaylı çalıştırma 2FA'yı, yedek kodları ve oturumları sıfırlar; audit operatör/hostname içerir; açık token düşer", async () => {
      const admin = await createUser("ADMIN", true);
      await app.prisma.backupCode.create({ data: { userId: admin.user.id, codeHash: "x" } });
      await new Promise((r) => setTimeout(r, 5));
      const result = await resetUserTwoFactorBreakGlass(app.prisma, { email: admin.email, operator: "Operatör Ad", confirmEmail: admin.email.toUpperCase(), ...meta });
      expect(result.dryRun).toBe(false);

      const after = await app.prisma.user.findUniqueOrThrow({ where: { id: admin.user.id } });
      expect(after).toMatchObject({ twoFactorEnabled: false, twoFactorSecret: null, twoFactorLastUsedStep: null });
      expect(after.sessionsValidAfter).not.toBeNull();
      expect(await app.prisma.backupCode.count({ where: { userId: admin.user.id } })).toBe(0);
      const audit = await app.prisma.auditLog.findFirstOrThrow({ where: { action: BREAK_GLASS_AUDIT_ACTION, targetId: admin.user.id } });
      expect(audit.actorId).toBeNull();
      expect(audit.metadata).toMatchObject({ operator: "Operatör Ad", osUser: "deploy", hostname: "prod-1" });
      expect((await call("GET", "/auth/me", admin.token)).statusCode).toBe(401);
    });

    it("operatör zorunlu; ADMIN/MANAGER dışı rol reddedilir; bilinmeyen e-posta hata", async () => {
      const user = await createUser("USER", true);
      await expect(resetUserTwoFactorBreakGlass(app.prisma, { email: user.email, operator: "", ...meta })).rejects.toBeInstanceOf(BreakGlassError);
      await expect(resetUserTwoFactorBreakGlass(app.prisma, { email: user.email, operator: "Operatör", confirmEmail: user.email, ...meta })).rejects.toBeInstanceOf(BreakGlassError);
      await expect(resetUserTwoFactorBreakGlass(app.prisma, { email: "yok@example.com", operator: "Operatör", ...meta })).rejects.toBeInstanceOf(BreakGlassError);
      expect((await app.prisma.user.findUniqueOrThrow({ where: { id: user.user.id } })).twoFactorEnabled).toBe(true);
    });
  });
});
