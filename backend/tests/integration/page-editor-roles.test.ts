import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestApp } from "../helpers/build-test-app";
import { resetDatabase } from "../helpers/reset-db";
import { registerTestUser } from "../helpers/auth";

/**
 * §6 — sayfa modülünün üç katmanlı yetki modeli (bkz.
 * `.claude/architect-scope-rbac-5-tier.md` §6, önceki karar dokümanı
 * `.claude/architect-scope-page-editor-roles.md`'yi REVİZE eder — bkz. §11 "önceki karar
 * dokümanına yapılan revizyonlar"). Eski `advancedBuilderEnabled` kullanıcı-başı bayrağı
 * KALDIRILDI; `canUseAdvancedBuilder` artık saf rol türevidir (`role === "ADMIN"`).
 *
 * Üç aktör:
 * - `adminToken` (ADMIN)   — Katman 1 (blok yapısı) dahil TÜM katmanlarda serbest.
 * - `managerToken` (MANAGER) — Katman 2 (yaşam döngüsü/slug/editMode) VE Katman 3 (içerik)
 *   serbesttir, ama Katman 1'de (blok yapısı) EDITOR ile AYNI şablon diff'ine tabidir.
 * - `editorToken` (EDITOR) — yalnızca Katman 3 (içerik). Katman 1 VE Katman 2'de 403 alır.
 */
describe("page editor roles (§6 — üç katmanlı yetki modeli)", () => {
  let app: FastifyInstance;
  let adminToken: string;
  let managerToken: string;
  let editorToken: string;

  beforeAll(async () => {
    app = await buildTestApp();
    await resetDatabase(app.prisma);

    // Boş DB'de ilk kayıt olan kullanıcı otomatik ADMIN olur (bkz. auth.service.ts).
    const admin = await registerTestUser(app, { email: "admin-roles@example.com" });
    adminToken = admin.accessToken;

    const manager = await registerTestUser(app, { email: "manager-roles@example.com" });
    await app.prisma.user.update({ where: { id: manager.userId }, data: { role: "MANAGER" } });
    managerToken = manager.accessToken;

    const editor = await registerTestUser(app, { email: "editor-roles@example.com" });
    await app.prisma.user.update({ where: { id: editor.userId }, data: { role: "EDITOR" } });
    editorToken = editor.accessToken;
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

  // ---------------------------------------------------------------------------
  // Katman 1 — Blok YAPISI: yalnızca ADMIN. MANAGER ve EDITOR ikisi de aynı şablon diff'ine
  // tabidir (`assertTemplateEditAllowed`, `editMode`'dan BAĞIMSIZ — §10.20 2026-08-23 revizyonu).
  // ---------------------------------------------------------------------------
  describe.each([
    ["EDITOR", () => editorToken],
    ["MANAGER", () => managerToken],
  ] as const)("Katman 1 — %s blok yapısını değiştiremez, içerik alanlarını değiştirebilir", (roleLabel, getToken) => {
    it(`${roleLabel}: şablon sayfada konteyner eklemeye çalışırsa 403`, async () => {
      const page = await createTemplatePage([heading("h1", "Merhaba")]);
      const res = await app.inject({
        method: "PATCH",
        url: `/api/v1/admin/pages/${page.id}`,
        headers: auth(getToken()),
        payload: { blocks: [heading("h1", "Merhaba"), container("new-c")] },
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().error.code).toBe("FORBIDDEN");
      expect(res.json().error.details.blocks).toContain("new-c: yapı değiştirilemez");
    });

    it(`${roleLabel}: konteyner settings değişikliği → 403`, async () => {
      const page = await createTemplatePage([container("c1")]);
      const changed = { ...container("c1"), settings: { ...container("c1").settings, gap: 40 } };
      const res = await app.inject({
        method: "PATCH",
        url: `/api/v1/admin/pages/${page.id}`,
        headers: auth(getToken()),
        payload: { blocks: [changed] },
      });
      expect(res.statusCode).toBe(403);
    });

    it(`${roleLabel}: data.text değişikliği → 200 (PATCH)`, async () => {
      const page = await createTemplatePage([heading("h1", "Eski")]);
      const res = await app.inject({
        method: "PATCH",
        url: `/api/v1/admin/pages/${page.id}`,
        headers: auth(getToken()),
        payload: { blocks: [heading("h1", "Yeni")] },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.blocks[0].data.text).toBe("Yeni");
    });

    it(`${roleLabel}: custom-html data.html değişikliği → 403 (§3.3 kesin istisna)`, async () => {
      const page = await createTemplatePage([{ id: "ch1", type: "custom-html", data: { html: "<p>a</p>" } }]);
      const res = await app.inject({
        method: "PATCH",
        url: `/api/v1/admin/pages/${page.id}`,
        headers: auth(getToken()),
        payload: { blocks: [{ id: "ch1", type: "custom-html", data: { html: "<p>b</p>" } }] },
      });
      expect(res.statusCode).toBe(403);
    });

    it(`KRİTİK: ${roleLabel} autosave üzerinden yapısal değişiklik → 403 (debounce baypası engellenir)`, async () => {
      const page = await createTemplatePage([heading("h1", "Merhaba")]);
      const res = await app.inject({
        method: "POST",
        url: `/api/v1/admin/pages/${page.id}/autosave`,
        headers: auth(getToken()),
        payload: { blocks: [heading("h1", "Merhaba"), container("sneaky")] },
      });
      expect(res.statusCode).toBe(403);

      // Baypas denemesi DB'ye YAZILMAMIŞ olmalı.
      const get = await app.inject({ method: "GET", url: `/api/v1/admin/pages/${page.id}`, headers: auth(adminToken) });
      expect(get.json().data.blocks).toHaveLength(1);
    });

    it(`${roleLabel}: autosave'de yalnızca izinli data alanı değişirse 200`, async () => {
      const page = await createTemplatePage([heading("h1", "Eski")]);
      const res = await app.inject({
        method: "POST",
        url: `/api/v1/admin/pages/${page.id}/autosave`,
        headers: auth(getToken()),
        payload: { blocks: [heading("h1", "Autosave İçerik")] },
      });
      expect(res.statusCode).toBe(200);
    });

    it(`${roleLabel}: translations.en.blocks üzerinden yapısal değişiklik → 403`, async () => {
      const page = await createTemplatePage([heading("h1", "Merhaba")]);
      const res = await app.inject({
        method: "PATCH",
        url: `/api/v1/admin/pages/${page.id}`,
        headers: auth(getToken()),
        payload: { translations: { en: { blocks: [heading("h1", "Merhaba"), container("via-translation")] } } },
      });
      expect(res.statusCode).toBe(403);
    });

    it(`${roleLabel}: translations.en.blocks içerik alanı değişikliği → 200 (kayıtlı çeviri yoksa kanonik blocks referans alınır)`, async () => {
      const page = await createTemplatePage([heading("h1", "Merhaba")]);
      const res = await app.inject({
        method: "PATCH",
        url: `/api/v1/admin/pages/${page.id}`,
        headers: auth(getToken()),
        payload: { translations: { en: { blocks: [heading("h1", "Hello")] } } },
      });
      expect(res.statusCode).toBe(200);
    });

    // SIKILAŞTIRMA (2026-08-23, bağlayıcı): kısıt `editMode`'dan BAĞIMSIZDIR — FREEFORM
    // sayfada da yalnızca TEMPLATE_EDITABLE_FIELDS kapsamındaki `data.*` alanları değiştirilebilir.
    it(`${roleLabel}: FREEFORM sayfada konteyner eklemeye çalışırsa 403`, async () => {
      const page = await createFreeformPage([heading("h1", "Merhaba")]);
      const res = await app.inject({
        method: "PATCH",
        url: `/api/v1/admin/pages/${page.id}`,
        headers: auth(getToken()),
        payload: { blocks: [heading("h1", "Merhaba"), container("serbest-ekleme")] },
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().error.code).toBe("FORBIDDEN");
      expect(res.json().error.details.blocks).toContain("serbest-ekleme: yapı değiştirilemez");
    });

    it(`${roleLabel}: FREEFORM sayfada konteyner silmeye/sıralamayı değiştirmeye çalışırsa 403`, async () => {
      const page = await createFreeformPage([heading("h1", "Bir"), heading("h2", "İki")]);

      const removed = await app.inject({
        method: "PATCH",
        url: `/api/v1/admin/pages/${page.id}`,
        headers: auth(getToken()),
        payload: { blocks: [heading("h1", "Bir")] },
      });
      expect(removed.statusCode).toBe(403);

      const reordered = await app.inject({
        method: "PATCH",
        url: `/api/v1/admin/pages/${page.id}`,
        headers: auth(getToken()),
        payload: { blocks: [heading("h2", "İki"), heading("h1", "Bir")] },
      });
      expect(reordered.statusCode).toBe(403);
    });

    it(`${roleLabel}: FREEFORM sayfada izinli data alanı değişikliği 200 döner`, async () => {
      const page = await createFreeformPage([heading("h1", "Eski")]);
      const res = await app.inject({
        method: "PATCH",
        url: `/api/v1/admin/pages/${page.id}`,
        headers: auth(getToken()),
        payload: { blocks: [heading("h1", "Yeni")] },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.blocks[0].data.text).toBe("Yeni");
    });
  });

  it("ADMIN: FREEFORM sayfada tam serbestlik (yapısal değişiklik 200)", async () => {
    const page = await createFreeformPage([heading("h1", "Merhaba")]);
    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/admin/pages/${page.id}`,
      headers: auth(adminToken),
      payload: { blocks: [heading("h1", "Merhaba"), container("serbest-ekleme")] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.blocks).toHaveLength(2);
  });

  it("ADMIN: şablon sayfada kısıtsızdır", async () => {
    const page = await createTemplatePage([heading("h1", "Merhaba")]);
    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/admin/pages/${page.id}`,
      headers: auth(adminToken),
      payload: { blocks: [heading("h1", "Merhaba"), container("admin-ekleme")] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.blocks).toHaveLength(2);
  });

  // ---------------------------------------------------------------------------
  // Katman 2 — Sayfa YAŞAM DÖNGÜSÜ ve KİMLİĞİ: ADMIN + MANAGER. `POST /admin/pages`
  // (yeni sayfa) İSTİSNASI (§6.1) — yalnızca ADMIN (MANAGER dahi 403 alır).
  // ---------------------------------------------------------------------------
  describe("Katman 2 — sayfa yaşam döngüsü ve kimliği (§6, §6.1 istisnası)", () => {
    it("EDITOR POST /admin/pages oluşturamaz (403)", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/admin/pages",
        headers: auth(editorToken),
        payload: { title: "Editor Deneme" },
      });
      expect(res.statusCode).toBe(403);
    });

    it("MANAGER POST /admin/pages oluşturamaz (403 — §6.1 bilinçli istisna, yalnızca ADMIN)", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/admin/pages",
        headers: auth(managerToken),
        payload: { title: "Manager Deneme" },
      });
      expect(res.statusCode).toBe(403);
    });

    it("ADMIN POST /admin/pages ile sayfa oluşturabilir (201)", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/admin/pages",
        headers: auth(adminToken),
        payload: { title: "Admin Deneme" },
      });
      expect(res.statusCode).toBe(201);
    });

    it("EDITOR sayfayı çöpe taşıyamaz / geri yükleyemez / toplu işlem yapamaz (403)", async () => {
      const page = await createFreeformPage([heading("h1", "x")]);

      const trash = await app.inject({ method: "DELETE", url: `/api/v1/admin/pages/${page.id}`, headers: auth(editorToken) });
      expect(trash.statusCode).toBe(403);

      const restore = await app.inject({ method: "POST", url: `/api/v1/admin/pages/${page.id}/restore`, headers: auth(editorToken) });
      expect(restore.statusCode).toBe(403);

      const bulk = await app.inject({
        method: "POST",
        url: "/api/v1/admin/pages/bulk",
        headers: auth(editorToken),
        payload: { ids: [page.id], action: "trash" },
      });
      expect(bulk.statusCode).toBe(403);
    });

    it("EDITOR DELETE /admin/pages/{id} çöpe taşıyamaz (403)", async () => {
      const page = await createFreeformPage([heading("h1", "delete-target")]);
      const res = await app.inject({ method: "DELETE", url: `/api/v1/admin/pages/${page.id}`, headers: auth(editorToken) });
      expect(res.statusCode).toBe(403);
    });

    it("MANAGER sayfayı çöpe taşıyabilir/geri yükleyebilir/toplu işlem yapabilir (Katman 2 serbest)", async () => {
      const page = await createFreeformPage([heading("h1", "x")]);
      const trash = await app.inject({ method: "DELETE", url: `/api/v1/admin/pages/${page.id}`, headers: auth(managerToken) });
      expect(trash.statusCode).toBe(204);

      const restore = await app.inject({ method: "POST", url: `/api/v1/admin/pages/${page.id}/restore`, headers: auth(managerToken) });
      expect(restore.statusCode).toBe(200);

      const bulk = await app.inject({
        method: "POST",
        url: "/api/v1/admin/pages/bulk",
        headers: auth(managerToken),
        payload: { ids: [page.id], action: "trash" },
      });
      expect(bulk.statusCode).toBe(200);
    });
  });

  describe("alan seviyesi guard'lar — slug/editMode (§6 Katman 2)", () => {
    it("EDITOR şablon sayfada slug/editMode gönderirse 403", async () => {
      const page = await createTemplatePage([heading("h1", "x")]);

      const slugRes = await app.inject({
        method: "PATCH",
        url: `/api/v1/admin/pages/${page.id}`,
        headers: auth(editorToken),
        payload: { slug: "yeni-slug" },
      });
      expect(slugRes.statusCode).toBe(403);

      const editModeRes = await app.inject({
        method: "PATCH",
        url: `/api/v1/admin/pages/${page.id}`,
        headers: auth(editorToken),
        payload: { editMode: "FREEFORM" },
      });
      expect(editModeRes.statusCode).toBe(403);
    });

    // SIKILAŞTIRMA (2026-08-23, bağlayıcı): bu kısıt `editMode`'dan BAĞIMSIZDIR — FREEFORM
    // sayfada da EDITOR için `slug`/`editMode` göndermek 403'tür.
    it("EDITOR FREEFORM sayfada da slug/editMode gönderirse 403", async () => {
      const page = await createFreeformPage([heading("h1", "x")]);

      const slugRes = await app.inject({
        method: "PATCH",
        url: `/api/v1/admin/pages/${page.id}`,
        headers: auth(editorToken),
        payload: { slug: `serbest-slug-${Math.floor(Math.random() * 100000)}` },
      });
      expect(slugRes.statusCode).toBe(403);

      const editModeRes = await app.inject({
        method: "PATCH",
        url: `/api/v1/admin/pages/${page.id}`,
        headers: auth(editorToken),
        payload: { editMode: "TEMPLATE" },
      });
      expect(editModeRes.statusCode).toBe(403);
    });

    it("MANAGER FREEFORM sayfada slug DEĞİŞTİREBİLİR (§6 Katman 2 — ADMIN+MANAGER)", async () => {
      const page = await createFreeformPage([heading("h1", "x")]);
      const res = await app.inject({
        method: "PATCH",
        url: `/api/v1/admin/pages/${page.id}`,
        headers: auth(managerToken),
        payload: { slug: `manager-slug-${Math.floor(Math.random() * 100000)}` },
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

  // ---------------------------------------------------------------------------
  // §3 — `canUseAdvancedBuilder` artık saf rol türevidir; kullanıcı-başı bayrak KALDIRILDI.
  // ---------------------------------------------------------------------------
  it("/users/me yanıtı canUseAdvancedBuilder alanını rolden türetir (yalnızca ADMIN true)", async () => {
    const editorRes = await app.inject({ method: "GET", url: "/api/v1/users/me", headers: auth(editorToken) });
    expect(editorRes.statusCode).toBe(200);
    expect(editorRes.json().data.canUseAdvancedBuilder).toBe(false);

    const managerRes = await app.inject({ method: "GET", url: "/api/v1/users/me", headers: auth(managerToken) });
    expect(managerRes.json().data.canUseAdvancedBuilder).toBe(false);

    const adminRes = await app.inject({ method: "GET", url: "/api/v1/users/me", headers: auth(adminToken) });
    expect(adminRes.json().data.canUseAdvancedBuilder).toBe(true);
  });
});
