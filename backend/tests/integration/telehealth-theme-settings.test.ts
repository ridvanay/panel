import crypto from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestApp } from "../helpers/build-test-app";
import { resetDatabase } from "../helpers/reset-db";

/**
 * Randevu sihirbazı (`/doctors/[slug]`, frontend) tema renkleri — `GET`/`PATCH
 * /admin/telehealth/settings` + PUBLIC `GET /telehealth/theme`. Migration/yeni model YOK,
 * `SiteModule.settings` (`key="telehealth"`) JSON'u KULLANILIR (bkz.
 * `modules/telehealth/lib/theme-settings.ts::parseTelehealthTheme`).
 */

const DEFAULTS = {
  primaryColor: "#0f766e",
  secondaryColor: "#0369a1",
  accentColor: "#f59e0b",
  calendarActiveBg: "#0f766e",
};

function authHeader(token: string) {
  return { authorization: `Bearer ${token}` };
}

async function createUserDirect(app: FastifyInstance, role: "ADMIN" | "MANAGER" | "EDITOR" | "CUSTOMER") {
  const { hashPassword } = await import("../../src/lib/password");
  const passwordHash = await hashPassword("Sifre12345!");
  return app.prisma.user.create({
    data: {
      email: `telehealth-theme-${role.toLowerCase()}-${crypto.randomUUID()}@example.com`,
      name: `Test ${role}`,
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

async function setTelehealthModuleEnabled(app: FastifyInstance, enabled: boolean) {
  await app.prisma.siteModule.upsert({
    where: { key: "telehealth" },
    create: { key: "telehealth", enabled },
    update: { enabled },
  });
}

describe("telehealth theme settings — GET/PATCH /admin/telehealth/settings + GET /telehealth/theme", () => {
  let app: FastifyInstance;
  let adminToken: string;
  let managerToken: string;
  let editorToken: string;
  let customerToken: string;

  beforeAll(async () => {
    app = await buildTestApp();
    await resetDatabase(app.prisma);
    await setTelehealthModuleEnabled(app, true);

    adminToken = await loginAs(app, (await createUserDirect(app, "ADMIN")).email);
    managerToken = await loginAs(app, (await createUserDirect(app, "MANAGER")).email);
    editorToken = await loginAs(app, (await createUserDirect(app, "EDITOR")).email);
    customerToken = await loginAs(app, (await createUserDirect(app, "CUSTOMER")).email);
  });

  afterAll(async () => {
    await resetDatabase(app.prisma);
    await app.close();
  });

  it("SiteModule.settings satırı hiç yokken GET varsayılanları döner (bozuk/eksik JSON'a sessizce düşer)", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/admin/telehealth/settings", headers: authHeader(adminToken) });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual(DEFAULTS);

    const publicRes = await app.inject({ method: "GET", url: "/api/v1/telehealth/theme" });
    expect(publicRes.statusCode).toBe(200);
    expect(publicRes.json().data).toEqual(DEFAULTS);
  });

  it("RBAC — GET: ADMIN/MANAGER/EDITOR 200, CUSTOMER 401/403; PATCH: ADMIN/MANAGER 200, EDITOR/CUSTOMER 403", async () => {
    const adminGet = await app.inject({ method: "GET", url: "/api/v1/admin/telehealth/settings", headers: authHeader(adminToken) });
    expect(adminGet.statusCode).toBe(200);
    const managerGet = await app.inject({ method: "GET", url: "/api/v1/admin/telehealth/settings", headers: authHeader(managerToken) });
    expect(managerGet.statusCode).toBe(200);
    const editorGet = await app.inject({ method: "GET", url: "/api/v1/admin/telehealth/settings", headers: authHeader(editorToken) });
    expect(editorGet.statusCode).toBe(200);
    const customerGet = await app.inject({ method: "GET", url: "/api/v1/admin/telehealth/settings", headers: authHeader(customerToken) });
    expect(customerGet.statusCode).toBe(403);

    const editorPatch = await app.inject({
      method: "PATCH",
      url: "/api/v1/admin/telehealth/settings",
      headers: authHeader(editorToken),
      payload: { primaryColor: "#111111" },
    });
    expect(editorPatch.statusCode).toBe(403);

    const customerPatch = await app.inject({
      method: "PATCH",
      url: "/api/v1/admin/telehealth/settings",
      headers: authHeader(customerToken),
      payload: { primaryColor: "#111111" },
    });
    expect(customerPatch.statusCode).toBe(403);
  });

  it("PATCH KISMİ günceller (diğer alanlar korunur), GET/public uç yeni değeri yansıtır", async () => {
    const patchRes = await app.inject({
      method: "PATCH",
      url: "/api/v1/admin/telehealth/settings",
      headers: authHeader(managerToken),
      payload: { primaryColor: "#123456", accentColor: "#abcdef" },
    });
    expect(patchRes.statusCode).toBe(200);
    expect(patchRes.json().data).toEqual({
      primaryColor: "#123456",
      secondaryColor: DEFAULTS.secondaryColor,
      accentColor: "#abcdef",
      calendarActiveBg: DEFAULTS.calendarActiveBg,
    });

    const getRes = await app.inject({ method: "GET", url: "/api/v1/admin/telehealth/settings", headers: authHeader(adminToken) });
    expect(getRes.json().data).toEqual(patchRes.json().data);

    const publicRes = await app.inject({ method: "GET", url: "/api/v1/telehealth/theme" });
    expect(publicRes.statusCode).toBe(200);
    expect(publicRes.json().data).toEqual(patchRes.json().data);

    // `SiteModule.enabled` bu route TARAFINDAN DEĞİŞTİRİLMEMİŞ olmalı (yalnızca settings.routes'un işi).
    const row = await app.prisma.siteModule.findUnique({ where: { key: "telehealth" } });
    expect(row?.enabled).toBe(true);
  });

  it("boş body → 200 (mevcut tema değişmeden döner, en az 1 alan ZORUNLU DEĞİL)", async () => {
    const before = await app.inject({ method: "GET", url: "/api/v1/admin/telehealth/settings", headers: authHeader(adminToken) });
    const res = await app.inject({ method: "PATCH", url: "/api/v1/admin/telehealth/settings", headers: authHeader(adminToken), payload: {} });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual(before.json().data);
  });

  it("geçersiz hex → 422 VALIDATION_ERROR, details.<alan> dolu", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/api/v1/admin/telehealth/settings",
      headers: authHeader(adminToken),
      payload: { primaryColor: "not-a-color", calendarActiveBg: "#fff" },
    });
    expect(res.statusCode).toBe(422);
    const body = res.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.details.primaryColor).toBeTruthy();
    // `#fff` (3 haneli kısa biçim) DA reddedilir — yalnızca `#rrggbb` (6 hane) kabul edilir.
    expect(body.error.details.calendarActiveBg).toBeTruthy();
  });

  it("modül KAPALIYKEN admin GET/PATCH VE public GET 404 döner (`requireModuleEnabled`, diğer uçlarla AYNI disiplin)", async () => {
    await setTelehealthModuleEnabled(app, false);

    const adminGet = await app.inject({ method: "GET", url: "/api/v1/admin/telehealth/settings", headers: authHeader(adminToken) });
    expect(adminGet.statusCode).toBe(404);

    const adminPatch = await app.inject({
      method: "PATCH",
      url: "/api/v1/admin/telehealth/settings",
      headers: authHeader(adminToken),
      payload: { primaryColor: "#000000" },
    });
    expect(adminPatch.statusCode).toBe(404);

    const publicRes = await app.inject({ method: "GET", url: "/api/v1/telehealth/theme" });
    expect(publicRes.statusCode).toBe(404);

    await setTelehealthModuleEnabled(app, true);
  });
});
