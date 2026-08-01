import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestApp } from "../helpers/build-test-app";
import { resetDatabase } from "../helpers/reset-db";
import { hashToken } from "../../src/lib/tokens";

// Not: `/users/me/change-password` route-bazlı olarak dakikada 5 istekle sınırlı
// (bkz. lib/rate-limit.ts::SENSITIVE_ACTION_RATE_LIMIT). Bu dosyadaki başarısız/doğrulama
// senaryoları ile başarılı senaryo toplamı bu limitin altında kalacak şekilde sayılmıştır
// (bkz. rate-limits.test.ts'teki benzer not) — kendi izole `buildTestApp()` instance'ında çalışır.
describe("users — /me profil ve şifre değiştirme", () => {
  let app: FastifyInstance;
  let email: string;
  let password: string;
  let userId: string;

  // Oturum #1: register sırasında oluşur, "diğer cihaz" olarak kullanılacak (revoke edilmesi beklenir).
  let session1Cookie: string;

  // Oturum #2: ayrı bir login ile oluşur, change-password isteğinde "mevcut oturum" olarak kullanılacak.
  let session2AccessToken: string;
  let session2Cookie: string;

  function authHeader(token: string) {
    return { authorization: `Bearer ${token}` };
  }

  beforeAll(async () => {
    app = await buildTestApp();
    await resetDatabase(app.prisma);

    email = "eve@example.com";
    password = "Sifre12345!";

    const registerRes = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: { email, password, name: "Eve" },
    });
    userId = registerRes.json().data.user.id;
    session1Cookie = registerRes.cookies.map((c) => `${c.name}=${c.value}`).join("; ");

    const loginRes = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email, password },
    });
    session2AccessToken = loginRes.json().data.tokens.accessToken;
    session2Cookie = loginRes.cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  });

  afterAll(async () => {
    await resetDatabase(app.prisma);
    await app.close();
  });

  it("PATCH /users/me { avatarUrl: '' } döner 422 VALIDATION_ERROR", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/api/v1/users/me",
      headers: authHeader(session2AccessToken),
      payload: { avatarUrl: "" },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
  });

  it("PATCH /users/me { avatarUrl: null } döner 200 ve DB'de NULL yazar", async () => {
    // Önce geçerli bir avatarUrl set edelim ki NULL'a düşüşü doğrulayabilelim.
    const setRes = await app.inject({
      method: "PATCH",
      url: "/api/v1/users/me",
      headers: authHeader(session2AccessToken),
      payload: { avatarUrl: "https://example.com/avatar.png" },
    });
    expect(setRes.statusCode).toBe(200);
    expect(setRes.json().data.avatarUrl).toBe("https://example.com/avatar.png");

    const clearRes = await app.inject({
      method: "PATCH",
      url: "/api/v1/users/me",
      headers: authHeader(session2AccessToken),
      payload: { avatarUrl: null },
    });
    expect(clearRes.statusCode).toBe(200);
    expect(clearRes.json().data.avatarUrl).toBeNull();

    const dbUser = await app.prisma.user.findUnique({ where: { id: userId } });
    expect(dbUser?.avatarUrl).toBeNull();
  });

  it("POST /users/me/change-password kimliksiz istek döner 401", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/users/me/change-password",
      payload: { currentPassword: password, newPassword: "YeniSifre123!" },
    });

    expect(res.statusCode).toBe(401);
  });

  it("yanlış currentPassword döner 401 ve FAILURE audit kaydı oluşturur", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/users/me/change-password",
      headers: { ...authHeader(session2AccessToken), cookie: session2Cookie },
      payload: { currentPassword: "yanlis-sifre-123", newPassword: "YeniSifre123!" },
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().error.message).toBe("Şifre hatalı.");

    const log = await app.prisma.auditLog.findFirst({
      where: { actorId: userId, action: "security.password_change", status: "FAILURE" },
      orderBy: { seq: "desc" },
    });
    expect(log).not.toBeNull();
    expect(log?.actorEmail).toBe(email);
  });

  it("newPassword === currentPassword döner 422 VALIDATION_ERROR", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/users/me/change-password",
      headers: { ...authHeader(session2AccessToken), cookie: session2Cookie },
      payload: { currentPassword: password, newPassword: password },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
    expect(res.json().error.details.newPassword).toBeDefined();
  });

  it("newPassword 7 karakter döner 422 VALIDATION_ERROR", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/users/me/change-password",
      headers: { ...authHeader(session2AccessToken), cookie: session2Cookie },
      payload: { currentPassword: password, newPassword: "kisa123" },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
  });

  it("doğru şifre döner 204, passwordHash değişir, diğer oturumlar revoke edilir, mevcut oturum ayakta kalır", async () => {
    const beforeUser = await app.prisma.user.findUnique({ where: { id: userId } });
    const passwordHashBefore = beforeUser!.passwordHash;

    const newPassword = "YeniSifre123!";
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/users/me/change-password",
      headers: { ...authHeader(session2AccessToken), cookie: session2Cookie },
      payload: { currentPassword: password, newPassword },
    });

    expect(res.statusCode).toBe(204);

    const afterUser = await app.prisma.user.findUnique({ where: { id: userId } });
    expect(afterUser?.passwordHash).not.toBe(passwordHashBefore);

    // Eski şifreyle login artık başarısız, yeni şifreyle başarılı.
    const loginOld = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email, password },
    });
    expect(loginOld.statusCode).toBe(401);

    const loginNew = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email, password: newPassword },
    });
    expect(loginNew.statusCode).toBe(200);

    // Oturum #1 (register sırasında oluşan cookie) iptal edilmiş olmalı.
    const rawSession1 = session1Cookie.split("=").slice(1).join("=");
    const session1Hash = hashToken(rawSession1);
    const session1Token = await app.prisma.refreshToken.findFirst({ where: { userId, tokenHash: session1Hash } });
    expect(session1Token?.revoked).toBe(true);

    // Oturum #2 (isteği yapan mevcut oturum) hâlâ aktif olmalı.
    const rawSession2 = session2Cookie.split("=").slice(1).join("=");
    const session2Hash = hashToken(rawSession2);
    const session2Token = await app.prisma.refreshToken.findFirst({ where: { userId, tokenHash: session2Hash } });
    expect(session2Token?.revoked).toBe(false);

    // Başarı audit kaydı yazıldı ve metadata'da şifre/hash yok.
    const log = await app.prisma.auditLog.findFirst({
      where: { actorId: userId, action: "security.password_change", status: "SUCCESS" },
      orderBy: { seq: "desc" },
    });
    expect(log).not.toBeNull();
    expect(JSON.stringify(log?.metadata ?? {})).not.toMatch(/newPassword|currentPassword|passwordHash/i);
  });
});
