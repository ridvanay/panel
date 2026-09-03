import crypto from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";

describe("products (§10.9.2 Ürünler Modülü)", () => {
  let app: FastifyInstance;
  let adminToken: string;
  let adminId: string;
  let managerToken: string;
  let blockedToken: string;

  function authHeader(token: string) {
    return { authorization: `Bearer ${token}` };
  }

  async function createUserDirect(role: "ADMIN" | "MANAGER" | "EDITOR" | "USER") {
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

    // `.claude/architect-scope-rbac-5-tier.md` §5.3 satır 15 — products ADMIN + MANAGER'a
    // açıktır, EDITOR TAMAMEN çıkarıldı (eski davranış: ADMIN+EDITOR). `manager` bu testlerde
    // eski "EDITOR" rolünün yerini alan İZİNLİ aktördür; `blockedToken` (USER) her uçta 403
    // beklenen aktördür.
    const manager = await createUserDirect("MANAGER");
    managerToken = await loginAs(manager.email);

    const blockedUser = await createUserDirect("USER");
    blockedToken = await loginAs(blockedUser.email);
  });

  afterAll(async () => {
    const { resetDatabase } = await import("../helpers/reset-db");
    await resetDatabase(app.prisma);
    await app.close();
  });

  it("USER ürün oluşturamaz VE listeleyip okuyamaz (403); MANAGER oluşturabilir/listeleyebilir/okuyabilir", async () => {
    const forbidden = await app.inject({
      method: "POST",
      url: "/api/v1/admin/products",
      headers: authHeader(blockedToken),
      payload: { title: "Yetkisiz Ürün", priceCents: 1000 },
    });
    expect(forbidden.statusCode).toBe(403);

    const create = await app.inject({
      method: "POST",
      url: "/api/v1/admin/products",
      headers: authHeader(managerToken),
      payload: { title: "İlk Ürün", priceCents: 1000 },
    });
    expect(create.statusCode).toBe(201);
    const product = create.json().data;
    expect(product.slug).toBe("ilk-urun"); // aksan işaretleri NFKD ayrışması sonrası düşer (bkz. lib/slug.ts)

    // §5.3 satır 15 — liste/okuma da ADMIN+MANAGER'a daraldı (EDITOR çıkarıldı); USER panel
    // kapısında (§4) zaten 403 alır.
    const listForbidden = await app.inject({ method: "GET", url: "/api/v1/admin/products", headers: authHeader(blockedToken) });
    expect(listForbidden.statusCode).toBe(403);

    const list = await app.inject({ method: "GET", url: "/api/v1/admin/products", headers: authHeader(managerToken) });
    expect(list.statusCode).toBe(200);
    expect(list.json().data.map((p: { id: string }) => p.id)).toContain(product.id);

    const getForbidden = await app.inject({
      method: "GET",
      url: `/api/v1/admin/products/${product.id}`,
      headers: authHeader(blockedToken),
    });
    expect(getForbidden.statusCode).toBe(403);

    const get = await app.inject({
      method: "GET",
      url: `/api/v1/admin/products/${product.id}`,
      headers: authHeader(managerToken),
    });
    expect(get.statusCode).toBe(200);
  });

  it("USER PATCH/DELETE ile ürünü değiştiremez (403)", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/api/v1/admin/products",
      headers: authHeader(managerToken),
      payload: { title: "USER Deneme Ürünü", priceCents: 500 },
    });
    const productId = create.json().data.id;

    const patch = await app.inject({
      method: "PATCH",
      url: `/api/v1/admin/products/${productId}`,
      headers: authHeader(blockedToken),
      payload: { title: "Değişmemeli" },
    });
    expect(patch.statusCode).toBe(403);

    const del = await app.inject({
      method: "DELETE",
      url: `/api/v1/admin/products/${productId}`,
      headers: authHeader(blockedToken),
    });
    expect(del.statusCode).toBe(403);
  });

  it("aynı slug ile ikinci ürün oluşturmak 409 döner", async () => {
    const first = await app.inject({
      method: "POST",
      url: "/api/v1/admin/products",
      headers: authHeader(managerToken),
      payload: { title: "Çakışan Ürün", slug: "cakisan-urun", priceCents: 1000 },
    });
    expect(first.statusCode).toBe(201);

    const second = await app.inject({
      method: "POST",
      url: "/api/v1/admin/products",
      headers: authHeader(managerToken),
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
      headers: authHeader(blockedToken),
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

    // §5.3 satır 15 — "kalıcı silme, kategori silme -> A, M": MANAGER da kalıcı silebilir
    // (eski davranış: ADMIN-only). USER (blockedToken) hâlâ 403 alır (yukarıda doğrulandı).
    const permanent = await app.inject({
      method: "DELETE",
      url: `/api/v1/admin/products/${productId}/permanent`,
      headers: authHeader(managerToken),
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
      headers: authHeader(managerToken),
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
      headers: authHeader(managerToken),
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
      headers: authHeader(managerToken),
      payload: { title: "Taslak Ürün", priceCents: 2500 },
    });
    const draft = create.json().data;
    expect(draft.status).toBe("DRAFT");

    const publicDraft = await app.inject({ method: "GET", url: `/api/v1/products/${draft.slug}` });
    expect(publicDraft.statusCode).toBe(404);

    const publishedCreate = await app.inject({
      method: "POST",
      url: "/api/v1/admin/products",
      headers: authHeader(managerToken),
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
      headers: authHeader(managerToken),
      payload: { title: "Negatif Stok Denemesi", priceCents: 1000, stockQuantity: -5 },
    });
    expect(create.statusCode).toBe(422);

    const validProduct = await app.inject({
      method: "POST",
      url: "/api/v1/admin/products",
      headers: authHeader(managerToken),
      payload: { title: "Stok Düzeltme Denemesi", priceCents: 1000 },
    });
    const productId = validProduct.json().data.id;

    const adjust = await app.inject({
      method: "PATCH",
      url: `/api/v1/admin/products/${productId}/stock`,
      headers: authHeader(managerToken),
      payload: { stockQuantity: -1 },
    });
    expect(adjust.statusCode).toBe(422);
  });

  it("discountPriceCents priceCents'ten büyük/eşitse 422 döner (create ve update)", async () => {
    const createInvalid = await app.inject({
      method: "POST",
      url: "/api/v1/admin/products",
      headers: authHeader(managerToken),
      payload: { title: "İndirim Hatalı Ürün", priceCents: 1000, discountPriceCents: 1000 },
    });
    expect(createInvalid.statusCode).toBe(422);

    const create = await app.inject({
      method: "POST",
      url: "/api/v1/admin/products",
      headers: authHeader(managerToken),
      payload: { title: "İndirim Geçerli Ürün", priceCents: 1000, discountPriceCents: 500 },
    });
    expect(create.statusCode).toBe(201);
    const productId = create.json().data.id;

    // Yalnızca discountPriceCents gönderilip mevcut priceCents'e göre çapraz kontrol edilmeli.
    const updateInvalid = await app.inject({
      method: "PATCH",
      url: `/api/v1/admin/products/${productId}`,
      headers: authHeader(managerToken),
      payload: { discountPriceCents: 1000 },
    });
    expect(updateInvalid.statusCode).toBe(422);

    const updateValid = await app.inject({
      method: "PATCH",
      url: `/api/v1/admin/products/${productId}`,
      headers: authHeader(managerToken),
      payload: { discountPriceCents: 800 },
    });
    expect(updateValid.statusCode).toBe(200);
    expect(updateValid.json().data.discountPriceCents).toBe(800);
  });

  it("kategori CRUD: ADMIN/MANAGER oluşturabilir VE silebilir; USER hiçbirini yapamaz (§5.3 satır 15)", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/api/v1/admin/products/categories",
      headers: authHeader(managerToken),
      payload: { name: "Elektronik" },
    });
    expect(create.statusCode).toBe(201);
    const category = create.json().data;
    expect(category.slug).toBe("elektronik");

    const forbiddenDelete = await app.inject({
      method: "DELETE",
      url: `/api/v1/admin/products/categories/${category.id}`,
      headers: authHeader(blockedToken),
    });
    expect(forbiddenDelete.statusCode).toBe(403);

    // §5.3 satır 15 — MANAGER da kategori silebilir (eski davranış: ADMIN-only).
    const del = await app.inject({
      method: "DELETE",
      url: `/api/v1/admin/products/categories/${category.id}`,
      headers: authHeader(managerToken),
    });
    expect(del.statusCode).toBe(204);
  });

  // Faz 5 — §10.1/§10.7 toplu işlem. Ortak helper (bkz. lib/bulk-content-actions.ts); blog/pages
  // ile BİREBİR aynı davranış, burada yalnızca ürüne özgü audit action öneki (`product.bulk_*`) doğrulanır.
  describe("toplu işlem (Faz 5 — bulk)", () => {
    it("publish/draft/trash/restore — MANAGER ile başarılı, karışık geçerli/geçersiz ID listesinde kısmi başarı (200 + skippedIds)", async () => {
      const missingId = "00000000-0000-0000-0000-000000000099";

      const create1 = await app.inject({
        method: "POST",
        url: "/api/v1/admin/products",
        headers: authHeader(managerToken),
        payload: { title: "Bulk Ürün 1", priceCents: 1000 },
      });
      const create2 = await app.inject({
        method: "POST",
        url: "/api/v1/admin/products",
        headers: authHeader(managerToken),
        payload: { title: "Bulk Ürün 2", priceCents: 1000 },
      });
      const id1 = create1.json().data.id;
      const id2 = create2.json().data.id;

      const publish = await app.inject({
        method: "POST",
        url: "/api/v1/admin/products/bulk",
        headers: authHeader(managerToken),
        payload: { ids: [id1, id2, missingId], action: "publish" },
      });
      expect(publish.statusCode).toBe(200);
      expect(publish.json().data).toMatchObject({ action: "publish", requestedCount: 3, affectedCount: 2 });
      expect(publish.json().data.skippedIds).toEqual([missingId]);

      const get1 = await app.inject({
        method: "GET",
        url: `/api/v1/admin/products/${id1}`,
        headers: authHeader(managerToken),
      });
      expect(get1.json().data.status).toBe("PUBLISHED");

      const draft = await app.inject({
        method: "POST",
        url: "/api/v1/admin/products/bulk",
        headers: authHeader(managerToken),
        payload: { ids: [id1, missingId], action: "draft" },
      });
      expect(draft.statusCode).toBe(200);
      expect(draft.json().data.affectedCount).toBe(1);
      expect(draft.json().data.skippedIds).toContain(missingId);
      const afterDraft = await app.inject({
        method: "GET",
        url: `/api/v1/admin/products/${id1}`,
        headers: authHeader(managerToken),
      });
      expect(afterDraft.json().data.status).toBe("DRAFT");

      const trash = await app.inject({
        method: "POST",
        url: "/api/v1/admin/products/bulk",
        headers: authHeader(managerToken),
        payload: { ids: [id1, id2, missingId], action: "trash" },
      });
      expect(trash.statusCode).toBe(200);
      expect(trash.json().data.affectedCount).toBe(2);
      expect(trash.json().data.skippedIds).toContain(missingId);

      const restore = await app.inject({
        method: "POST",
        url: "/api/v1/admin/products/bulk",
        headers: authHeader(managerToken),
        payload: { ids: [id1, missingId], action: "restore" },
      });
      expect(restore.statusCode).toBe(200);
      expect(restore.json().data.affectedCount).toBe(1);
      expect(restore.json().data.skippedIds).toContain(missingId);
      const afterRestore = await app.inject({
        method: "GET",
        url: `/api/v1/admin/products/${id1}`,
        headers: authHeader(managerToken),
      });
      expect(afterRestore.json().data.deletedAt).toBeNull();
    });

    it("permanent-delete — USER'a 403, ADMIN'e 200 ve ContentRevision satırları da silinir", async () => {
      const create = await app.inject({
        method: "POST",
        url: "/api/v1/admin/products",
        headers: authHeader(adminToken),
        payload: { title: "Bulk Kalıcı Silme Ürünü", priceCents: 1000 },
      });
      const productId = create.json().data.id;

      // Revizyon üret.
      await app.inject({
        method: "PATCH",
        url: `/api/v1/admin/products/${productId}`,
        headers: authHeader(adminToken),
        payload: { title: "Güncellendi" },
      });
      const revisionsBefore = await app.prisma.contentRevision.count({
        where: { entityType: "PRODUCT", entityId: productId },
      });
      expect(revisionsBefore).toBeGreaterThan(0);

      // permanent-delete öncesi çöpe taşınmalı (aksi halde skippedIds'e düşer).
      await app.inject({
        method: "POST",
        url: "/api/v1/admin/products/bulk",
        headers: authHeader(adminToken),
        payload: { ids: [productId], action: "trash" },
      });

      const blockedAttempt = await app.inject({
        method: "POST",
        url: "/api/v1/admin/products/bulk",
        headers: authHeader(blockedToken),
        payload: { ids: [productId], action: "permanent-delete" },
      });
      expect(blockedAttempt.statusCode).toBe(403);

      // USER'ın reddedilen isteği kısmi bile olsa UYGULANMAMALI.
      const stillThere = await app.inject({
        method: "GET",
        url: `/api/v1/admin/products/${productId}`,
        headers: authHeader(adminToken),
      });
      expect(stillThere.statusCode).toBe(200);

      const adminAttempt = await app.inject({
        method: "POST",
        url: "/api/v1/admin/products/bulk",
        headers: authHeader(adminToken),
        payload: { ids: [productId], action: "permanent-delete" },
      });
      expect(adminAttempt.statusCode).toBe(200);
      expect(adminAttempt.json().data.affectedCount).toBe(1);

      const get = await app.inject({
        method: "GET",
        url: `/api/v1/admin/products/${productId}`,
        headers: authHeader(adminToken),
      });
      expect(get.statusCode).toBe(404);

      const revisionsAfter = await app.prisma.contentRevision.count({
        where: { entityType: "PRODUCT", entityId: productId },
      });
      expect(revisionsAfter).toBe(0);
    });

    // NOT: `trash` (permanent-delete'in AKSİNE) `ContentRevision` satırlarını SİLMEZ — yalnızca
    // kalıcı silme yapar (bkz. lib/bulk-content-actions.ts switch/case). Bu davranış farkı
    // bilinçlidir: çöpe taşınan bir içerik geri yüklenebilir olmalı, revizyon geçmişi kaybolmamalı.
    it("bulk trash bir audit log satırı yazar (product.bulk_trash) ve ContentRevision satırlarını SİLMEZ", async () => {
      const create = await app.inject({
        method: "POST",
        url: "/api/v1/admin/products",
        headers: authHeader(adminToken),
        payload: { title: "Audit Log Ürünü", priceCents: 1000 },
      });
      const productId = create.json().data.id;

      await app.inject({
        method: "PATCH",
        url: `/api/v1/admin/products/${productId}`,
        headers: authHeader(adminToken),
        payload: { title: "Değişti" },
      });
      const revisionCountBefore = await app.prisma.contentRevision.count({
        where: { entityType: "PRODUCT", entityId: productId },
      });
      expect(revisionCountBefore).toBe(1);

      const trash = await app.inject({
        method: "POST",
        url: "/api/v1/admin/products/bulk",
        headers: authHeader(adminToken),
        payload: { ids: [productId], action: "trash" },
      });
      expect(trash.statusCode).toBe(200);

      const auditRow = await app.prisma.auditLog.findFirst({
        where: { action: "product.bulk_trash", targetType: "Product" },
        orderBy: { createdAt: "desc" },
      });
      expect(auditRow).not.toBeNull();
      expect((auditRow?.metadata as { ids: string[] } | null)?.ids).toContain(productId);

      const revisionCountAfter = await app.prisma.contentRevision.count({
        where: { entityType: "PRODUCT", entityId: productId },
      });
      expect(revisionCountAfter).toBe(1);
    });
  });

  // Faz 3 (autosave) — bilinçli olarak revizyonsuz/audit'siz (bkz. lib/content-revisions.ts,
  // blog.test.ts'teki AYNI blok).
  describe("autosave (Faz 3)", () => {
    it("dar alan seti (title/excerpt/descriptionHtml) günceller, sanitize eder, revizyon VEYA audit log ÜRETMEZ", async () => {
      const create = await app.inject({
        method: "POST",
        url: "/api/v1/admin/products",
        headers: authHeader(managerToken),
        payload: { title: "Autosave Öncesi Ürün", priceCents: 1000 },
      });
      const productId = create.json().data.id;

      const revisionsBefore = await app.inject({
        method: "GET",
        url: `/api/v1/admin/products/${productId}/revisions`,
        headers: authHeader(managerToken),
      });
      expect(revisionsBefore.json().data).toHaveLength(0);

      const auditCountBefore = await app.prisma.auditLog.count();

      const autosave = await app.inject({
        method: "POST",
        url: `/api/v1/admin/products/${productId}/autosave`,
        headers: authHeader(managerToken),
        payload: {
          title: "Autosave Sonrası Ürün",
          excerpt: "Kısa özet",
          descriptionHtml: '<p>Merhaba</p><script>alert(1)</script>',
        },
      });
      expect(autosave.statusCode).toBe(200);
      expect(autosave.json().data).toEqual({ savedAt: expect.any(String) });

      const revisionsAfter = await app.inject({
        method: "GET",
        url: `/api/v1/admin/products/${productId}/revisions`,
        headers: authHeader(managerToken),
      });
      expect(revisionsAfter.json().data).toHaveLength(0);

      const auditCountAfter = await app.prisma.auditLog.count();
      expect(auditCountAfter).toBe(auditCountBefore);

      const get = await app.inject({
        method: "GET",
        url: `/api/v1/admin/products/${productId}`,
        headers: authHeader(managerToken),
      });
      const dto = get.json().data;
      expect(dto.title).toBe("Autosave Sonrası Ürün");
      expect(dto.excerpt).toBe("Kısa özet");
      expect(dto.descriptionHtml).not.toContain("<script");
      expect(dto.descriptionHtml).toContain("Merhaba");
    });

    it("çöpteki üründe autosave 409 döner", async () => {
      const create = await app.inject({
        method: "POST",
        url: "/api/v1/admin/products",
        headers: authHeader(managerToken),
        payload: { title: "Çöpteyken Autosave Ürünü", priceCents: 1000 },
      });
      const productId = create.json().data.id;
      await app.inject({
        method: "DELETE",
        url: `/api/v1/admin/products/${productId}`,
        headers: authHeader(managerToken),
      });

      const autosave = await app.inject({
        method: "POST",
        url: `/api/v1/admin/products/${productId}/autosave`,
        headers: authHeader(managerToken),
        payload: { title: "Değişmemeli" },
      });
      expect(autosave.statusCode).toBe(409);
    });

    // Mass-assignment koruması — `AutosaveProductRequestSchema` şema seviyesinde bu alanları
    // TANIMLAMAZ, bu yüzden fastify-type-provider-zod (zod'un varsayılan davranışı gereği)
    // bilinmeyen alanları SESSİZCE ATAR — hata dönmez ama etkisi de olmaz.
    it("ekstra/yasak alan (priceCents/status/sku) body'de gönderilse dahi yok sayılır (mass-assignment koruması)", async () => {
      const originalSku = `MA-${crypto.randomUUID()}`;
      const create = await app.inject({
        method: "POST",
        url: "/api/v1/admin/products",
        headers: authHeader(managerToken),
        payload: { title: "Mass Assignment Ürünü", priceCents: 1000, sku: originalSku },
      });
      const productId = create.json().data.id;

      const autosave = await app.inject({
        method: "POST",
        url: `/api/v1/admin/products/${productId}/autosave`,
        headers: authHeader(managerToken),
        payload: {
          title: "Autosave İle Değişen Başlık",
          priceCents: 999999,
          status: "PUBLISHED",
          sku: "HACKED-SKU",
        },
      });
      expect(autosave.statusCode).toBe(200);

      const get = await app.inject({
        method: "GET",
        url: `/api/v1/admin/products/${productId}`,
        headers: authHeader(managerToken),
      });
      const dto = get.json().data;
      expect(dto.title).toBe("Autosave İle Değişen Başlık");
      expect(dto.priceCents).toBe(1000);
      expect(dto.status).toBe("DRAFT");
      expect(dto.sku).toBe(originalSku);
    });
  });

  // §10.1 İçerik Sürüm Kontrolü — Page/BlogPost ile BİREBİR aynı sözleşme, TEK FARK: ticari
  // alanların (fiyat/indirim/SKU/stok) da geri geldiğini ve 422 dalını (çapraz-alan doğrulaması)
  // doğrular (bkz. products.routes.ts::assertDiscountBelowPrice, openapi.yaml).
  describe("revizyonlar (§10.1)", () => {
    it("PATCH sonrası revizyon oluşur, GET revisions listeler, GET revisions/:id tam snapshot döner", async () => {
      const create = await app.inject({
        method: "POST",
        url: "/api/v1/admin/products",
        headers: authHeader(adminToken),
        payload: { title: "Revizyon Ürünü V1", priceCents: 1000 },
      });
      const productId = create.json().data.id;

      const patch = await app.inject({
        method: "PATCH",
        url: `/api/v1/admin/products/${productId}`,
        headers: authHeader(adminToken),
        payload: { title: "Revizyon Ürünü V2" },
      });
      expect(patch.statusCode).toBe(200);

      const list = await app.inject({
        method: "GET",
        url: `/api/v1/admin/products/${productId}/revisions`,
        headers: authHeader(adminToken),
      });
      expect(list.statusCode).toBe(200);
      const revisions = list.json().data;
      expect(revisions).toHaveLength(1);
      expect(revisions[0].editedById).toBe(adminId);

      const detail = await app.inject({
        method: "GET",
        url: `/api/v1/admin/products/${productId}/revisions/${revisions[0].id}`,
        headers: authHeader(adminToken),
      });
      expect(detail.statusCode).toBe(200);
      expect(detail.json().data.entityType).toBe("PRODUCT");
      expect(detail.json().data.snapshot.title).toBe("Revizyon Ürünü V1");
    });

    it("cross-entity IDOR: bir ürünün revision ID'siyle BAŞKA bir ürünün/blog yazısının revisions ucuna istek 404 döner", async () => {
      const productA = await app.inject({
        method: "POST",
        url: "/api/v1/admin/products",
        headers: authHeader(adminToken),
        payload: { title: "IDOR Ürün A", priceCents: 1000 },
      });
      const productAId = productA.json().data.id;
      await app.inject({
        method: "PATCH",
        url: `/api/v1/admin/products/${productAId}`,
        headers: authHeader(adminToken),
        payload: { title: "IDOR Ürün A v2" },
      });
      const revisionsA = (
        await app.inject({
          method: "GET",
          url: `/api/v1/admin/products/${productAId}/revisions`,
          headers: authHeader(adminToken),
        })
      ).json().data;
      const revisionAId = revisionsA[0].id;

      const productB = await app.inject({
        method: "POST",
        url: "/api/v1/admin/products",
        headers: authHeader(adminToken),
        payload: { title: "IDOR Ürün B", priceCents: 1000 },
      });
      const productBId = productB.json().data.id;

      const crossProduct = await app.inject({
        method: "GET",
        url: `/api/v1/admin/products/${productBId}/revisions/${revisionAId}`,
        headers: authHeader(adminToken),
      });
      expect(crossProduct.statusCode).toBe(404);

      // Farklı entity TÜRÜ (blog) ile de aynı koruma — `entityType` karşılaştırması da devrede.
      const blogPost = await app.inject({
        method: "POST",
        url: "/api/v1/admin/blog",
        headers: authHeader(adminToken),
        payload: { title: "IDOR Blog Yazısı" },
      });
      const blogPostId = blogPost.json().data.id;

      const crossType = await app.inject({
        method: "GET",
        url: `/api/v1/admin/blog/${blogPostId}/revisions/${revisionAId}`,
        headers: authHeader(adminToken),
      });
      expect(crossType.statusCode).toBe(404);
    });

    it("restore eski duruma döner — ticari alanlar (priceCents/discountPriceCents/sku/stockQuantity) da geri gelir", async () => {
      const originalSku = `SKU-${crypto.randomUUID()}`;
      const create = await app.inject({
        method: "POST",
        url: "/api/v1/admin/products",
        headers: authHeader(adminToken),
        payload: {
          title: "Restore Ticari Ürün",
          priceCents: 1000,
          discountPriceCents: 500,
          sku: originalSku,
          stockQuantity: 5,
        },
      });
      const productId = create.json().data.id;

      const patch = await app.inject({
        method: "PATCH",
        url: `/api/v1/admin/products/${productId}`,
        headers: authHeader(adminToken),
        payload: {
          priceCents: 2000,
          discountPriceCents: null,
          sku: `SKU-${crypto.randomUUID()}`,
          stockQuantity: 50,
        },
      });
      expect(patch.statusCode).toBe(200);

      const revisions = (
        await app.inject({
          method: "GET",
          url: `/api/v1/admin/products/${productId}/revisions`,
          headers: authHeader(adminToken),
        })
      ).json().data;

      const restore = await app.inject({
        method: "POST",
        url: `/api/v1/admin/products/${productId}/revisions/${revisions[0].id}/restore`,
        headers: authHeader(adminToken),
      });
      expect(restore.statusCode).toBe(200);
      const restored = restore.json().data;
      expect(restored.priceCents).toBe(1000);
      expect(restored.discountPriceCents).toBe(500);
      expect(restored.sku).toBe(originalSku);
      expect(restored.stockQuantity).toBe(5);
    });

    it("discountPriceCents >= priceCents olan bozuk bir eski snapshot geri yüklenmeye çalışılırsa 422 döner (yalnızca products)", async () => {
      const create = await app.inject({
        method: "POST",
        url: "/api/v1/admin/products",
        headers: authHeader(adminToken),
        payload: { title: "Bozuk Snapshot Ürünü", priceCents: 1000 },
      });
      const productId = create.json().data.id;

      const patch = await app.inject({
        method: "PATCH",
        url: `/api/v1/admin/products/${productId}`,
        headers: authHeader(adminToken),
        payload: { title: "Bozuk Snapshot Ürünü v2" },
      });
      expect(patch.statusCode).toBe(200);

      const revisions = (
        await app.inject({
          method: "GET",
          url: `/api/v1/admin/products/${productId}/revisions`,
          headers: authHeader(adminToken),
        })
      ).json().data;
      const revisionId = revisions[0].id;

      // Eski (kusurlu) bir sistemden kalmış, o zamanki doğrulamayı atlatmış bir snapshot'ı simüle et.
      const existingRevision = await app.prisma.contentRevision.findUniqueOrThrow({ where: { id: revisionId } });
      await app.prisma.contentRevision.update({
        where: { id: revisionId },
        data: {
          snapshot: {
            ...(existingRevision.snapshot as Record<string, unknown>),
            priceCents: 1000,
            discountPriceCents: 1000,
          },
        },
      });

      const restore = await app.inject({
        method: "POST",
        url: `/api/v1/admin/products/${productId}/revisions/${revisionId}/restore`,
        headers: authHeader(adminToken),
      });
      expect(restore.statusCode).toBe(422);

      // Doğrulama düşünce HİÇBİR ŞEY yazılmamalı.
      const get = await app.inject({
        method: "GET",
        url: `/api/v1/admin/products/${productId}`,
        headers: authHeader(adminToken),
      });
      expect(get.json().data.title).toBe("Bozuk Snapshot Ürünü v2");
    });

    it("restore edilen descriptionHtml yeniden sanitize edilir (script tag içeren eski snapshot)", async () => {
      const create = await app.inject({
        method: "POST",
        url: "/api/v1/admin/products",
        headers: authHeader(adminToken),
        payload: { title: "XSS Snapshot Ürünü", priceCents: 1000 },
      });
      const productId = create.json().data.id;

      const patch = await app.inject({
        method: "PATCH",
        url: `/api/v1/admin/products/${productId}`,
        headers: authHeader(adminToken),
        payload: { title: "XSS Snapshot Ürünü v2" },
      });
      expect(patch.statusCode).toBe(200);

      const revisions = (
        await app.inject({
          method: "GET",
          url: `/api/v1/admin/products/${productId}/revisions`,
          headers: authHeader(adminToken),
        })
      ).json().data;
      const revisionId = revisions[0].id;

      const existingRevision = await app.prisma.contentRevision.findUniqueOrThrow({ where: { id: revisionId } });
      await app.prisma.contentRevision.update({
        where: { id: revisionId },
        data: {
          snapshot: {
            ...(existingRevision.snapshot as Record<string, unknown>),
            descriptionHtml: '<p>Eski İçerik</p><script>alert(1)</script><a href="javascript:alert(2)">tık</a>',
          },
        },
      });

      const restore = await app.inject({
        method: "POST",
        url: `/api/v1/admin/products/${productId}/revisions/${revisionId}/restore`,
        headers: authHeader(adminToken),
      });
      expect(restore.statusCode).toBe(200);
      const html = restore.json().data.descriptionHtml as string;
      expect(html).not.toContain("<script");
      expect(html).not.toContain("javascript:");
      expect(html).toContain("Eski İçerik");
    });

    it("restore hedefi slug/sku başka bir kayıtla çakışıyorsa 409 döner", async () => {
      // slug çakışması.
      const productA = await app.inject({
        method: "POST",
        url: "/api/v1/admin/products",
        headers: authHeader(adminToken),
        payload: {
          title: "Çakışma Ürünü A",
          slug: `carpisma-urunu-a-${crypto.randomUUID()}`,
          priceCents: 1000,
        },
      });
      const productAId = productA.json().data.id;
      const originalSlug = productA.json().data.slug;

      await app.inject({
        method: "PATCH",
        url: `/api/v1/admin/products/${productAId}`,
        headers: authHeader(adminToken),
        payload: { slug: `carpisma-urunu-a-degisti-${crypto.randomUUID()}` },
      });
      const revisionsA = (
        await app.inject({
          method: "GET",
          url: `/api/v1/admin/products/${productAId}/revisions`,
          headers: authHeader(adminToken),
        })
      ).json().data;

      // B, A'nın ESKİ slug'ını devralsın.
      const productB = await app.inject({
        method: "POST",
        url: "/api/v1/admin/products",
        headers: authHeader(adminToken),
        payload: { title: "Çakışma Ürünü B", slug: originalSlug, priceCents: 1000 },
      });
      expect(productB.statusCode).toBe(201);

      const restoreSlug = await app.inject({
        method: "POST",
        url: `/api/v1/admin/products/${productAId}/revisions/${revisionsA[0].id}/restore`,
        headers: authHeader(adminToken),
      });
      expect(restoreSlug.statusCode).toBe(409);

      // sku çakışması.
      const sku = `SKU-CONFLICT-${crypto.randomUUID()}`;
      const productC = await app.inject({
        method: "POST",
        url: "/api/v1/admin/products",
        headers: authHeader(adminToken),
        payload: { title: "Çakışma Ürünü C", sku, priceCents: 1000 },
      });
      const productCId = productC.json().data.id;

      await app.inject({
        method: "PATCH",
        url: `/api/v1/admin/products/${productCId}`,
        headers: authHeader(adminToken),
        payload: { sku: `SKU-CHANGED-${crypto.randomUUID()}` },
      });
      const revisionsC = (
        await app.inject({
          method: "GET",
          url: `/api/v1/admin/products/${productCId}/revisions`,
          headers: authHeader(adminToken),
        })
      ).json().data;

      const productD = await app.inject({
        method: "POST",
        url: "/api/v1/admin/products",
        headers: authHeader(adminToken),
        payload: { title: "Çakışma Ürünü D", sku, priceCents: 1000 },
      });
      expect(productD.statusCode).toBe(201);

      const restoreSku = await app.inject({
        method: "POST",
        url: `/api/v1/admin/products/${productCId}/revisions/${revisionsC[0].id}/restore`,
        headers: authHeader(adminToken),
      });
      expect(restoreSku.statusCode).toBe(409);
    });
  });
});

/**
 * REGRESYON (qa-agent bulgusu) — `TEXT` tipinde bir varyasyon ekseninde `swatchHex`
 * gönderilmeden (§1.1 kuralı: `TEXT` eksende `swatchHex` YASAK) ürün + varyasyon oluşturmak,
 * yazma şemasınca (`modules/products/lib/variants.ts`) kabul edilir ve DB'ye `swatchHex`
 * ANAHTARI OLMADAN yazılır. Bu test, o satırı GERİ OKUYAN uçların (`GET /admin/products`,
 * `GET /admin/products/{id}`, `GET /products`, `GET /products/{slug}`) `500
 * FST_ERR_RESPONSE_SERIALIZATION` ile PATLAMADIĞINI doğrudan doğrular — daha önce okuma şeması
 * (`schemas/entities.ts::ProductVariantOptionSchema`) `swatchHex`'i `.optional()` OLMADAN
 * modellediği için bu uçların TAMAMI kalıcı olarak 500 dönüyordu (bkz.
 * `templates/ecommerce-pro.ts`'teki "Modüler Raf Sistemi" ürününün "Ölçü" ekseni, gerçek
 * tetikleyici veri).
 */
describe("products — REGRESYON: TEXT eksende swatchHex olmadan oluşturulan varyasyon GERİ OKUNABİLİR (500 vermez)", () => {
  let app: FastifyInstance;
  let adminToken: string;

  function authHeader(token: string) {
    return { authorization: `Bearer ${token}` };
  }

  beforeAll(async () => {
    const { buildTestApp } = await import("../helpers/build-test-app");
    const { resetDatabase } = await import("../helpers/reset-db");
    const { registerTestUser } = await import("../helpers/auth");

    app = await buildTestApp();
    await resetDatabase(app.prisma);

    const admin = await registerTestUser(app, { email: "products-text-axis-regression-admin@example.com" });
    adminToken = admin.accessToken;
  });

  afterAll(async () => {
    const { resetDatabase } = await import("../helpers/reset-db");
    await resetDatabase(app.prisma);
    await app.close();
  });

  it("TEXT ekseni (swatchHex YOK) + varyasyon oluştur → liste/detay/public uçları 200 döner ve swatchHex null/undefined güvenle serileşir", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/api/v1/admin/products",
      headers: authHeader(adminToken),
      payload: {
        title: "Modüler Raf Sistemi (Regresyon)",
        priceCents: 219900,
        status: "PUBLISHED",
        // §1.1 — TEXT eksende `swatchHex` HİÇ gönderilmez (bkz. templates/ecommerce-pro.ts
        // "Ölçü" ekseniyle BİREBİR aynı şekil — gerçek tetikleyici veri).
        variantOptions: [{ name: "Ölçü", type: "TEXT", values: [{ value: "120 cm" }, { value: "180 cm" }] }],
      },
    });
    expect(create.statusCode).toBe(201);
    const product = create.json().data;
    expect(product.variantOptions[0].values[0]).not.toHaveProperty("swatchHex");

    const addVariant = await app.inject({
      method: "POST",
      url: `/api/v1/admin/products/${product.id}/variants`,
      headers: authHeader(adminToken),
      payload: { optionValues: { Ölçü: "120 cm" }, stockQuantity: 5 },
    });
    expect(addVariant.statusCode).toBe(201);

    // Regresyonun ASIL kanıtı: bu dört okuma ucunun HİÇBİRİ 500 FST_ERR_RESPONSE_SERIALIZATION
    // ile patlamamalı (önceki hatalı şemada TÜMÜ kalıcı olarak 500 dönüyordu).
    const adminList = await app.inject({ method: "GET", url: "/api/v1/admin/products", headers: authHeader(adminToken) });
    expect(adminList.statusCode).toBe(200);

    const adminDetail = await app.inject({
      method: "GET",
      url: `/api/v1/admin/products/${product.id}`,
      headers: authHeader(adminToken),
    });
    expect(adminDetail.statusCode).toBe(200);
    expect(adminDetail.json().data.variantOptions[0].values[0].value).toBe("120 cm");

    const publicList = await app.inject({ method: "GET", url: "/api/v1/products" });
    expect(publicList.statusCode).toBe(200);

    const publicDetail = await app.inject({ method: "GET", url: `/api/v1/products/${product.slug}` });
    expect(publicDetail.statusCode).toBe(200);
    expect(publicDetail.json().data.variants[0].optionValues).toEqual({ Ölçü: "120 cm" });
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
