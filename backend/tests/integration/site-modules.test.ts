import crypto from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";

/**
 * §10.9 Eklenti/Modül Yönetimi — Faz 1'de `MODULE_REGISTRY` boş/placeholder olabileceğinden
 * (henüz somut bir modül yok, bkz. lib/module-registry.ts), testte geçici bir modül tanımıyla
 * `vi.mock` kullanılarak registry değiştirilir — `invitations-audit.test.ts`'teki `vi.mock`
 * paterniyle AYNI yaklaşım. Böylece gerçek `MODULE_REGISTRY`'ye test-özel bir kayıt EKLENMEZ.
 */
const TEST_MODULE = vi.hoisted(() => ({
  key: "test-module",
  label: "Test Modülü",
  description: "Yalnızca entegrasyon testleri için tanımlı geçici modül.",
  defaultEnabled: true,
}));

vi.mock("../../src/lib/module-registry", () => ({
  MODULE_REGISTRY: [TEST_MODULE],
  getModuleDefinition: (key: string) => (key === TEST_MODULE.key ? TEST_MODULE : undefined),
}));

import { buildTestApp } from "../helpers/build-test-app";
import { resetDatabase } from "../helpers/reset-db";
import { registerTestUser } from "../helpers/auth";
import { hashPassword } from "../../src/lib/password";

describe("site-modules — /admin/modules ve /modules", () => {
  let app: FastifyInstance;
  let adminToken: string;
  let editorToken: string;
  let viewerToken: string;
  let adminId: string;

  function authHeader(token: string) {
    return { authorization: `Bearer ${token}` };
  }

  async function createUserDirect(role: "ADMIN" | "EDITOR" | "VIEWER") {
    const passwordHash = await hashPassword("Sifre12345!");
    return app.prisma.user.create({
      data: {
        email: `user-${crypto.randomUUID()}@example.com`,
        name: "Test Kullanıcı",
        passwordHash,
        role,
        status: "ACTIVE",
      },
    });
  }

  async function loginAs(email: string, password = "Sifre12345!"): Promise<string> {
    const res = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email, password } });
    expect(res.statusCode).toBe(200);
    return res.json().data.tokens.accessToken as string;
  }

  beforeAll(async () => {
    app = await buildTestApp();
    await resetDatabase(app.prisma);

    // İlk register boş bir DB'de otomatik ADMIN olur (bkz. auth.service.ts).
    const admin = await registerTestUser(app, { email: "modules-admin@example.com" });
    adminToken = admin.accessToken;
    adminId = admin.userId;

    const editor = await createUserDirect("EDITOR");
    editorToken = await loginAs(editor.email);

    const viewer = await createUserDirect("VIEWER");
    viewerToken = await loginAs(viewer.email);
  });

  afterAll(async () => {
    await resetDatabase(app.prisma);
    await app.close();
  });

  it("kimliksiz istek GET /admin/modules'e erişemez (401)", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/admin/modules" });
    expect(res.statusCode).toBe(401);
  });

  it("authenticated her rol (VIEWER dahil) GET /admin/modules'ü görebilir ve registry+DB birleşimini döner", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/admin/modules", headers: authHeader(viewerToken) });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({
      key: TEST_MODULE.key,
      label: TEST_MODULE.label,
      description: TEST_MODULE.description,
      // Satır henüz DB'de yok -> registry'deki defaultEnabled fallback olur.
      enabled: TEST_MODULE.defaultEnabled,
      updatedAt: null,
      updatedBy: null,
    });
  });

  it("EDITOR/VIEWER PATCH /admin/modules/:key ile değiştiremez (403)", async () => {
    const editorRes = await app.inject({
      method: "PATCH",
      url: `/api/v1/admin/modules/${TEST_MODULE.key}`,
      headers: authHeader(editorToken),
      payload: { enabled: false },
    });
    expect(editorRes.statusCode).toBe(403);

    const viewerRes = await app.inject({
      method: "PATCH",
      url: `/api/v1/admin/modules/${TEST_MODULE.key}`,
      headers: authHeader(viewerToken),
      payload: { enabled: false },
    });
    expect(viewerRes.statusCode).toBe(403);
  });

  it("olmayan bir key için PATCH 404 döner", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/api/v1/admin/modules/does-not-exist",
      headers: authHeader(adminToken),
      payload: { enabled: false },
    });
    expect(res.statusCode).toBe(404);
  });

  it("ADMIN PATCH /admin/modules/:key ile modülü kapatabilir ve audit log kaydı oluşur", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/admin/modules/${TEST_MODULE.key}`,
      headers: authHeader(adminToken),
      payload: { enabled: false },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.enabled).toBe(false);
    expect(body.data.updatedAt).not.toBeNull();
    expect(body.data.updatedBy).toMatchObject({ id: adminId });

    const row = await app.prisma.siteModule.findUnique({ where: { key: TEST_MODULE.key } });
    expect(row?.enabled).toBe(false);
    expect(row?.updatedById).toBe(adminId);

    const auditRow = await app.prisma.auditLog.findFirst({
      where: { action: "module.disable", targetId: TEST_MODULE.key },
      orderBy: { createdAt: "desc" },
    });
    expect(auditRow).not.toBeNull();
    expect(auditRow?.actorId).toBe(adminId);
    expect(auditRow?.targetType).toBe("SiteModule");
    expect(auditRow?.metadata).toMatchObject({ key: TEST_MODULE.key, enabled: false });
  });

  it("GET /modules (public) auth gerektirmez ve yalnızca key/enabled döner", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/modules" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toHaveLength(1);
    // Bir önceki testte modül kapatıldığı için burada false görünmeli.
    expect(body.data[0]).toEqual({ key: TEST_MODULE.key, enabled: false });
  });

  it("ADMIN modülü tekrar açınca 'module.enable' audit log kaydı oluşur", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/admin/modules/${TEST_MODULE.key}`,
      headers: authHeader(adminToken),
      payload: { enabled: true },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.enabled).toBe(true);

    const auditRow = await app.prisma.auditLog.findFirst({
      where: { action: "module.enable", targetId: TEST_MODULE.key },
      orderBy: { createdAt: "desc" },
    });
    expect(auditRow).not.toBeNull();
    expect(auditRow?.metadata).toMatchObject({ key: TEST_MODULE.key, enabled: true });
  });
});
