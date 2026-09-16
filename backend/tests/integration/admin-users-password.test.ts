import crypto from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestApp } from "../helpers/build-test-app";
import { resetDatabase } from "../helpers/reset-db";
import { registerTestUser } from "../helpers/auth";
import { hashPassword } from "../../src/lib/password";

/**
 * `PATCH /admin/users/{userId}/password` — GÖREV B (backend-agent). `POST /admin/users`in
 * SMTP'ye bağımlı şifre belirleme akışının (mail atılamazsa hesap kilitli kalır) çıkış yolu.
 *
 * AYRI dosya: `admin-users.test.ts` SIRALI/kümülatif bir admin-sayısı durumuna bağımlıdır
 * (son testinde TÜM adminleri suspend eder) — bu dosya kendi izole `app`/kullanıcı setiyle çalışır.
 *
 * İKİ AYRI `describe`/`app`: `AUTH_RATE_LIMIT_MAX` (varsayılan 5/dk, `.env.test`'te override
 * EDİLMEDİ) `/auth/login`de TEK bir app örneğinde birikir (`telehealth-identity.test.ts` İLE
 * AYNI bilinen kısıt) — hedef kullanıcı oluşturma `createUserDirect` (Prisma, register ucunu
 * HİÇ ÇAĞIRMAZ) ile yapılır; her describe'ın login çağrı sayısı 5'in altında tutulur.
 */

function authHeader(token: string) {
  return { authorization: `Bearer ${token}` };
}

async function createUserDirect(
  app: FastifyInstance,
  role: "MANAGER" | "EDITOR" | "USER",
  password = "Sifre12345!"
) {
  const passwordHash = await hashPassword(password);
  return app.prisma.user.create({
    data: {
      email: `admin-users-password-${role.toLowerCase()}-${crypto.randomUUID()}@example.com`,
      name: "Test Kullanıcı",
      passwordHash,
      role,
      status: "ACTIVE",
      // `.claude/architect-scope-guest-account-otp.md` §2.3 — `login()` artık `emailVerifiedAt`
      // gerektiriyor; bu doğrudan-oluşturma yardımcısı GRANDFATHERED bir hesabı temsil eder.
      emailVerifiedAt: new Date(),
    },
  });
}

async function loginAs(app: FastifyInstance, email: string, password = "Sifre12345!"): Promise<string> {
  const res = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email, password } });
  expect(res.statusCode).toBe(200);
  return res.json().data.tokens.accessToken as string;
}

describe("PATCH /admin/users/{userId}/password — RBAC ve doğrulama", () => {
  let app: FastifyInstance;
  let adminToken: string;
  let managerToken: string;
  let editorToken: string;
  let userToken: string;

  beforeAll(async () => {
    app = await buildTestApp();
    await resetDatabase(app.prisma);

    const admin = await registerTestUser(app, { email: `admin-users-password-admin-${crypto.randomUUID()}@example.com` });
    adminToken = admin.accessToken;

    managerToken = await loginAs(app, (await createUserDirect(app, "MANAGER")).email);
    editorToken = await loginAs(app, (await createUserDirect(app, "EDITOR")).email);
    userToken = await loginAs(app, (await createUserDirect(app, "USER")).email);
  });

  afterAll(async () => {
    await resetDatabase(app.prisma);
    await app.close();
  });

  it("MANAGER/EDITOR/USER çağıramaz (403)", async () => {
    const target = await createUserDirect(app, "USER");

    for (const token of [managerToken, editorToken, userToken]) {
      const res = await app.inject({
        method: "PATCH",
        url: `/api/v1/admin/users/${target.id}/password`,
        headers: authHeader(token),
        payload: { password: "YeniSifre12345!" },
      });
      expect(res.statusCode).toBe(403);
    }
  });

  it("çok kısa şifre → 422", async () => {
    const target = await createUserDirect(app, "USER");

    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/admin/users/${target.id}/password`,
      headers: authHeader(adminToken),
      payload: { password: "1234567" },
    });
    expect(res.statusCode).toBe(422);
  });

  it("var olmayan userId → 404", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/admin/users/${crypto.randomUUID()}/password`,
      headers: authHeader(adminToken),
      payload: { password: "YeniSifre12345!" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("silinmiş (DELETED) kullanıcı → 404 (`/role`/`/status` ile TUTARLI)", async () => {
    const target = await createUserDirect(app, "USER");
    await app.prisma.user.update({ where: { id: target.id }, data: { status: "DELETED", deletedAt: new Date() } });

    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/admin/users/${target.id}/password`,
      headers: authHeader(adminToken),
      payload: { password: "YeniSifre12345!" },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("PATCH /admin/users/{userId}/password — başarı senaryosu (oturum iptali + yeni şifreyle giriş)", () => {
  let app: FastifyInstance;
  let adminToken: string;

  beforeAll(async () => {
    app = await buildTestApp();
    await resetDatabase(app.prisma);

    const admin = await registerTestUser(app, { email: `admin-users-password-success-admin-${crypto.randomUUID()}@example.com` });
    adminToken = admin.accessToken;
  });

  afterAll(async () => {
    await resetDatabase(app.prisma);
    await app.close();
  });

  it("ADMIN başarıyla şifre değiştirir — eski refresh token'lar iptal edilir, YENİ şifreyle login ÇALIŞIR, ESKİ şifreyle ÇALIŞMAZ", async () => {
    const target = await createUserDirect(app, "USER", "EskiSifre12345!");

    // Hedef kullanıcı bir oturum açar (refresh token oluşsun) — bu, ADMIN'in şifre
    // değiştirmesiyle iptal edilmesi gereken oturumdur.
    await loginAs(app, target.email, "EskiSifre12345!");

    const activeTokensBefore = await app.prisma.refreshToken.count({ where: { userId: target.id, revoked: false } });
    expect(activeTokensBefore).toBeGreaterThan(0);

    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/admin/users/${target.id}/password`,
      headers: authHeader(adminToken),
      payload: { password: "YeniSifre12345!" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.id).toBe(target.id);
    // Şifre hash'i/düz metni yanıtta ASLA yer almaz.
    expect(JSON.stringify(res.json().data)).not.toMatch(/passwordHash|YeniSifre12345/);

    const activeTokensAfter = await app.prisma.refreshToken.count({ where: { userId: target.id, revoked: false } });
    expect(activeTokensAfter).toBe(0);

    const auditEntry = await app.prisma.auditLog.findFirst({
      where: { action: "admin_users.password_reset", targetId: target.id },
    });
    expect(auditEntry).not.toBeNull();
    expect(JSON.stringify(auditEntry?.metadata ?? {})).not.toContain("YeniSifre12345");

    const oldLogin = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: target.email, password: "EskiSifre12345!" },
    });
    expect(oldLogin.statusCode).toBe(401);

    const newLogin = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: target.email, password: "YeniSifre12345!" },
    });
    expect(newLogin.statusCode).toBe(200);
  });
});
