import crypto from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";

describe("products (§10.9.2 Ürünler Modülü)", () => {
  let app: FastifyInstance;
  let adminToken: string;
  let adminId: string;
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
        email: `product-user-${crypto.randomUUID()}@example.com`,
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
    const admin = await registerTestUser(app, { email: "products-admin@example.com" });
    adminToken = admin.accessToken;
    adminId = admin.userId;

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

  it("VIEWER ürün oluşturamaz (403), ama herkes listeleyip okuyabilir", async () => {
    const forbidden = await app.inject({
      method: "POST",
      url: "/api/v1/admin/products",
      headers: authHeader(viewerToken),
      payload: { title: "Yetkisiz Ürün", priceCents: 1000 },
    });
    expect(forbidden.statusCode).toBe(403);

    const create = await app.inject({
      method: "POST",
      url: "/api/v1/admin/products",
      headers: authHeader(editorToken),
      payload: { title: "İlk Ürün", priceCents: 1000 },
    });
    expect(create.statusCode).toBe(201);
    const product = create.json().data;
    expect(product.slug).toBe("ilk-urun"); // aksan işaretleri NFKD ayrışması sonrası düşer (bkz. lib/slug.ts)

    const list = await app.inject({ method: "GET", url: "/api/v1/admin/products", headers: authHeader(viewerToken) });
    expect(list.statusCode).toBe(200);
    expect(list.json().data.map((p: { id: string }) => p.id)).toContain(product.id);

    const get = await app.inject({
      method: "GET",
      url: `/api/v1/admin/products/${product.id}`,
      headers: authHeader(viewerToken),
    });
    expect(get.statusCode).toBe(200);
  });

  it("VIEWER PATCH/DELETE ile ürünü değiştiremez (403)", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/api/v1/admin/products",
      headers: authHeader(editorToken),
      payload: { title: "VIEWER Deneme Ürünü", priceCents: 500 },
    });
    const productId = create.json().data.id;

    const patch = await app.inject({
      method: "PATCH",
      url: `/api/v1/admin/products/${productId}`,
      headers: authHeader(viewerToken),
      payload: { title: "Değişmemeli" },
    });
    expect(patch.statusCode).toBe(403);

    const del = await app.inject({
      method: "DELETE",
      url: `/api/v1/admin/products/${productId}`,
      headers: authHeader(viewerToken),
    });
    expect(del.statusCode).toBe(403);
  });

  it("aynı slug ile ikinci ürün oluşturmak 409 döner", async () => {
    const first = await app.inject({
      method: "POST",
      url: "/api/v1/admin/products",
      headers: authHeader(editorToken),
      payload: { title: "Çakışan Ürün", slug: "cakisan-urun", priceCents: 1000 },
    });
    expect(first.statusCode).toBe(201);

    const second = await app.inject({
      method: "POST",
      url: "/api/v1/admin/products",
      headers: authHeader(editorToken),
      payload: { title: "Başka Başlık", slug: "cakisan-urun", priceCents: 2000 },
    });
    expect(second.statusCode).toBe(409);
  });

  it("soft-delete + restore + kalıcı silme akışı", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/api/v1/admin/products",
      headers: authHeader(adminToken),
      payload: { title: "Çöp Akışı Ürünü", priceCents: 1500 },
    });
    const productId = create.json().data.id;

    const del = await app.inject({
      method: "DELETE",
      url: `/api/v1/admin/products/${productId}`,
      headers: authHeader(adminToken),
    });
    expect(del.statusCode).toBe(204);

    const permanentBeforeRestore = await app.inject({
      method: "DELETE",
      url: `/api/v1/admin/products/${productId}/permanent`,
      headers: authHeader(viewerToken),
    });
    expect(permanentBeforeRestore.statusCode).toBe(403);

    const restore = await app.inject({
      method: "POST",
      url: `/api/v1/admin/products/${productId}/restore`,
      headers: authHeader(adminToken),
    });
    expect(restore.statusCode).toBe(200);
    expect(restore.json().data.deletedAt).toBeNull();

    await app.inject({ method: "DELETE", url: `/api/v1/admin/products/${productId}`, headers: authHeader(adminToken) });

    const permanentNotAdmin = await app.inject({
      method: "DELETE",
      url: `/api/v1/admin/products/${productId}/permanent`,
      headers: authHeader(editorToken),
    });
    expect(permanentNotAdmin.statusCode).toBe(403);

    const permanent = await app.inject({
      method: "DELETE",
      url: `/api/v1/admin/products/${productId}/permanent`,
      headers: authHeader(adminToken),
    });
    expect(permanent.statusCode).toBe(204);

    const get = await app.inject({
      method: "GET",
      url: `/api/v1/admin/products/${productId}`,
      headers: authHeader(adminToken),
    });
    expect(get.statusCode).toBe(404);
  });

  it("descriptionHtml içindeki XSS payload'ı create/update'te sanitize eder", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/api/v1/admin/products",
      headers: authHeader(editorToken),
      payload: {
        title: "XSS Ürün Testi",
        priceCents: 999,
        descriptionHtml: '<p>Merhaba <b>dünya</b></p><script>alert(1)</script><a href="javascript:alert(2)">tıkla</a>',
      },
    });
    expect(create.statusCode).toBe(201);
    const createdHtml = create.json().data.descriptionHtml as string;
    expect(createdHtml).not.toContain("<script");
    expect(createdHtml).not.toContain("alert(1)");
    expect(createdHtml).not.toContain("javascript:");
    expect(createdHtml).toContain("<p>Merhaba <b>dünya</b></p>");

    const productId = create.json().data.id;
    const update = await app.inject({
      method: "PATCH",
      url: `/api/v1/admin/products/${productId}`,
      headers: authHeader(editorToken),
      payload: { descriptionHtml: '<p onclick="alert(1)">Merhaba</p><iframe src="evil.com"></iframe>' },
    });
    expect(update.statusCode).toBe(200);
    const updatedHtml = update.json().data.descriptionHtml as string;
    expect(updatedHtml).not.toContain("onclick");
    expect(updatedHtml).not.toContain("iframe");
    expect(updatedHtml).toContain("Merhaba");
  });

  it("taslak ürün public'te görünmez (404), yayınlanan ürün görünür", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/api/v1/admin/products",
      headers: authHeader(editorToken),
      payload: { title: "Taslak Ürün", priceCents: 2500 },
    });
    const draft = create.json().data;
    expect(draft.status).toBe("DRAFT");

    const publicDraft = await app.inject({ method: "GET", url: `/api/v1/products/${draft.slug}` });
    expect(publicDraft.statusCode).toBe(404);

    const publishedCreate = await app.inject({
      method: "POST",
      url: "/api/v1/admin/products",
      headers: authHeader(editorToken),
      payload: { title: "Yayınlanan Ürün", priceCents: 3000, status: "PUBLISHED" },
    });
    const published = publishedCreate.json().data;

    const publicPublished = await app.inject({ method: "GET", url: `/api/v1/products/${published.slug}` });
    expect(publicPublished.statusCode).toBe(200);

    const view = await app.inject({ method: "POST", url: `/api/v1/products/${published.slug}/view` });
    expect(view.statusCode).toBe(204);

    const afterView = await app.inject({ method: "GET", url: `/api/v1/products/${published.slug}` });
    expect(afterView.json().data.viewCount).toBe(1);
  });

  it("admin elle stok düzeltmesi yapabilir ve audit log kaydı oluşur", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/api/v1/admin/products",
      headers: authHeader(adminToken),
      payload: { title: "Stok Ürünü", priceCents: 4000, stockQuantity: 10 },
    });
    const productId = create.json().data.id;

    const adjust = await app.inject({
      method: "PATCH",
      url: `/api/v1/admin/products/${productId}/stock`,
      headers: authHeader(adminToken),
      payload: { stockQuantity: 25 },
    });
    expect(adjust.statusCode).toBe(200);
    expect(adjust.json().data.stockQuantity).toBe(25);

    const auditRow = await app.prisma.auditLog.findFirst({
      where: { action: "product.stock_adjust", targetId: productId },
      orderBy: { createdAt: "desc" },
    });
    expect(auditRow).not.toBeNull();
    expect(auditRow?.actorId).toBe(adminId);
    expect(auditRow?.metadata).toMatchObject({ from: 10, to: 25 });
  });

  it("negatif stockQuantity 422 ile reddedilir (create ve stok düzeltme)", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/api/v1/admin/products",
      headers: authHeader(editorToken),
      payload: { title: "Negatif Stok Denemesi", priceCents: 1000, stockQuantity: -5 },
    });
    expect(create.statusCode).toBe(422);

    const validProduct = await app.inject({
      method: "POST",
      url: "/api/v1/admin/products",
      headers: authHeader(editorToken),
      payload: { title: "Stok Düzeltme Denemesi", priceCents: 1000 },
    });
    const productId = validProduct.json().data.id;

    const adjust = await app.inject({
      method: "PATCH",
      url: `/api/v1/admin/products/${productId}/stock`,
      headers: authHeader(editorToken),
      payload: { stockQuantity: -1 },
    });
    expect(adjust.statusCode).toBe(422);
  });

  it("discountPriceCents priceCents'ten büyük/eşitse 422 döner (create ve update)", async () => {
    const createInvalid = await app.inject({
      method: "POST",
      url: "/api/v1/admin/products",
      headers: authHeader(editorToken),
      payload: { title: "İndirim Hatalı Ürün", priceCents: 1000, discountPriceCents: 1000 },
    });
    expect(createInvalid.statusCode).toBe(422);

    const create = await app.inject({
      method: "POST",
      url: "/api/v1/admin/products",
      headers: authHeader(editorToken),
      payload: { title: "İndirim Geçerli Ürün", priceCents: 1000, discountPriceCents: 500 },
    });
    expect(create.statusCode).toBe(201);
    const productId = create.json().data.id;

    // Yalnızca discountPriceCents gönderilip mevcut priceCents'e göre çapraz kontrol edilmeli.
    const updateInvalid = await app.inject({
      method: "PATCH",
      url: `/api/v1/admin/products/${productId}`,
      headers: authHeader(editorToken),
      payload: { discountPriceCents: 1000 },
    });
    expect(updateInvalid.statusCode).toBe(422);

    const updateValid = await app.inject({
      method: "PATCH",
      url: `/api/v1/admin/products/${productId}`,
      headers: authHeader(editorToken),
      payload: { discountPriceCents: 800 },
    });
    expect(updateValid.statusCode).toBe(200);
    expect(updateValid.json().data.discountPriceCents).toBe(800);
  });

  it("kategori CRUD: ADMIN/EDITOR oluşturabilir, yalnızca ADMIN silebilir", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/api/v1/admin/products/categories",
      headers: authHeader(editorToken),
      payload: { name: "Elektronik" },
    });
    expect(create.statusCode).toBe(201);
    const category = create.json().data;
    expect(category.slug).toBe("elektronik");

    const forbiddenDelete = await app.inject({
      method: "DELETE",
      url: `/api/v1/admin/products/categories/${category.id}`,
      headers: authHeader(editorToken),
    });
    expect(forbiddenDelete.statusCode).toBe(403);

    const del = await app.inject({
      method: "DELETE",
      url: `/api/v1/admin/products/categories/${category.id}`,
      headers: authHeader(adminToken),
    });
    expect(del.statusCode).toBe(204);
  });
});

describe("products — modül kapalıyken (§10.9 Eklenti/Modül Yönetimi)", () => {
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

    const admin = await registerTestUser(app, { email: "products-module-admin@example.com" });
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
      url: "/api/v1/admin/products",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { title: "Kapalı Modül Ürünü", priceCents: 1000, status: "PUBLISHED" },
    });
    expect(create.statusCode).toBe(201);
    const product = create.json().data;

    const publicList = await app.inject({ method: "GET", url: "/api/v1/products" });
    expect(publicList.statusCode).toBe(404);

    const publicDetail = await app.inject({ method: "GET", url: `/api/v1/products/${product.slug}` });
    expect(publicDetail.statusCode).toBe(404);

    const adminGet = await app.inject({
      method: "GET",
      url: `/api/v1/admin/products/${product.id}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(adminGet.statusCode).toBe(200);
    expect(adminGet.json().data.id).toBe(product.id);
  });
});
