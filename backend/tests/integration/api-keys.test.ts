import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestApp } from "../helpers/build-test-app";
import { resetDatabase } from "../helpers/reset-db";
import { registerTestUser } from "../helpers/auth";

/**
 * §10.13.3/§10.13.4/§10.13.10 — API anahtarı yönetimi (`/admin/settings/api-keys`, SADECE ADMIN,
 * okuma dahil) + `X-Api-Key` doğrulaması (`/api/v1/public/*`).
 */
describe("api-keys — admin CRUD + X-Api-Key doğrulaması", () => {
  let app: FastifyInstance;
  let adminToken: string;
  let editorToken: string;

  function authHeader(token: string) {
    return { authorization: `Bearer ${token}` };
  }

  beforeAll(async () => {
    app = await buildTestApp();
    await resetDatabase(app.prisma);
    // Boş bir DB'de ilk kayıt olan kullanıcı otomatik ADMIN olur (bkz. auth.service.ts).
    const admin = await registerTestUser(app, { email: "api-keys-admin@example.com" });
    adminToken = admin.accessToken;
    const editor = await registerTestUser(app, { email: "api-keys-editor@example.com" });
    editorToken = editor.accessToken;
    // İkinci kayıt VIEWER olur (şema varsayılanı) — EDITOR'a yükseltmek için doğrudan Prisma.
    await app.prisma.user.update({ where: { email: "api-keys-editor@example.com" }, data: { role: "EDITOR" } });
  });

  afterAll(async () => {
    await resetDatabase(app.prisma);
    await app.close();
  });

  it("kimliksiz istek 401 döner", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/admin/settings/api-keys" });
    expect(res.statusCode).toBe(401);
  });

  it("ADMIN olmayan (EDITOR) okuma dahil 403 alır — §10.13.10 istisnasız kural", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/admin/settings/api-keys", headers: authHeader(editorToken) });
    expect(res.statusCode).toBe(403);
  });

  let plainKey: string;
  let apiKeyId: string;

  it("ADMIN yeni bir API anahtarı oluşturur — plainKey yalnızca bu yanıtta döner", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/admin/settings/api-keys",
      headers: authHeader(adminToken),
      payload: { name: "Test Entegrasyonu", scope: "READ" },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.data.plainKey).toMatch(/^cmsk_[0-9a-f]{12}_[0-9a-f]{64}$/);
    expect(body.data.apiKey.maskedKey).toBe(`${body.data.apiKey.keyPrefix}…${body.data.apiKey.last4}`);
    expect(body.data.apiKey.status).toBe("ACTIVE");

    plainKey = body.data.plainKey;
    apiKeyId = body.data.apiKey.id;
  });

  it("liste ucu ham anahtarı ASLA döndürmez", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/admin/settings/api-keys", headers: authHeader(adminToken) });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(JSON.stringify(body)).not.toContain(plainKey);
    expect(body.data.some((k: { id: string }) => k.id === apiKeyId)).toBe(true);
  });

  it("geçerli X-Api-Key ile /public/me çağrısı 200 döner ve anahtarı geri yansıtmaz", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/public/me", headers: { "x-api-key": plainKey } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.name).toBe("Test Entegrasyonu");
    expect(body.data.scope).toBe("READ");
    expect(body.data.rateLimit.limit).toBeGreaterThan(0);
    expect(JSON.stringify(body)).not.toContain(plainKey);
  });

  it("Authorization: Bearer ile public API çağrısı KABUL EDİLMEZ (401)", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/public/me", headers: { authorization: `Bearer ${plainKey}` } });
    expect(res.statusCode).toBe(401);
  });

  it("eksik/bozuk X-Api-Key 401 döner ve sabit/genel bir mesaj taşır", async () => {
    const missing = await app.inject({ method: "GET", url: "/api/v1/public/me" });
    expect(missing.statusCode).toBe(401);

    const malformed = await app.inject({ method: "GET", url: "/api/v1/public/me", headers: { "x-api-key": "not-a-real-key" } });
    expect(malformed.statusCode).toBe(401);
    expect(malformed.json().error.message).toBe(missing.json().error.message);
  });

  it("PATCH ile anahtar meta verisi güncellenir", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/admin/settings/api-keys/${apiKeyId}`,
      headers: authHeader(adminToken),
      payload: { name: "Güncellenmiş Ad" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.name).toBe("Güncellenmiş Ad");
  });

  it("iptal (revoke) sonrası anahtar ANINDA geçersizleşir — cache gecikmesi YOKTUR", async () => {
    const revokeRes = await app.inject({
      method: "POST",
      url: `/api/v1/admin/settings/api-keys/${apiKeyId}/revoke`,
      headers: authHeader(adminToken),
    });
    expect(revokeRes.statusCode).toBe(200);
    expect(revokeRes.json().data.status).toBe("REVOKED");

    const publicRes = await app.inject({ method: "GET", url: "/api/v1/public/me", headers: { "x-api-key": plainKey } });
    expect(publicRes.statusCode).toBe(401);
  });

  it("zaten iptal edilmiş bir anahtarı tekrar iptal etmek 409 döner", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/admin/settings/api-keys/${apiKeyId}/revoke`,
      headers: authHeader(adminToken),
    });
    expect(res.statusCode).toBe(409);
  });

  it("DELETE ile kalıcı silinir (204) ve tekrar silme 404 döner", async () => {
    const res = await app.inject({ method: "DELETE", url: `/api/v1/admin/settings/api-keys/${apiKeyId}`, headers: authHeader(adminToken) });
    expect(res.statusCode).toBe(204);

    const again = await app.inject({ method: "DELETE", url: `/api/v1/admin/settings/api-keys/${apiKeyId}`, headers: authHeader(adminToken) });
    expect(again.statusCode).toBe(404);
  });
});

/**
 * §10.13.5 — public API yüzeyi: yayındaki içerik dönmeli, taslak/çöp GÖRÜNMEMELİ, `Public*`
 * DTO'ları admin alanlarını (author/seoScore/deletedAt/viewCount) TAŞIMAMALI.
 */
describe("public-api — görünürlük filtresi ve Public* DTO izin listesi", () => {
  let app: FastifyInstance;
  let adminToken: string;
  let plainKey: string;

  function authHeader(token: string) {
    return { authorization: `Bearer ${token}` };
  }

  beforeAll(async () => {
    app = await buildTestApp();
    await resetDatabase(app.prisma);
    const admin = await registerTestUser(app, { email: "public-api-admin@example.com" });
    adminToken = admin.accessToken;

    const keyRes = await app.inject({
      method: "POST",
      url: "/api/v1/admin/settings/api-keys",
      headers: authHeader(adminToken),
      payload: { name: "Public API Test Key" },
    });
    plainKey = keyRes.json().data.plainKey;

    await app.prisma.page.create({
      data: { title: "Yayındaki Sayfa", slug: "yayindaki-sayfa", status: "PUBLISHED", publishedAt: new Date(), authorId: admin.userId },
    });
    await app.prisma.page.create({
      data: { title: "Taslak Sayfa", slug: "taslak-sayfa", status: "DRAFT" },
    });
  });

  afterAll(async () => {
    await resetDatabase(app.prisma);
    await app.close();
  });

  it("yayındaki sayfa döner ve admin-only alanları TAŞIMAZ", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/public/pages/yayindaki-sayfa", headers: { "x-api-key": plainKey } });
    expect(res.statusCode).toBe(200);
    const page = res.json().data;
    expect(page.title).toBe("Yayındaki Sayfa");
    for (const forbiddenField of ["author", "authorId", "seoScore", "seoScoreIssues", "deletedAt", "viewCount", "translations", "localizations"]) {
      expect(page).not.toHaveProperty(forbiddenField);
    }
  });

  it("taslak sayfa public API'de 404 döner (varlığı sızdırılmaz)", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/public/pages/taslak-sayfa", headers: { "x-api-key": plainKey } });
    expect(res.statusCode).toBe(404);
  });

  it("liste ucu yalnızca yayındaki sayfaları döner", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/public/pages", headers: { "x-api-key": plainKey } });
    expect(res.statusCode).toBe(200);
    const slugs = res.json().data.map((p: { slug: string }) => p.slug);
    expect(slugs).toContain("yayindaki-sayfa");
    expect(slugs).not.toContain("taslak-sayfa");
  });

  it("x-ratelimit-* header'ları her /public/* yanıtında döner (Katman 2 değerleri)", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/public/pages", headers: { "x-api-key": plainKey } });
    expect(res.headers["x-ratelimit-limit"]).toBeDefined();
    expect(res.headers["x-ratelimit-remaining"]).toBeDefined();
    expect(res.headers["x-ratelimit-reset"]).toBeDefined();
  });
});
