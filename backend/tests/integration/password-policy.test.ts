import crypto from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestApp } from "../helpers/build-test-app";
import { resetDatabase } from "../helpers/reset-db";
import { registerTestUser } from "../helpers/auth";
import { hashPassword } from "../../src/lib/password";
import { createPasswordResetToken } from "../../src/modules/auth/auth.service";
import { hashOtpCode, issueVerificationCode } from "../../src/lib/otp";

/**
 * Paket S — şifre politikası bütün "yeni şifre" uçlarında aynı: kayıt, sıfırlama, hesap etkinleştirme,
 * şifre değiştirme, admin'in şifre belirlemesi. Girişte uygulanmaz: eski zayıf şifreli kullanıcı giriş yapar.
 */
const WEAK = ["12345678", "Password1", "qwerty123!", "aaaaaaaaaa1A"];
const STRONG = "Gökyüzü-Mavi7";

describe("Paket S — şifre politikası uçları", () => {
  let app: FastifyInstance;
  let adminAuth: { authorization: string };

  beforeAll(async () => {
    app = await buildTestApp();
    await resetDatabase(app.prisma);
    adminAuth = { authorization: `Bearer ${(await registerTestUser(app)).accessToken}` };
  });

  afterAll(async () => {
    await resetDatabase(app.prisma);
    await app.close();
  });

  async function legacyUser(password: string, name = "Eski Kullanıcı") {
    return app.prisma.user.create({
      data: {
        email: `eski-${crypto.randomUUID()}@example.com`,
        name,
        passwordHash: await hashPassword(password),
        role: "USER",
        status: "ACTIVE",
        emailVerifiedAt: new Date(),
      },
    });
  }
  const rulesOf = (res: { json: () => { error: { code: string; details?: Record<string, string[]> } } }) => res.json().error.details?.passwordRules ?? [];

  it("kayıt: zayıf şifreler 422 + kural kodları; e-posta adı geçen şifre reddedilir; güçlü şifre kabul", async () => {
    for (const password of WEAK) {
      const res = await app.inject({ method: "POST", url: "/api/v1/auth/register", remoteAddress: `10.9.0.${WEAK.indexOf(password) + 1}`, payload: { email: `k-${crypto.randomUUID()}@example.com`, password, name: "Deneme" } });
      expect(res.statusCode, password).toBe(422);
      expect(res.json().error.code).toBe("VALIDATION_ERROR");
      expect(rulesOf(res).length, password).toBeGreaterThan(0);
      expect(res.json().error.details.password.length).toBeGreaterThan(0);
    }
    const personal = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      remoteAddress: "10.9.0.20",
      payload: { email: "zeynep.ak@example.com", password: "Zeynep.Ak-2026", name: "Deneme" },
    });
    expect(rulesOf(personal)).toEqual(["notPersonal"]);
    const ok = await app.inject({ method: "POST", url: "/api/v1/auth/register", remoteAddress: "10.9.0.21", payload: { email: `k-${crypto.randomUUID()}@example.com`, password: STRONG, name: "Deneme" } });
    expect(ok.statusCode).toBe(202);
  });

  it("mevcut kullanıcı eski (kurala uymayan) şifresiyle giriş yapabilir — girişte kural uygulanmaz", async () => {
    const user = await legacyUser("12345678");
    const res = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email: user.email, password: "12345678" } });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.tokens.accessToken).toEqual(expect.any(String));
  });

  it("şifre sıfırlama: aynı kurallar (alan `newPassword`); geçerli token gerekir; güçlü şifre kabul", async () => {
    const user = await legacyUser("12345678");
    const token = await createPasswordResetToken(app, user.id);
    const weak = await app.inject({ method: "POST", url: "/api/v1/auth/reset-password", payload: { token, newPassword: "Password1" } });
    expect(weak.statusCode).toBe(422);
    expect(rulesOf(weak)).toEqual(expect.arrayContaining(["notCommon"]));
    expect(weak.json().error.details.newPassword.length).toBeGreaterThan(0);
    const bad = await app.inject({ method: "POST", url: "/api/v1/auth/reset-password", payload: { token: "gecersiz", newPassword: "Password1" } });
    expect(bad.statusCode).toBe(401); // token önce: kural bilgisi sızmaz
    const ok = await app.inject({ method: "POST", url: "/api/v1/auth/reset-password", payload: { token, newPassword: STRONG } });
    expect(ok.statusCode).toBeLessThan(300);
  });

  it("şifre değiştirme: aynı kurallar; adı içeren şifre reddedilir", async () => {
    const user = await legacyUser("12345678", "Selim Toprak");
    const login = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email: user.email, password: "12345678" } });
    const auth = { authorization: `Bearer ${login.json().data.tokens.accessToken}` };
    const weak = await app.inject({ method: "POST", url: "/api/v1/users/me/change-password", headers: auth, payload: { currentPassword: "12345678", newPassword: "qwerty123!" } });
    expect(weak.statusCode).toBe(422);
    const personal = await app.inject({ method: "POST", url: "/api/v1/users/me/change-password", headers: auth, payload: { currentPassword: "12345678", newPassword: "Toprak#Mavi-77" } });
    expect(rulesOf(personal)).toEqual(["notPersonal"]);
    const ok = await app.inject({ method: "POST", url: "/api/v1/users/me/change-password", headers: auth, payload: { currentPassword: "12345678", newPassword: STRONG } });
    expect(ok.statusCode).toBeLessThan(300);
  });

  it("admin'in şifre belirlemesi: aynı kurallar (hedef kullanıcının e-postası/adıyla)", async () => {
    const user = await legacyUser("12345678");
    const weak = await app.inject({ method: "PATCH", url: `/api/v1/admin/users/${user.id}/password`, headers: adminAuth, payload: { password: "aaaaaaaaaa1A" } });
    expect(weak.statusCode).toBe(422);
    expect(rulesOf(weak)).toEqual(["noSequence"]);
    const ok = await app.inject({ method: "PATCH", url: `/api/v1/admin/users/${user.id}/password`, headers: adminAuth, payload: { password: STRONG } });
    expect(ok.statusCode).toBe(200);
  });

  it("hesap etkinleştirme (misafir hesabı): aynı kurallar", async () => {
    const user = await app.prisma.user.create({
      data: { email: `misafir-${crypto.randomUUID()}@example.com`, name: "Misafir Hasta", passwordHash: await hashPassword(crypto.randomUUID()), role: "USER", status: "ACTIVE" },
    });
    await issueVerificationCode(app, user.id, "ACCOUNT_ACTIVATION").catch(() => undefined);
    const code = "246813";
    await app.prisma.emailVerificationCode.updateMany({
      where: { userId: user.id, purpose: "ACCOUNT_ACTIVATION", consumedAt: null },
      data: { codeHash: hashOtpCode(user.id, "ACCOUNT_ACTIVATION", code) },
    });
    const weak = await app.inject({ method: "POST", url: "/api/v1/auth/activate-account", payload: { email: user.email, code, password: "12345678" } });
    expect(weak.statusCode).toBe(422);
    expect(rulesOf(weak)).toEqual(expect.arrayContaining(["length", "notDigitsOnly"]));
    // İnceleme bulgusu — zayıf şifre tek kullanımlık kodu yakmaz: aynı kodla güçlü şifre kabul edilir.
    const ok = await app.inject({ method: "POST", url: "/api/v1/auth/activate-account", payload: { email: user.email, code, password: STRONG } });
    expect(ok.statusCode).toBe(200);
  });
});
