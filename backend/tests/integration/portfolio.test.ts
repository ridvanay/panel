import crypto from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";

describe("portfolio (§10.9.4 Portföy Modülü)", () => {
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

  // Faz 5 — §10.1/§10.7 toplu işlem. Ortak helper (bkz. lib/bulk-content-actions.ts); products.test.ts
  // ile BİREBİR aynı davranış, burada yalnızca öğeye özgü audit action öneki (`portfolio_item.bulk_*`) doğrulanır.
  describe("toplu işlem (Faz 5 — bulk)", () => {
    it("publish/draft/trash/restore — EDITOR ile başarılı, karışık geçerli/geçersiz ID listesinde kısmi başarı (200 + skippedIds)", async () => {
      const missingId = "00000000-0000-0000-0000-000000000099";

      const create1 = await app.inject({
        method: "POST",
        url: "/api/v1/admin/portfolio",
        headers: authHeader(editorToken),
        payload: { title: "Bulk Proje 1" },
      });
      const create2 = await app.inject({
        method: "POST",
        url: "/api/v1/admin/portfolio",
        headers: authHeader(editorToken),
        payload: { title: "Bulk Proje 2" },
      });
      const id1 = create1.json().data.id;
      const id2 = create2.json().data.id;

      const publish = await app.inject({
        method: "POST",
        url: "/api/v1/admin/portfolio/bulk",
        headers: authHeader(editorToken),
        payload: { ids: [id1, id2, missingId], action: "publish" },
      });
      expect(publish.statusCode).toBe(200);
      expect(publish.json().data).toMatchObject({ action: "publish", requestedCount: 3, affectedCount: 2 });
      expect(publish.json().data.skippedIds).toEqual([missingId]);

      const get1 = await app.inject({
        method: "GET",
        url: `/api/v1/admin/portfolio/${id1}`,
        headers: authHeader(editorToken),
      });
      expect(get1.json().data.status).toBe("PUBLISHED");

      const draft = await app.inject({
        method: "POST",
        url: "/api/v1/admin/portfolio/bulk",
        headers: authHeader(editorToken),
        payload: { ids: [id1, missingId], action: "draft" },
      });
      expect(draft.statusCode).toBe(200);
      expect(draft.json().data.affectedCount).toBe(1);
      expect(draft.json().data.skippedIds).toContain(missingId);
      const afterDraft = await app.inject({
        method: "GET",
        url: `/api/v1/admin/portfolio/${id1}`,
        headers: authHeader(editorToken),
      });
      expect(afterDraft.json().data.status).toBe("DRAFT");

      const trash = await app.inject({
        method: "POST",
        url: "/api/v1/admin/portfolio/bulk",
        headers: authHeader(editorToken),
        payload: { ids: [id1, id2, missingId], action: "trash" },
      });
      expect(trash.statusCode).toBe(200);
      expect(trash.json().data.affectedCount).toBe(2);
      expect(trash.json().data.skippedIds).toContain(missingId);

      const restore = await app.inject({
        method: "POST",
        url: "/api/v1/admin/portfolio/bulk",
        headers: authHeader(editorToken),
        payload: { ids: [id1, missingId], action: "restore" },
      });
      expect(restore.statusCode).toBe(200);
      expect(restore.json().data.affectedCount).toBe(1);
      expect(restore.json().data.skippedIds).toContain(missingId);
      const afterRestore = await app.inject({
        method: "GET",
        url: `/api/v1/admin/portfolio/${id1}`,
        headers: authHeader(editorToken),
      });
      expect(afterRestore.json().data.deletedAt).toBeNull();
    });

    it("permanent-delete — EDITOR'e 403, ADMIN'e 200 ve ContentRevision satırları da silinir", async () => {
      const create = await app.inject({
        method: "POST",
        url: "/api/v1/admin/portfolio",
        headers: authHeader(adminToken),
        payload: { title: "Bulk Kalıcı Silme Projesi" },
      });
      const itemId = create.json().data.id;

      await app.inject({
        method: "PATCH",
        url: `/api/v1/admin/portfolio/${itemId}`,
        headers: authHeader(adminToken),
        payload: { title: "Güncellendi" },
      });
      const revisionsBefore = await app.prisma.contentRevision.count({
        where: { entityType: "PORTFOLIO_ITEM", entityId: itemId },
      });
      expect(revisionsBefore).toBeGreaterThan(0);

      await app.inject({
        method: "POST",
        url: "/api/v1/admin/portfolio/bulk",
        headers: authHeader(adminToken),
        payload: { ids: [itemId], action: "trash" },
      });

      const editorAttempt = await app.inject({
        method: "POST",
        url: "/api/v1/admin/portfolio/bulk",
        headers: authHeader(editorToken),
        payload: { ids: [itemId], action: "permanent-delete" },
      });
      expect(editorAttempt.statusCode).toBe(403);

      const stillThere = await app.inject({
        method: "GET",
        url: `/api/v1/admin/portfolio/${itemId}`,
        headers: authHeader(adminToken),
      });
      expect(stillThere.statusCode).toBe(200);

      const adminAttempt = await app.inject({
        method: "POST",
        url: "/api/v1/admin/portfolio/bulk",
        headers: authHeader(adminToken),
        payload: { ids: [itemId], action: "permanent-delete" },
      });
      expect(adminAttempt.statusCode).toBe(200);
      expect(adminAttempt.json().data.affectedCount).toBe(1);

      const get = await app.inject({
        method: "GET",
        url: `/api/v1/admin/portfolio/${itemId}`,
        headers: authHeader(adminToken),
      });
      expect(get.statusCode).toBe(404);

      const revisionsAfter = await app.prisma.contentRevision.count({
        where: { entityType: "PORTFOLIO_ITEM", entityId: itemId },
      });
      expect(revisionsAfter).toBe(0);
    });

    // NOT: `trash` (permanent-delete'in AKSİNE) `ContentRevision` satırlarını SİLMEZ.
    it("bulk trash bir audit log satırı yazar (portfolio_item.bulk_trash) ve ContentRevision satırlarını SİLMEZ", async () => {
      const create = await app.inject({
        method: "POST",
        url: "/api/v1/admin/portfolio",
        headers: authHeader(adminToken),
        payload: { title: "Audit Log Projesi" },
      });
      const itemId = create.json().data.id;

      await app.inject({
        method: "PATCH",
        url: `/api/v1/admin/portfolio/${itemId}`,
        headers: authHeader(adminToken),
        payload: { title: "Değişti" },
      });
      const revisionCountBefore = await app.prisma.contentRevision.count({
        where: { entityType: "PORTFOLIO_ITEM", entityId: itemId },
      });
      expect(revisionCountBefore).toBe(1);

      const trash = await app.inject({
        method: "POST",
        url: "/api/v1/admin/portfolio/bulk",
        headers: authHeader(adminToken),
        payload: { ids: [itemId], action: "trash" },
      });
      expect(trash.statusCode).toBe(200);

      const auditRow = await app.prisma.auditLog.findFirst({
        where: { action: "portfolio_item.bulk_trash", targetType: "PortfolioItem" },
        orderBy: { createdAt: "desc" },
      });
      expect(auditRow).not.toBeNull();
      expect((auditRow?.metadata as { ids: string[] } | null)?.ids).toContain(itemId);

      const revisionCountAfter = await app.prisma.contentRevision.count({
        where: { entityType: "PORTFOLIO_ITEM", entityId: itemId },
      });
      expect(revisionCountAfter).toBe(1);
    });
  });

  // Faz 3 (autosave) — bilinçli olarak revizyonsuz/audit'siz (bkz. lib/content-revisions.ts,
  // products.test.ts'teki AYNI blok).
  describe("autosave (Faz 3)", () => {
    it("dar alan seti (title/summary/contentHtml) günceller, sanitize eder, revizyon VEYA audit log ÜRETMEZ", async () => {
      const create = await app.inject({
        method: "POST",
        url: "/api/v1/admin/portfolio",
        headers: authHeader(editorToken),
        payload: { title: "Autosave Öncesi Proje" },
      });
      const itemId = create.json().data.id;

      const revisionsBefore = await app.inject({
        method: "GET",
        url: `/api/v1/admin/portfolio/${itemId}/revisions`,
        headers: authHeader(editorToken),
      });
      expect(revisionsBefore.json().data).toHaveLength(0);

      const auditCountBefore = await app.prisma.auditLog.count();

      const autosave = await app.inject({
        method: "POST",
        url: `/api/v1/admin/portfolio/${itemId}/autosave`,
        headers: authHeader(editorToken),
        payload: {
          title: "Autosave Sonrası Proje",
          summary: "Kısa özet",
          contentHtml: '<p>Merhaba</p><script>alert(1)</script>',
        },
      });
      expect(autosave.statusCode).toBe(200);
      expect(autosave.json().data).toEqual({ savedAt: expect.any(String) });

      const revisionsAfter = await app.inject({
        method: "GET",
        url: `/api/v1/admin/portfolio/${itemId}/revisions`,
        headers: authHeader(editorToken),
      });
      expect(revisionsAfter.json().data).toHaveLength(0);

      const auditCountAfter = await app.prisma.auditLog.count();
      expect(auditCountAfter).toBe(auditCountBefore);

      const get = await app.inject({
        method: "GET",
        url: `/api/v1/admin/portfolio/${itemId}`,
        headers: authHeader(editorToken),
      });
      const dto = get.json().data;
      expect(dto.title).toBe("Autosave Sonrası Proje");
      expect(dto.summary).toBe("Kısa özet");
      expect(dto.contentHtml).not.toContain("<script");
      expect(dto.contentHtml).toContain("Merhaba");
    });

    it("çöpteki projede autosave 409 döner", async () => {
      const create = await app.inject({
        method: "POST",
        url: "/api/v1/admin/portfolio",
        headers: authHeader(editorToken),
        payload: { title: "Çöpteyken Autosave Projesi" },
      });
      const itemId = create.json().data.id;
      await app.inject({
        method: "DELETE",
        url: `/api/v1/admin/portfolio/${itemId}`,
        headers: authHeader(editorToken),
      });

      const autosave = await app.inject({
        method: "POST",
        url: `/api/v1/admin/portfolio/${itemId}/autosave`,
        headers: authHeader(editorToken),
        payload: { title: "Değişmemeli" },
      });
      expect(autosave.statusCode).toBe(409);
    });

    // Mass-assignment koruması — `AutosavePortfolioItemRequestSchema` şema seviyesinde bu alanları
    // TANIMLAMAZ, bilinmeyen alanlar zod tarafından SESSİZCE ATILIR.
    it("ekstra/yasak alan (status/order/clientName) body'de gönderilse dahi yok sayılır (mass-assignment koruması)", async () => {
      const create = await app.inject({
        method: "POST",
        url: "/api/v1/admin/portfolio",
        headers: authHeader(editorToken),
        payload: { title: "Mass Assignment Projesi", clientName: "Orijinal Müşteri", order: 1 },
      });
      const itemId = create.json().data.id;

      const autosave = await app.inject({
        method: "POST",
        url: `/api/v1/admin/portfolio/${itemId}/autosave`,
        headers: authHeader(editorToken),
        payload: {
          title: "Autosave İle Değişen Başlık",
          status: "PUBLISHED",
          order: 999,
          clientName: "Ele Geçirilen Müşteri",
        },
      });
      expect(autosave.statusCode).toBe(200);

      const get = await app.inject({
        method: "GET",
        url: `/api/v1/admin/portfolio/${itemId}`,
        headers: authHeader(editorToken),
      });
      const dto = get.json().data;
      expect(dto.title).toBe("Autosave İle Değişen Başlık");
      expect(dto.status).toBe("DRAFT");
      expect(dto.order).toBe(1);
      expect(dto.clientName).toBe("Orijinal Müşteri");
    });
  });

  // §10.1 İçerik Sürüm Kontrolü — Product ile BİREBİR aynı sözleşme, TEK FARK: 422 dalı YOKTUR
  // (çapraz-alan doğrulaması yok, bkz. portfolio.routes.ts açıklaması), ama clientName/projectUrl/
  // completedAt/order gibi alanların da geri geldiği ve slug çakışmasında 409 döndüğü doğrulanır.
  describe("revizyonlar (§10.1)", () => {
    it("PATCH sonrası revizyon oluşur, GET revisions listeler, GET revisions/:id tam snapshot döner", async () => {
      const create = await app.inject({
        method: "POST",
        url: "/api/v1/admin/portfolio",
        headers: authHeader(adminToken),
        payload: { title: "Revizyon Projesi V1" },
      });
      const itemId = create.json().data.id;

      const patch = await app.inject({
        method: "PATCH",
        url: `/api/v1/admin/portfolio/${itemId}`,
        headers: authHeader(adminToken),
        payload: { title: "Revizyon Projesi V2" },
      });
      expect(patch.statusCode).toBe(200);

      const list = await app.inject({
        method: "GET",
        url: `/api/v1/admin/portfolio/${itemId}/revisions`,
        headers: authHeader(adminToken),
      });
      expect(list.statusCode).toBe(200);
      const revisions = list.json().data;
      expect(revisions).toHaveLength(1);
      expect(revisions[0].editedById).toBe(adminId);

      const detail = await app.inject({
        method: "GET",
        url: `/api/v1/admin/portfolio/${itemId}/revisions/${revisions[0].id}`,
        headers: authHeader(adminToken),
      });
      expect(detail.statusCode).toBe(200);
      expect(detail.json().data.entityType).toBe("PORTFOLIO_ITEM");
      expect(detail.json().data.snapshot.title).toBe("Revizyon Projesi V1");
    });

    it("cross-entity IDOR: bir öğenin revision ID'siyle BAŞKA bir öğenin/blog yazısının revisions ucuna istek 404 döner", async () => {
      const itemA = await app.inject({
        method: "POST",
        url: "/api/v1/admin/portfolio",
        headers: authHeader(adminToken),
        payload: { title: "IDOR Proje A" },
      });
      const itemAId = itemA.json().data.id;
      await app.inject({
        method: "PATCH",
        url: `/api/v1/admin/portfolio/${itemAId}`,
        headers: authHeader(adminToken),
        payload: { title: "IDOR Proje A v2" },
      });
      const revisionsA = (
        await app.inject({
          method: "GET",
          url: `/api/v1/admin/portfolio/${itemAId}/revisions`,
          headers: authHeader(adminToken),
        })
      ).json().data;
      const revisionAId = revisionsA[0].id;

      const itemB = await app.inject({
        method: "POST",
        url: "/api/v1/admin/portfolio",
        headers: authHeader(adminToken),
        payload: { title: "IDOR Proje B" },
      });
      const itemBId = itemB.json().data.id;

      const crossItem = await app.inject({
        method: "GET",
        url: `/api/v1/admin/portfolio/${itemBId}/revisions/${revisionAId}`,
        headers: authHeader(adminToken),
      });
      expect(crossItem.statusCode).toBe(404);

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

    it("restore eski duruma döner — clientName/projectUrl/completedAt/order de geri gelir", async () => {
      const create = await app.inject({
        method: "POST",
        url: "/api/v1/admin/portfolio",
        headers: authHeader(adminToken),
        payload: {
          title: "Restore Alanlar Projesi",
          clientName: "Eski Müşteri",
          projectUrl: "https://eski-musteri.example.com",
          completedAt: "2024-01-01T00:00:00.000Z",
          order: 3,
        },
      });
      const itemId = create.json().data.id;

      const patch = await app.inject({
        method: "PATCH",
        url: `/api/v1/admin/portfolio/${itemId}`,
        headers: authHeader(adminToken),
        payload: {
          clientName: "Yeni Müşteri",
          projectUrl: "https://yeni-musteri.example.com",
          completedAt: "2025-06-01T00:00:00.000Z",
          order: 9,
        },
      });
      expect(patch.statusCode).toBe(200);

      const revisions = (
        await app.inject({
          method: "GET",
          url: `/api/v1/admin/portfolio/${itemId}/revisions`,
          headers: authHeader(adminToken),
        })
      ).json().data;

      const restore = await app.inject({
        method: "POST",
        url: `/api/v1/admin/portfolio/${itemId}/revisions/${revisions[0].id}/restore`,
        headers: authHeader(adminToken),
      });
      expect(restore.statusCode).toBe(200);
      const restored = restore.json().data;
      expect(restored.clientName).toBe("Eski Müşteri");
      expect(restored.projectUrl).toBe("https://eski-musteri.example.com");
      expect(restored.order).toBe(3);
      expect(new Date(restored.completedAt).toISOString()).toBe("2024-01-01T00:00:00.000Z");
    });

    it("restore edilen contentHtml yeniden sanitize edilir (script tag içeren eski snapshot)", async () => {
      const create = await app.inject({
        method: "POST",
        url: "/api/v1/admin/portfolio",
        headers: authHeader(adminToken),
        payload: { title: "XSS Snapshot Projesi" },
      });
      const itemId = create.json().data.id;

      const patch = await app.inject({
        method: "PATCH",
        url: `/api/v1/admin/portfolio/${itemId}`,
        headers: authHeader(adminToken),
        payload: { title: "XSS Snapshot Projesi v2" },
      });
      expect(patch.statusCode).toBe(200);

      const revisions = (
        await app.inject({
          method: "GET",
          url: `/api/v1/admin/portfolio/${itemId}/revisions`,
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
            contentHtml: '<p>Eski İçerik</p><script>alert(1)</script><a href="javascript:alert(2)">tık</a>',
          },
        },
      });

      const restore = await app.inject({
        method: "POST",
        url: `/api/v1/admin/portfolio/${itemId}/revisions/${revisionId}/restore`,
        headers: authHeader(adminToken),
      });
      expect(restore.statusCode).toBe(200);
      const html = restore.json().data.contentHtml as string;
      expect(html).not.toContain("<script");
      expect(html).not.toContain("javascript:");
      expect(html).toContain("Eski İçerik");
    });

    it("restore hedefi slug başka bir kayıtla çakışıyorsa 409 döner", async () => {
      const itemA = await app.inject({
        method: "POST",
        url: "/api/v1/admin/portfolio",
        headers: authHeader(adminToken),
        payload: { title: "Çakışma Projesi A", slug: `carpisma-projesi-a-${crypto.randomUUID()}` },
      });
      const itemAId = itemA.json().data.id;
      const originalSlug = itemA.json().data.slug;

      await app.inject({
        method: "PATCH",
        url: `/api/v1/admin/portfolio/${itemAId}`,
        headers: authHeader(adminToken),
        payload: { slug: `carpisma-projesi-a-degisti-${crypto.randomUUID()}` },
      });
      const revisionsA = (
        await app.inject({
          method: "GET",
          url: `/api/v1/admin/portfolio/${itemAId}/revisions`,
          headers: authHeader(adminToken),
        })
      ).json().data;

      // B, A'nın ESKİ slug'ını devralsın.
      const itemB = await app.inject({
        method: "POST",
        url: "/api/v1/admin/portfolio",
        headers: authHeader(adminToken),
        payload: { title: "Çakışma Projesi B", slug: originalSlug },
      });
      expect(itemB.statusCode).toBe(201);

      const restoreSlug = await app.inject({
        method: "POST",
        url: `/api/v1/admin/portfolio/${itemAId}/revisions/${revisionsA[0].id}/restore`,
        headers: authHeader(adminToken),
      });
      expect(restoreSlug.statusCode).toBe(409);
    });
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
