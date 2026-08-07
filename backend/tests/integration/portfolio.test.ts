import crypto from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";

describe("portfolio (§10.9.4 Portföy Modülü)", () => {
  let app: FastifyInstance;
  let adminToken: string;
  let editorToken: string;
  let viewerToken: string;

  function authHeader(token: string) {
    return { authorization: `Bearer ${token}` };
  }

  async function createUserDirect(role: "ADMIN" | "EDITOR" | "VIEWER") {
    const { hashPassword } = await import("../../src/lib/password");
    const passwordHash = await hashPassword("Sifre12345!");
    return app.prisma.user.create({
      data: {
        email: `portfolio-user-${crypto.randomUUID()}@example.com`,
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
    const { buildTestApp } = await import("../helpers/build-test-app");
    const { resetDatabase } = await import("../helpers/reset-db");
    const { registerTestUser } = await import("../helpers/auth");

    app = await buildTestApp();
    await resetDatabase(app.prisma);

    // İlk register boş bir DB'de otomatik ADMIN olur (bkz. auth.service.ts).
    const admin = await registerTestUser(app, { email: "portfolio-admin@example.com" });
    adminToken = admin.accessToken;

    const editor = await createUserDirect("EDITOR");
    editorToken = await loginAs(editor.email);

    const viewer = await createUserDirect("VIEWER");
    viewerToken = await loginAs(viewer.email);
  });

  afterAll(async () => {
    const { resetDatabase } = await import("../helpers/reset-db");
    await resetDatabase(app.prisma);
    await app.close();
  });

  it("VIEWER portföy öğesi oluşturamaz (403), ama herkes listeleyip okuyabilir", async () => {
    const forbidden = await app.inject({
      method: "POST",
      url: "/api/v1/admin/portfolio",
      headers: authHeader(viewerToken),
      payload: { title: "Yetkisiz Proje" },
    });
    expect(forbidden.statusCode).toBe(403);

    const create = await app.inject({
      method: "POST",
      url: "/api/v1/admin/portfolio",
      headers: authHeader(editorToken),
      payload: { title: "İlk Proje" },
    });
    expect(create.statusCode).toBe(201);
    const item = create.json().data;
    expect(item.slug).toBe("ilk-proje"); // aksan işaretleri NFKD ayrışması sonrası düşer (bkz. lib/slug.ts)

    const list = await app.inject({ method: "GET", url: "/api/v1/admin/portfolio", headers: authHeader(viewerToken) });
    expect(list.statusCode).toBe(200);
    expect(list.json().data.map((p: { id: string }) => p.id)).toContain(item.id);

    const get = await app.inject({
      method: "GET",
      url: `/api/v1/admin/portfolio/${item.id}`,
      headers: authHeader(viewerToken),
    });
    expect(get.statusCode).toBe(200);
  });

  it("VIEWER PATCH/DELETE ile portföy öğesini değiştiremez (403)", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/api/v1/admin/portfolio",
      headers: authHeader(editorToken),
      payload: { title: "VIEWER Deneme Projesi" },
    });
    const itemId = create.json().data.id;

    const patch = await app.inject({
      method: "PATCH",
      url: `/api/v1/admin/portfolio/${itemId}`,
      headers: authHeader(viewerToken),
      payload: { title: "Değişmemeli" },
    });
    expect(patch.statusCode).toBe(403);

    const del = await app.inject({
      method: "DELETE",
      url: `/api/v1/admin/portfolio/${itemId}`,
      headers: authHeader(viewerToken),
    });
    expect(del.statusCode).toBe(403);
  });

  it("aynı slug ile ikinci portföy öğesi oluşturmak 409 döner", async () => {
    const first = await app.inject({
      method: "POST",
      url: "/api/v1/admin/portfolio",
      headers: authHeader(editorToken),
      payload: { title: "Çakışan Proje", slug: "cakisan-proje" },
    });
    expect(first.statusCode).toBe(201);

    const second = await app.inject({
      method: "POST",
      url: "/api/v1/admin/portfolio",
      headers: authHeader(editorToken),
      payload: { title: "Başka Başlık", slug: "cakisan-proje" },
    });
    expect(second.statusCode).toBe(409);
  });

  it("soft-delete + restore + kalıcı silme akışı", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/api/v1/admin/portfolio",
      headers: authHeader(adminToken),
      payload: { title: "Çöp Akışı Projesi" },
    });
    const itemId = create.json().data.id;

    const del = await app.inject({
      method: "DELETE",
      url: `/api/v1/admin/portfolio/${itemId}`,
      headers: authHeader(adminToken),
    });
    expect(del.statusCode).toBe(204);

    const permanentBeforeRestore = await app.inject({
      method: "DELETE",
      url: `/api/v1/admin/portfolio/${itemId}/permanent`,
      headers: authHeader(viewerToken),
    });
    expect(permanentBeforeRestore.statusCode).toBe(403);

    const restore = await app.inject({
      method: "POST",
      url: `/api/v1/admin/portfolio/${itemId}/restore`,
      headers: authHeader(adminToken),
    });
    expect(restore.statusCode).toBe(200);
    expect(restore.json().data.deletedAt).toBeNull();

    await app.inject({ method: "DELETE", url: `/api/v1/admin/portfolio/${itemId}`, headers: authHeader(adminToken) });

    const permanentNotAdmin = await app.inject({
      method: "DELETE",
      url: `/api/v1/admin/portfolio/${itemId}/permanent`,
      headers: authHeader(editorToken),
    });
    expect(permanentNotAdmin.statusCode).toBe(403);

    const permanent = await app.inject({
      method: "DELETE",
      url: `/api/v1/admin/portfolio/${itemId}/permanent`,
      headers: authHeader(adminToken),
    });
    expect(permanent.statusCode).toBe(204);

    const get = await app.inject({
      method: "GET",
      url: `/api/v1/admin/portfolio/${itemId}`,
      headers: authHeader(adminToken),
    });
    expect(get.statusCode).toBe(404);
  });

  it("contentHtml içindeki XSS payload'ı create/update'te sanitize eder", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/api/v1/admin/portfolio",
      headers: authHeader(editorToken),
      payload: {
        title: "XSS Proje Testi",
        contentHtml: '<p>Merhaba <b>dünya</b></p><script>alert(1)</script><a href="javascript:alert(2)">tıkla</a>',
      },
    });
    expect(create.statusCode).toBe(201);
    const createdHtml = create.json().data.contentHtml as string;
    expect(createdHtml).not.toContain("<script");
    expect(createdHtml).not.toContain("alert(1)");
    expect(createdHtml).not.toContain("javascript:");
    expect(createdHtml).toContain("<p>Merhaba <b>dünya</b></p>");

    const itemId = create.json().data.id;
    const update = await app.inject({
      method: "PATCH",
      url: `/api/v1/admin/portfolio/${itemId}`,
      headers: authHeader(editorToken),
      payload: { contentHtml: '<p onclick="alert(1)">Merhaba</p><iframe src="evil.com"></iframe>' },
    });
    expect(update.statusCode).toBe(200);
    const updatedHtml = update.json().data.contentHtml as string;
    expect(updatedHtml).not.toContain("onclick");
    expect(updatedHtml).not.toContain("iframe");
    expect(updatedHtml).toContain("Merhaba");
  });

  it("taslak proje public'te görünmez (404), yayınlanan proje görünür", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/api/v1/admin/portfolio",
      headers: authHeader(editorToken),
      payload: { title: "Taslak Proje" },
    });
    const draft = create.json().data;
    expect(draft.status).toBe("DRAFT");

    const publicDraft = await app.inject({ method: "GET", url: `/api/v1/portfolio/${draft.slug}` });
    expect(publicDraft.statusCode).toBe(404);

    const publishedCreate = await app.inject({
      method: "POST",
      url: "/api/v1/admin/portfolio",
      headers: authHeader(editorToken),
      payload: { title: "Yayınlanan Proje", status: "PUBLISHED" },
    });
    const published = publishedCreate.json().data;

    const publicPublished = await app.inject({ method: "GET", url: `/api/v1/portfolio/${published.slug}` });
    expect(publicPublished.statusCode).toBe(200);

    const view = await app.inject({ method: "POST", url: `/api/v1/portfolio/${published.slug}/view` });
    expect(view.statusCode).toBe(204);

    const afterView = await app.inject({ method: "GET", url: `/api/v1/portfolio/${published.slug}` });
    expect(afterView.json().data.viewCount).toBe(1);
  });

  it("kategori CRUD: ADMIN/EDITOR oluşturabilir, yalnızca ADMIN silebilir", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/api/v1/admin/portfolio/categories",
      headers: authHeader(editorToken),
      payload: { name: "Web Sitesi" },
    });
    expect(create.statusCode).toBe(201);
    const category = create.json().data;
    expect(category.slug).toBe("web-sitesi");

    const forbiddenDelete = await app.inject({
      method: "DELETE",
      url: `/api/v1/admin/portfolio/categories/${category.id}`,
      headers: authHeader(editorToken),
    });
    expect(forbiddenDelete.statusCode).toBe(403);

    const del = await app.inject({
      method: "DELETE",
      url: `/api/v1/admin/portfolio/categories/${category.id}`,
      headers: authHeader(adminToken),
    });
    expect(del.statusCode).toBe(204);
  });
});

describe("portfolio — modül kapalıyken (§10.9 Eklenti/Modül Yönetimi)", () => {
  let app: FastifyInstance;
  let adminToken: string;

  beforeAll(async () => {
    vi.doMock("../../src/lib/module-state", () => ({
      isModuleEnabled: async () => false,
    }));

    vi.resetModules();
    const { buildTestApp } = await import("../helpers/build-test-app");
    const { resetDatabase } = await import("../helpers/reset-db");
    const { registerTestUser } = await import("../helpers/auth");

    app = await buildTestApp();
    await resetDatabase(app.prisma);

    const admin = await registerTestUser(app, { email: "portfolio-module-admin@example.com" });
    adminToken = admin.accessToken;
  });

  afterAll(async () => {
    const { resetDatabase } = await import("../helpers/reset-db");
    await resetDatabase(app.prisma);
    await app.close();
    vi.doUnmock("../../src/lib/module-state");
    vi.resetModules();
  });

  it("modül kapalıyken public uçlar 404 döner ama admin uçları çalışmaya devam eder (veri korunumu)", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/api/v1/admin/portfolio",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { title: "Kapalı Modül Projesi", status: "PUBLISHED" },
    });
    expect(create.statusCode).toBe(201);
    const item = create.json().data;

    const publicList = await app.inject({ method: "GET", url: "/api/v1/portfolio" });
    expect(publicList.statusCode).toBe(404);

    const publicDetail = await app.inject({ method: "GET", url: `/api/v1/portfolio/${item.slug}` });
    expect(publicDetail.statusCode).toBe(404);

    const adminGet = await app.inject({
      method: "GET",
      url: `/api/v1/admin/portfolio/${item.id}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(adminGet.statusCode).toBe(200);
    expect(adminGet.json().data.id).toBe(item.id);
  });
});
