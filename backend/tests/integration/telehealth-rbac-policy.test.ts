import crypto from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestApp } from "../helpers/build-test-app";
import { resetDatabase } from "../helpers/reset-db";

/**
 * [TCT] §9.7.7 KARAR K7 — `/admin/telehealth/*` RBAC REGRESYON testi. Bu dosya KOD
 * DEĞİŞİKLİĞİ İÇERMEZ (mevcut RBAC zaten DOĞRU kabul edilmiştir, bkz. architect ticket'ı) —
 * yalnızca mevcut davranışı SABİTLER, ileride bir refactor'ün bu matrisi sessizce bozmasını
 * engeller:
 *   - `specialties`/`doctors`: okuma ADMIN+MANAGER+EDITOR (`requirePanelAccess()`), yazma
 *     YALNIZCA ADMIN+MANAGER (EDITOR 403).
 *   - `appointments`/`analytics/overview`: ADMIN+MANAGER (EDITOR dahil DIĞER HER ROL 403) —
 *     hasta PII'si + mali veri, `requirePanelAccess()` KULLANILMAZ.
 *   - `bookings/{id}/mark-paid`: YALNIZCA ADMIN (MANAGER dahil DIĞER HER ROL 403).
 */

function authHeader(token: string) {
  return { authorization: `Bearer ${token}` };
}

async function createUserDirect(app: FastifyInstance, role: "ADMIN" | "MANAGER" | "EDITOR" | "USER") {
  const { hashPassword } = await import("../../src/lib/password");
  const passwordHash = await hashPassword("Sifre12345!");
  return app.prisma.user.create({
    data: {
      email: `telehealth-rbac-${role.toLowerCase()}-${crypto.randomUUID()}@example.com`,
      name: `Test ${role}`,
      passwordHash,
      role,
      status: "ACTIVE",
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

describe("telehealth — /admin/telehealth/* RBAC regresyonu (§9.7.7 KARAR K7)", () => {
  let app: FastifyInstance;
  let editorToken: string;
  let managerToken: string;

  beforeAll(async () => {
    app = await buildTestApp();
    await resetDatabase(app.prisma);
    await setTelehealthModuleEnabled(app, true);

    const editor = await createUserDirect(app, "EDITOR");
    editorToken = await loginAs(app, editor.email);

    const manager = await createUserDirect(app, "MANAGER");
    managerToken = await loginAs(app, manager.email);
  });

  afterAll(async () => {
    await resetDatabase(app.prisma);
    await app.close();
  });

  // ---------- EDITOR ----------

  it("EDITOR — GET /admin/telehealth/doctors → 200 (requirePanelAccess, okuma)", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/admin/telehealth/doctors", headers: authHeader(editorToken) });
    expect(res.statusCode).toBe(200);
  });

  it("EDITOR — GET /admin/telehealth/specialties → 200 (requirePanelAccess, okuma)", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/admin/telehealth/specialties", headers: authHeader(editorToken) });
    expect(res.statusCode).toBe(200);
  });

  it("EDITOR — POST /admin/telehealth/doctors → 403 (yazma YALNIZCA ADMIN+MANAGER)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/admin/telehealth/doctors",
      headers: authHeader(editorToken),
      payload: {
        title: "Dr.",
        fullName: "RBAC Test Doktor",
        bio: "RBAC regresyon testi için oluşturulmuş minimal doktor profili biyografisi.",
        languages: ["tr"],
        timeZone: "Europe/Istanbul",
        sessionDurationMin: 30,
        sessionPriceCents: 50000,
      },
    });
    expect(res.statusCode).toBe(403);
  });

  it("EDITOR — PATCH /admin/telehealth/doctors/{doctorId} → 403 (yazma YALNIZCA ADMIN+MANAGER)", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/admin/telehealth/doctors/${crypto.randomUUID()}`,
      headers: authHeader(editorToken),
      payload: {},
    });
    expect(res.statusCode).toBe(403);
  });

  it("EDITOR — DELETE /admin/telehealth/doctors/{doctorId} → 403 (yazma YALNIZCA ADMIN+MANAGER)", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/api/v1/admin/telehealth/doctors/${crypto.randomUUID()}`,
      headers: authHeader(editorToken),
    });
    expect(res.statusCode).toBe(403);
  });

  it("EDITOR — POST /admin/telehealth/specialties → 403 (yazma YALNIZCA ADMIN+MANAGER)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/admin/telehealth/specialties",
      headers: authHeader(editorToken),
      payload: { name: "RBAC Test Uzmanlık", icon: "heart-pulse" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("EDITOR — PATCH /admin/telehealth/specialties/{specialtyId} → 403 (yazma YALNIZCA ADMIN+MANAGER)", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/admin/telehealth/specialties/${crypto.randomUUID()}`,
      headers: authHeader(editorToken),
      payload: {},
    });
    expect(res.statusCode).toBe(403);
  });

  it("EDITOR — DELETE /admin/telehealth/specialties/{specialtyId} → 403 (yazma YALNIZCA ADMIN+MANAGER)", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/api/v1/admin/telehealth/specialties/${crypto.randomUUID()}`,
      headers: authHeader(editorToken),
    });
    expect(res.statusCode).toBe(403);
  });

  it("EDITOR — GET /admin/telehealth/appointments → 403 (PII, requirePanelAccess DEĞİL)", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/admin/telehealth/appointments", headers: authHeader(editorToken) });
    expect(res.statusCode).toBe(403);
  });

  it("EDITOR — GET /admin/telehealth/analytics/overview → 403 (mali veri, requirePanelAccess DEĞİL)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/admin/telehealth/analytics/overview",
      headers: authHeader(editorToken),
    });
    expect(res.statusCode).toBe(403);
  });

  // ---------- MANAGER ----------

  it("MANAGER — GET /admin/telehealth/appointments → 200", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/admin/telehealth/appointments", headers: authHeader(managerToken) });
    expect(res.statusCode).toBe(200);
  });

  it("MANAGER — GET /admin/telehealth/analytics/overview → 200", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/admin/telehealth/analytics/overview",
      headers: authHeader(managerToken),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json().data;
    expect(body.granularity).toBe("day");
    expect(Array.isArray(body.series)).toBe(true);
    expect(Array.isArray(body.doctors)).toBe(true);
  });

  it("MANAGER — POST /admin/telehealth/bookings/{bookingId}/mark-paid → 403 (§9.7.1 madde 7, YALNIZCA ADMIN)", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/admin/telehealth/bookings/${crypto.randomUUID()}/mark-paid`,
      headers: authHeader(managerToken),
      payload: { reason: "RBAC regresyon testi" },
    });
    expect(res.statusCode).toBe(403);
  });
});
