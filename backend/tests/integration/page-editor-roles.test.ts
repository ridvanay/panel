import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestApp } from "../helpers/build-test-app";
import { resetDatabase } from "../helpers/reset-db";
import { registerTestUser } from "../helpers/auth";

/**
 * §10.20 — "Standart" (kısıtlı) vs "Gelişmiş" sayfa düzenleyici modu (bkz.
 * `.claude/architect-scope-page-editor-roles.md`, BAĞLAYICI karar dokümanı). Bu dosya
 * `tests/integration/pages.test.ts`'ten BİLİNÇLİ olarak AYRI tutulur — o dosya `editMode`'dan
 * BAĞIMSIZ (freeform) davranışı, bu dosya İKİNCİ yetki eksenini kapsar.
 */
describe("page editor roles (§10.20)", () => {
  let app: FastifyInstance;
  let adminToken: string;
  let standardEditorToken: string;
  let advancedEditorToken: string;
  let standardEditorId: string;

  beforeAll(async () => {
    app = await buildTestApp();
    await resetDatabase(app.prisma);

    // Boş DB'de ilk kayıt olan kullanıcı otomatik ADMIN olur (bkz. auth.service.ts).
    const admin = await registerTestUser(app, { email: "admin-roles@example.com" });
    adminToken = admin.accessToken;

    const standardEditor = await registerTestUser(app, { email: "standard-editor@example.com" });
    await app.prisma.user.update({
      where: { id: standardEditor.userId },
      data: { role: "EDITOR", advancedBuilderEnabled: false },
    });
    standardEditorToken = standardEditor.accessToken;
    standardEditorId = standardEditor.userId;

    const advancedEditor = await registerTestUser(app, { email: "advanced-editor@example.com" });
    await app.prisma.user.update({
      where: { id: advancedEditor.userId },
      data: { role: "EDITOR", advancedBuilderEnabled: true },
    });
    advancedEditorToken = advancedEditor.accessToken;
  });

  afterAll(async () => {
    await resetDatabase(app.prisma);
    await app.close();
  });

  function auth(token: string) {
    return { authorization: `Bearer ${token}` };
  }

  const heading = (id: string, text: string) => ({ id, type: "heading", data: { text, level: 2, align: "left", underline: false } });
  const container = (id: string, children: unknown[] = []) => ({
    id,
    type: "container",
    settings: {
      layout: "boxed",
      direction: "column",
      justifyContent: "start",
      alignItems: "stretch",
      gap: 16,
      padding: { top: 0, right: 0, bottom: 0, left: 0 },
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
      background: { type: "none" },
    },
    children,
  });

  async function createTemplatePage(blocks: unknown[]) {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/admin/pages",
      headers: auth(adminToken),
      payload: { title: `Şablon Sayfa ${Math.random()}`, editMode: "TEMPLATE", blocks },
    });
    expect(res.statusCode).toBe(201);
    return res.json().data;
  }

  async function createFreeformPage(blocks: unknown[]) {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/admin/pages",
      headers: auth(adminToken),
      payload: { title: `Serbest Sayfa ${Math.random()}`, blocks },
    });
    expect(res.statusCode).toBe(201);
    return res.json().data;
  }

  it("standart kullanıcı: şablon sayfada konteyner eklemeye çalışırsa 403", async () => {
    const page = await createTemplatePage([heading("h1", "Merhaba")]);
    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/admin/pages/${page.id}`,
      headers: auth(standardEditorToken),
      payload: { blocks: [heading("h1", "Merhaba"), container("new-c")] },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("FORBIDDEN");
    expect(res.json().error.details.blocks).toContain("new-c: yapı değiştirilemez");
  });

  it("standart kullanıcı: konteyner settings değişikliği → 403", async () => {
    const page = await createTemplatePage([container("c1")]);
    const changed = { ...container("c1"), settings: { ...container("c1").settings, gap: 40 } };
    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/admin/pages/${page.id}`,
      headers: auth(standardEditorToken),
      payload: { blocks: [changed] },
    });
    expect(res.statusCode).toBe(403);
  });

  it("standart kullanıcı: data.text değişikliği → 200", async () => {
    const page = await createTemplatePage([heading("h1", "Eski")]);
    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/admin/pages/${page.id}`,
      headers: auth(standardEditorToken),
      payload: { blocks: [heading("h1", "Yeni")] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.blocks[0].data.text).toBe("Yeni");
  });

  it("standart kullanıcı: custom-html data.html değişikliği → 403 (§3.3 kesin istisna)", async () => {
    const page = await createTemplatePage([{ id: "ch1", type: "custom-html", data: { html: "<p>a</p>" } }]);
    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/admin/pages/${page.id}`,
      headers: auth(standardEditorToken),
      payload: { blocks: [{ id: "ch1", type: "custom-html", data: { html: "<p>b</p>" } }] },
    });
    expect(res.statusCode).toBe(403);
  });

  it("KRİTİK: autosave üzerinden yapısal değişiklik → 403 (debounce baypası engellenir)", async () => {
    const page = await createTemplatePage([heading("h1", "Merhaba")]);
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/admin/pages/${page.id}/autosave`,
      headers: auth(standardEditorToken),
      payload: { blocks: [heading("h1", "Merhaba"), container("sneaky")] },
    });
    expect(res.statusCode).toBe(403);

    // Baypas denemesi DB'ye YAZILMAMIŞ olmalı.
    const get = await app.inject({ method: "GET", url: `/api/v1/admin/pages/${page.id}`, headers: auth(adminToken) });
    expect(get.json().data.blocks).toHaveLength(1);
  });

  it("autosave'de yalnızca izinli data alanı değişirse 200", async () => {
    const page = await createTemplatePage([heading("h1", "Eski")]);
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/admin/pages/${page.id}/autosave`,
      headers: auth(standardEditorToken),
      payload: { blocks: [heading("h1", "Autosave İçerik")] },
    });
    expect(res.statusCode).toBe(200);
  });

  it("standart kullanıcı: translations.en.blocks üzerinden yapısal değişiklik → 403", async () => {
    const page = await createTemplatePage([heading("h1", "Merhaba")]);
    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/admin/pages/${page.id}`,
      headers: auth(standardEditorToken),
      payload: { translations: { en: { blocks: [heading("h1", "Merhaba"), container("via-translation")] } } },
    });
    expect(res.statusCode).toBe(403);
  });

  it("standart kullanıcı: translations.en.blocks içerik alanı değişikliği → 200 (kayıtlı çeviri yoksa kanonik blocks referans alınır)", async () => {
    const page = await createTemplatePage([heading("h1", "Merhaba")]);
    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/admin/pages/${page.id}`,
      headers: auth(standardEditorToken),
      payload: { translations: { en: { blocks: [heading("h1", "Hello")] } } },
    });
    expect(res.statusCode).toBe(200);
  });

  // SIKILAŞTIRMA (kullanıcı kararı, 2026-08-23, bağlayıcı — bkz.
  // `.claude/architect-scope-page-editor-roles.md` §2.5/§4.2 GENİŞLETİLDİ): standart kullanıcı
  // artık `editMode`'dan BAĞIMSIZ olarak asla blok yapısını değiştiremez — FREEFORM sayfada da
  // yalnızca TEMPLATE_EDITABLE_FIELDS kapsamındaki `data.*` alanlarını değiştirebilir. Aşağıdaki
  // iki test, önceki "freeform sayfada aynı istekler 200 döner" testinin YERİNİ ALIR.
  it("standart kullanıcı: FREEFORM sayfada konteyner eklemeye çalışırsa 403", async () => {
    const page = await createFreeformPage([heading("h1", "Merhaba")]);
    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/admin/pages/${page.id}`,
      headers: auth(standardEditorToken),
      payload: { blocks: [heading("h1", "Merhaba"), container("serbest-ekleme")] },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("FORBIDDEN");
    expect(res.json().error.details.blocks).toContain("serbest-ekleme: yapı değiştirilemez");
  });

  it("standart kullanıcı: FREEFORM sayfada konteyner silmeye/sıralamayı değiştirmeye çalışırsa 403", async () => {
    const page = await createFreeformPage([heading("h1", "Bir"), heading("h2", "İki")]);

    const removed = await app.inject({
      method: "PATCH",
      url: `/api/v1/admin/pages/${page.id}`,
      headers: auth(standardEditorToken),
      payload: { blocks: [heading("h1", "Bir")] },
    });
    expect(removed.statusCode).toBe(403);

    const reordered = await app.inject({
      method: "PATCH",
      url: `/api/v1/admin/pages/${page.id}`,
      headers: auth(standardEditorToken),
      payload: { blocks: [heading("h2", "İki"), heading("h1", "Bir")] },
    });
    expect(reordered.statusCode).toBe(403);
  });

  it("standart kullanıcı: FREEFORM sayfada izinli data alanı değişikliği 200 döner", async () => {
    const page = await createFreeformPage([heading("h1", "Eski")]);
    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/admin/pages/${page.id}`,
      headers: auth(standardEditorToken),
      payload: { blocks: [heading("h1", "Yeni")] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.blocks[0].data.text).toBe("Yeni");
  });

  it("gelişmiş EDITOR: FREEFORM sayfada tam serbestlik korunur (yapısal değişiklik 200)", async () => {
    const page = await createFreeformPage([heading("h1", "Merhaba")]);
    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/admin/pages/${page.id}`,
      headers: auth(advancedEditorToken),
      payload: { blocks: [heading("h1", "Merhaba"), container("serbest-ekleme")] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.blocks).toHaveLength(2);
  });

  it("gelişmiş EDITOR şablon sayfada kısıtsızdır", async () => {
    const page = await createTemplatePage([heading("h1", "Merhaba")]);
    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/admin/pages/${page.id}`,
      headers: auth(advancedEditorToken),
      payload: { blocks: [heading("h1", "Merhaba"), container("gelismis-ekleme")] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.blocks).toHaveLength(2);
  });

  it("ADMIN, advancedBuilderEnabled=false olsa dahi gelişmiştir (§1.5 kilitlenme güvenliği)", async () => {
    await app.prisma.user.updateMany({ where: { role: "ADMIN" }, data: { advancedBuilderEnabled: false } });
    try {
      const page = await createTemplatePage([heading("h1", "Merhaba")]);
      const res = await app.inject({
        method: "PATCH",
        url: `/api/v1/admin/pages/${page.id}`,
        headers: auth(adminToken),
        payload: { blocks: [heading("h1", "Merhaba"), container("admin-ekleme")] },
      });
      expect(res.statusCode).toBe(200);
    } finally {
      await app.prisma.user.updateMany({ where: { role: "ADMIN" }, data: { advancedBuilderEnabled: true } });
    }
  });

  describe("uç seviyesi guard'lar (§4.1)", () => {
    it("standart kullanıcı POST /admin/pages oluşturamaz (403)", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/admin/pages",
        headers: auth(standardEditorToken),
        payload: { title: "Standart Deneme" },
      });
      expect(res.statusCode).toBe(403);
    });

    it("standart kullanıcı sayfayı çöpe taşıyamaz / geri yükleyemez / toplu işlem yapamaz (403)", async () => {
      const page = await createFreeformPage([heading("h1", "x")]);

      const trash = await app.inject({ method: "DELETE", url: `/api/v1/admin/pages/${page.id}`, headers: auth(standardEditorToken) });
      expect(trash.statusCode).toBe(403);

      const restore = await app.inject({ method: "POST", url: `/api/v1/admin/pages/${page.id}/restore`, headers: auth(standardEditorToken) });
      expect(restore.statusCode).toBe(403);

      const bulk = await app.inject({
        method: "POST",
        url: "/api/v1/admin/pages/bulk",
        headers: auth(standardEditorToken),
        payload: { ids: [page.id], action: "trash" },
      });
      expect(bulk.statusCode).toBe(403);
    });

    it("gelişmiş EDITOR bu uçlara erişebilir", async () => {
      const page = await createFreeformPage([heading("h1", "x")]);
      const trash = await app.inject({ method: "DELETE", url: `/api/v1/admin/pages/${page.id}`, headers: auth(advancedEditorToken) });
      expect(trash.statusCode).toBe(204);
    });
  });

  describe("alan seviyesi guard'lar (§4.2)", () => {
    it("standart kullanıcı şablon sayfada slug/editMode gönderirse 403", async () => {
      const page = await createTemplatePage([heading("h1", "x")]);

      const slugRes = await app.inject({
        method: "PATCH",
        url: `/api/v1/admin/pages/${page.id}`,
        headers: auth(standardEditorToken),
        payload: { slug: "yeni-slug" },
      });
      expect(slugRes.statusCode).toBe(403);

      const editModeRes = await app.inject({
        method: "PATCH",
        url: `/api/v1/admin/pages/${page.id}`,
        headers: auth(standardEditorToken),
        payload: { editMode: "FREEFORM" },
      });
      expect(editModeRes.statusCode).toBe(403);
    });

    // SIKILAŞTIRMA (kullanıcı kararı, 2026-08-23, bağlayıcı): standart kullanıcı için bu kısıt
    // artık `editMode`'dan BAĞIMSIZDIR — FREEFORM sayfada da `slug`/`editMode` göndermek 403'tür.
    it("standart kullanıcı FREEFORM sayfada da slug/editMode gönderirse 403", async () => {
      const page = await createFreeformPage([heading("h1", "x")]);

      const slugRes = await app.inject({
        method: "PATCH",
        url: `/api/v1/admin/pages/${page.id}`,
        headers: auth(standardEditorToken),
        payload: { slug: `serbest-slug-${Math.floor(Math.random() * 100000)}` },
      });
      expect(slugRes.statusCode).toBe(403);

      const editModeRes = await app.inject({
        method: "PATCH",
        url: `/api/v1/admin/pages/${page.id}`,
        headers: auth(standardEditorToken),
        payload: { editMode: "TEMPLATE" },
      });
      expect(editModeRes.statusCode).toBe(403);
    });

    it("gelişmiş EDITOR FREEFORM sayfada slug DEĞİŞTİREBİLİR", async () => {
      const page = await createFreeformPage([heading("h1", "x")]);
      const res = await app.inject({
        method: "PATCH",
        url: `/api/v1/admin/pages/${page.id}`,
        headers: auth(advancedEditorToken),
        payload: { slug: `gelismis-slug-${Math.floor(Math.random() * 100000)}` },
      });
      expect(res.statusCode).toBe(200);
    });

    it("editMode DEĞİŞTİĞİNDE content.edit_mode_change audit kaydı üretir", async () => {
      const page = await createFreeformPage([heading("h1", "x")]);
      const res = await app.inject({
        method: "PATCH",
        url: `/api/v1/admin/pages/${page.id}`,
        headers: auth(adminToken),
        payload: { editMode: "TEMPLATE" },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.editMode).toBe("TEMPLATE");

      const log = await app.prisma.auditLog.findFirst({
        where: { action: "content.edit_mode_change", targetId: page.id },
      });
      expect(log).not.toBeNull();
      expect(log?.metadata).toMatchObject({ from: "FREEFORM", to: "TEMPLATE" });
    });
  });

  describe("PATCH /admin/users/{userId}/builder-access (§4.3)", () => {
    it("ADMIN standart bir EDITOR'ün yeteneğini açabilir; canUseAdvancedBuilder buna göre değişir", async () => {
      const grant = await app.inject({
        method: "PATCH",
        url: `/api/v1/admin/users/${standardEditorId}/builder-access`,
        headers: auth(adminToken),
        payload: { advancedBuilderEnabled: true },
      });
      expect(grant.statusCode).toBe(200);
      expect(grant.json().data.advancedBuilderEnabled).toBe(true);
      expect(grant.json().data.canUseAdvancedBuilder).toBe(true);

      const log = await app.prisma.auditLog.findFirst({ where: { action: "user.builder_access_change", targetId: standardEditorId } });
      expect(log).not.toBeNull();
      expect(log?.metadata).toMatchObject({ from: false, to: true });

      // Geri al — diğer testleri etkilemesin.
      const revoke = await app.inject({
        method: "PATCH",
        url: `/api/v1/admin/users/${standardEditorId}/builder-access`,
        headers: auth(adminToken),
        payload: { advancedBuilderEnabled: false },
      });
      expect(revoke.statusCode).toBe(200);
      expect(revoke.json().data.canUseAdvancedBuilder).toBe(false);
    });

    it("EDITOR bu ucu çağıramaz (ADMIN-only, 403)", async () => {
      const res = await app.inject({
        method: "PATCH",
        url: `/api/v1/admin/users/${standardEditorId}/builder-access`,
        headers: auth(advancedEditorToken),
        payload: { advancedBuilderEnabled: true },
      });
      expect(res.statusCode).toBe(403);
    });
  });

  it("/users/me yanıtı canUseAdvancedBuilder alanını döner", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/users/me", headers: auth(standardEditorToken) });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.canUseAdvancedBuilder).toBe(false);

    const adminRes = await app.inject({ method: "GET", url: "/api/v1/users/me", headers: auth(adminToken) });
    expect(adminRes.json().data.canUseAdvancedBuilder).toBe(true);
  });
});
