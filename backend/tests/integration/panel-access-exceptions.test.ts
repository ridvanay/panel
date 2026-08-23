import crypto from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestApp } from "../helpers/build-test-app";
import { resetDatabase } from "../helpers/reset-db";
import { hashPassword } from "../../src/lib/password";
import { signAccessToken } from "../../src/lib/jwt";

/**
 * `.claude/architect-scope-rbac-5-tier.md` §4.3 — panel kapısının (`requirePanelAccess()`,
 * ADMIN|MANAGER|EDITOR) İKİ istisnası: `/admin/settings/security/2fa` ve
 * `/admin/settings/security/sessions`. Bu iki router `authenticated` kalır — 5 rolün HEPSİ
 * (ADMIN, MANAGER, EDITOR, CUSTOMER, USER) erişebilir (self-servis: kullanıcı yalnızca KENDİ
 * 2FA'sını/oturumlarını yönetir). §4.4'teki route-tablosu zorlama testi security-agent'ın
 * kapsamıdır; bu dosya yalnızca istisna listesinin DAVRANIŞINI (5 rol için 200) doğrular.
 *
 * NOT: kullanıcılar `POST /auth/register` (AUTH_RATE_LIMIT, dakikada 5) ÜZERİNDEN DEĞİL,
 * doğrudan Prisma ile oluşturulur ve token `signAccessToken()` ile üretilir — bu dosyanın 10+
 * kullanıcı ihtiyacı rate limit'e takılmadan karşılanır (bkz.
 * admin-users-regression-matrix.test.ts'teki AYNI desen).
 */
describe("panel-access istisnaları — /admin/settings/security/* (§4.3)", () => {
  let app: FastifyInstance;

  function authHeader(token: string) {
    return { authorization: `Bearer ${token}` };
  }

  function tokenFor(user: { id: string; email: string }): string {
    return signAccessToken({ sub: user.id, email: user.email }).token;
  }

  async function createUserWithRole(role: "ADMIN" | "MANAGER" | "EDITOR" | "CUSTOMER" | "USER") {
    const passwordHash = await hashPassword("Sifre12345!");
    return app.prisma.user.create({
      data: {
        email: `panel-exc-${role.toLowerCase()}-${crypto.randomUUID()}@example.com`,
        name: "Test Kullanıcı",
        passwordHash,
        role,
        status: "ACTIVE",
      },
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

  const ROLES = ["ADMIN", "MANAGER", "EDITOR", "CUSTOMER", "USER"] as const;

  it.each(ROLES)("POST /admin/settings/security/2fa/setup — rol=%s → 200 (panel kapısı YOK, self-servis)", async (role) => {
    const user = await createUserWithRole(role);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/admin/settings/security/2fa/setup",
      headers: authHeader(tokenFor(user)),
    });
    expect(res.statusCode, `role=${role}`).toBe(200);
  });

  it.each(ROLES)("GET /admin/settings/security/sessions — rol=%s → 200 (panel kapısı YOK, self-servis)", async (role) => {
    const user = await createUserWithRole(role);
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/admin/settings/security/sessions",
      headers: authHeader(tokenFor(user)),
    });
    expect(res.statusCode, `role=${role}`).toBe(200);
  });

  it("CUSTOMER/USER diğer /admin/* uçlarında (panel kapısı olan) 403 alır — istisna yalnızca security/* içindir", async () => {
    const customer = await createUserWithRole("CUSTOMER");
    const user = await createUserWithRole("USER");

    for (const actor of [customer, user]) {
      const res = await app.inject({ method: "GET", url: "/api/v1/admin/pages", headers: authHeader(tokenFor(actor)) });
      expect(res.statusCode).toBe(403);
      expect(res.json().error.code).toBe("FORBIDDEN");
    }
  });
});
