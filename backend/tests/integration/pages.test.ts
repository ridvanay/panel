import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestApp } from "../helpers/build-test-app";
import { resetDatabase } from "../helpers/reset-db";
import { registerTestUser } from "../helpers/auth";

describe("pages", () => {
  let app: FastifyInstance;
  let accessToken: string;
  let userId: string;
  let viewerToken: string;

  beforeAll(async () => {
    app = await buildTestApp();
    await resetDatabase(app.prisma);
    ({ accessToken, userId } = await registerTestUser(app));

    const viewer = await registerTestUser(app, { email: "pages-viewer@example.com" });
    viewerToken = viewer.accessToken;
  });

  afterAll(async () => {
    await resetDatabase(app.prisma);
    await app.close();
  });

  function authHeader() {
    return { authorization: `Bearer ${accessToken}` };
  }

  it("rejects creating a page without authentication (401)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/admin/pages",
      payload: { title: "Hakkımızda" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("creates a draft page with an auto-generated slug", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/admin/pages",
      headers: authHeader(),
      payload: { title: "About Us" },
    });

    expect(res.statusCode).toBe(201);
    const page = res.json().data;
    expect(page.slug).toBe("about-us");
    expect(page.status).toBe("DRAFT");
    expect(page.publishedAt).toBeNull();
    expect(page.viewCount).toBe(0);
  });

  it("is not visible on the public site while a draft", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/api/v1/admin/pages",
      headers: authHeader(),
      payload: { title: "Gizli Taslak" },
    });
    const slug = create.json().data.slug;

    const publicList = await app.inject({ method: "GET", url: "/api/v1/pages" });
    expect(publicList.json().data.map((p: { slug: string }) => p.slug)).not.toContain(slug);

    const publicGet = await app.inject({ method: "GET", url: `/api/v1/pages/${slug}` });
    expect(publicGet.statusCode).toBe(404);
  });

  it("becomes visible on the public site once published, and sets publishedAt", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/api/v1/admin/pages",
      headers: authHeader(),
      payload: { title: "Yayında Sayfa", status: "PUBLISHED" },
    });
    const page = create.json().data;
    expect(page.publishedAt).not.toBeNull();

    const publicGet = await app.inject({ method: "GET", url: `/api/v1/pages/${page.slug}` });
    expect(publicGet.statusCode).toBe(200);
    expect(publicGet.json().data.title).toBe("Yayında Sayfa");

    const publicList = await app.inject({ method: "GET", url: "/api/v1/pages" });
    expect(publicList.json().data.map((p: { slug: string }) => p.slug)).toContain(page.slug);
  });

  // §10.2 Gelişmiş SEO & Social Card — frontend generateMetadata() bu alanlara bağlıdır;
  // public detay ucu bunları eksiksiz döndürmelidir.
  it("returns full SEO/OG fields (ogTitle, ogImageUrl, canonicalUrl, noIndex) on the public detail endpoint", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/api/v1/admin/pages",
      headers: authHeader(),
      payload: {
        title: "SEO Alanları Sayfası",
        status: "PUBLISHED",
        seoTitle: "Özel SEO Başlığı",
        seoDescription: "Özel SEO açıklaması.",
        ogTitle: "Özel OG Başlığı",
        ogImageUrl: "https://example.com/og-image.jpg",
        canonicalUrl: "https://example.com/seo-alanlari-sayfasi",
        noIndex: true,
      },
    });
    expect(create.statusCode).toBe(201);
    const page = create.json().data;

    const publicGet = await app.inject({ method: "GET", url: `/api/v1/pages/${page.slug}` });
    expect(publicGet.statusCode).toBe(200);
    const dto = publicGet.json().data;
    expect(dto.seoTitle).toBe("Özel SEO Başlığı");
    expect(dto.seoDescription).toBe("Özel SEO açıklaması.");
    expect(dto.ogTitle).toBe("Özel OG Başlığı");
    expect(dto.ogImageUrl).toBe("https://example.com/og-image.jpg");
    expect(dto.canonicalUrl).toBe("https://example.com/seo-alanlari-sayfasi");
    expect(dto.noIndex).toBe(true);
  });

  it("updates a page's title and blocks", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/api/v1/admin/pages",
      headers: authHeader(),
      payload: { title: "Düzenlenecek" },
    });
    const pageId = create.json().data.id;

    const update = await app.inject({
      method: "PATCH",
      url: `/api/v1/admin/pages/${pageId}`,
      headers: authHeader(),
      payload: { title: "Güncellendi", blocks: [{ id: "b1", type: "hero", data: { heading: "Merhaba" } }] },
    });

    expect(update.statusCode).toBe(200);
    expect(update.json().data.title).toBe("Güncellendi");
    expect(update.json().data.blocks).toHaveLength(1);
  });

  // Güvenlik: EDITOR de sayfa yazabildiği için (ADMIN'den daha az güvenilir bir rol), "text"
  // block'unun `data.html`'i public sitede `dangerouslySetInnerHTML` ile DOĞRUDAN render edilir
  // (bkz. frontend/src/components/site/blocks/text-block.tsx) — bu yüzden DB'ye yazılmadan önce
  // sanitize edilmelidir (bkz. lib/html-sanitize.ts).
  it("sanitizes a <script>-injected text block's html on create, keeping legitimate formatting", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/api/v1/admin/pages",
      headers: authHeader(),
      payload: {
        title: "XSS Denemesi",
        blocks: [
          {
            id: "b1",
            type: "text",
            data: { html: '<p>Merhaba <b>dünya</b></p><script>alert(1)</script><a href="javascript:alert(2)">tıkla</a>' },
          },
        ],
      },
    });

    expect(create.statusCode).toBe(201);
    const html = create.json().data.blocks[0].data.html as string;
    expect(html).not.toContain("<script");
    expect(html).not.toContain("alert(1)");
    expect(html).not.toContain("javascript:");
    expect(html).toContain("<p>Merhaba <b>dünya</b></p>");
  });

  it("sanitizes a <script>-injected text block's html on update", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/api/v1/admin/pages",
      headers: authHeader(),
      payload: { title: "XSS Update Denemesi" },
    });
    const pageId = create.json().data.id;

    const update = await app.inject({
      method: "PATCH",
      url: `/api/v1/admin/pages/${pageId}`,
      headers: authHeader(),
      payload: {
        blocks: [
          { id: "b1", type: "text", data: { html: '<p onclick="alert(1)">Merhaba</p><iframe src="evil.com"></iframe>' } },
        ],
      },
    });

    expect(update.statusCode).toBe(200);
    const html = update.json().data.blocks[0].data.html as string;
    expect(html).not.toContain("onclick");
    expect(html).not.toContain("iframe");
    expect(html).toContain("Merhaba");
  });

  it("increments viewCount on the public view-tracking endpoint", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/api/v1/admin/pages",
      headers: authHeader(),
      payload: { title: "Sayaç Testi", status: "PUBLISHED" },
    });
    const page = create.json().data;

    await app.inject({ method: "POST", url: `/api/v1/pages/${page.slug}/view` });
    await app.inject({ method: "POST", url: `/api/v1/pages/${page.slug}/view` });

    const after = await app.inject({ method: "GET", url: `/api/v1/admin/pages/${page.id}`, headers: authHeader() });
    expect(after.json().data.viewCount).toBe(2);
  });

  it("soft-deletes a page (moves to trash) — it still 200s on GET with deletedAt set", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/api/v1/admin/pages",
      headers: authHeader(),
      payload: { title: "Silinecek" },
    });
    const pageId = create.json().data.id;

    const del = await app.inject({ method: "DELETE", url: `/api/v1/admin/pages/${pageId}`, headers: authHeader() });
    expect(del.statusCode).toBe(204);

    // §10.7 — DAVRANIŞ DEĞİŞİKLİĞİ: artık kalıcı silinmez, GET çöpteki kaydı da döner.
    const get = await app.inject({ method: "GET", url: `/api/v1/admin/pages/${pageId}`, headers: authHeader() });
    expect(get.statusCode).toBe(200);
    expect(get.json().data.deletedAt).not.toBeNull();

    // İdempotenttir: zaten çöpteyken tekrar silmek de 204 döner.
    const delAgain = await app.inject({ method: "DELETE", url: `/api/v1/admin/pages/${pageId}`, headers: authHeader() });
    expect(delAgain.statusCode).toBe(204);
  });

  it("404s when deleting a nonexistent page", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: "/api/v1/admin/pages/00000000-0000-0000-0000-000000000000",
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(404);
  });

  describe("§10.7 çöp kutusu / toplu işlem / SEO skoru", () => {
    it("excludes trashed pages from the default (trashed=exclude) list, but includes them via trashed=only", async () => {
      const create = await app.inject({
        method: "POST",
        url: "/api/v1/admin/pages",
        headers: authHeader(),
        payload: { title: "Çöp Testi Sayfası" },
      });
      const pageId = create.json().data.id;
      await app.inject({ method: "DELETE", url: `/api/v1/admin/pages/${pageId}`, headers: authHeader() });

      const excludeList = await app.inject({ method: "GET", url: "/api/v1/admin/pages?trashed=exclude", headers: authHeader() });
      expect(excludeList.json().data.map((p: { id: string }) => p.id)).not.toContain(pageId);

      const onlyList = await app.inject({ method: "GET", url: "/api/v1/admin/pages?trashed=only", headers: authHeader() });
      expect(onlyList.json().data.map((p: { id: string }) => p.id)).toContain(pageId);

      const includeList = await app.inject({ method: "GET", url: "/api/v1/admin/pages?trashed=include", headers: authHeader() });
      expect(includeList.json().data.map((p: { id: string }) => p.id)).toContain(pageId);
    });

    it("returns meta.counts on the list endpoint, unaffected by trashed/status filters", async () => {
      const res = await app.inject({ method: "GET", url: "/api/v1/admin/pages?trashed=only&limit=1", headers: authHeader() });
      expect(res.statusCode).toBe(200);
      const counts = res.json().meta.counts;
      expect(counts).toHaveProperty("all");
      expect(counts).toHaveProperty("published");
      expect(counts).toHaveProperty("draft");
      expect(counts).toHaveProperty("trashed");
      expect(counts.all).toBe(counts.published + counts.draft);
    });

    it("restores a trashed page — status is unchanged, and it is idempotent", async () => {
      const create = await app.inject({
        method: "POST",
        url: "/api/v1/admin/pages",
        headers: authHeader(),
        payload: { title: "Geri Yüklenecek", status: "PUBLISHED" },
      });
      const pageId = create.json().data.id;
      await app.inject({ method: "DELETE", url: `/api/v1/admin/pages/${pageId}`, headers: authHeader() });

      const restore = await app.inject({ method: "POST", url: `/api/v1/admin/pages/${pageId}/restore`, headers: authHeader() });
      expect(restore.statusCode).toBe(200);
      expect(restore.json().data.deletedAt).toBeNull();
      expect(restore.json().data.status).toBe("PUBLISHED");

      // İdempotent: zaten çöpte değilken tekrar restore etmek de 200 döner.
      const restoreAgain = await app.inject({ method: "POST", url: `/api/v1/admin/pages/${pageId}/restore`, headers: authHeader() });
      expect(restoreAgain.statusCode).toBe(200);
    });

    it("rejects editing a trashed page with 409, and requires trash before permanent delete", async () => {
      const create = await app.inject({
        method: "POST",
        url: "/api/v1/admin/pages",
        headers: authHeader(),
        payload: { title: "Kalıcı Silme Testi" },
      });
      const pageId = create.json().data.id;

      // Çöpte değilken kalıcı silme → 409.
      const permanentBeforeTrash = await app.inject({
        method: "DELETE",
        url: `/api/v1/admin/pages/${pageId}/permanent`,
        headers: authHeader(),
      });
      expect(permanentBeforeTrash.statusCode).toBe(409);

      await app.inject({ method: "DELETE", url: `/api/v1/admin/pages/${pageId}`, headers: authHeader() });

      // Çöpteki içerik düzenlenemez → 409.
      const patch = await app.inject({
        method: "PATCH",
        url: `/api/v1/admin/pages/${pageId}`,
        headers: authHeader(),
        payload: { title: "Değişmemeli" },
      });
      expect(patch.statusCode).toBe(409);

      const permanent = await app.inject({ method: "DELETE", url: `/api/v1/admin/pages/${pageId}/permanent`, headers: authHeader() });
      expect(permanent.statusCode).toBe(204);

      const get = await app.inject({ method: "GET", url: `/api/v1/admin/pages/${pageId}`, headers: authHeader() });
      expect(get.statusCode).toBe(404);
    });

    it("applies a bulk trash action with partial success (skippedIds)", async () => {
      const create = await app.inject({
        method: "POST",
        url: "/api/v1/admin/pages",
        headers: authHeader(),
        payload: { title: "Toplu İşlem Sayfası" },
      });
      const pageId = create.json().data.id;
      const missingId = "00000000-0000-0000-0000-000000000099";

      const bulk = await app.inject({
        method: "POST",
        url: "/api/v1/admin/pages/bulk",
        headers: authHeader(),
        payload: { ids: [pageId, missingId], action: "trash" },
      });

      expect(bulk.statusCode).toBe(200);
      const result = bulk.json().data;
      expect(result.action).toBe("trash");
      expect(result.requestedCount).toBe(2);
      expect(result.affectedCount).toBe(1);
      expect(result.skippedIds).toContain(missingId);

      const get = await app.inject({ method: "GET", url: `/api/v1/admin/pages/${pageId}`, headers: authHeader() });
      expect(get.json().data.deletedAt).not.toBeNull();
    });

    it("computes a low SEO score with issues for a bare-minimum page, and a full score once completed", async () => {
      const create = await app.inject({
        method: "POST",
        url: "/api/v1/admin/pages",
        headers: authHeader(),
        payload: { title: "SEO Testi" },
      });
      const pageId = create.json().data.id;
      expect(create.json().data.seoScore).toBeLessThan(100);
      expect(create.json().data.seoScoreIssues.length).toBeGreaterThan(0);

      const longText = Array.from({ length: 120 }, (_, i) => `kelime${i}`).join(" ");
      // Kriter eşiklerinin (50-60 / 120-160 karakter) TAM sınırında kalmak için üretilmiş
      // sabit uzunlukta string'ler kullanılır (elle karakter saymak yerine).
      const seoTitle = "T".repeat(55);
      const seoDescription = "D".repeat(140);
      const update = await app.inject({
        method: "PATCH",
        url: `/api/v1/admin/pages/${pageId}`,
        headers: authHeader(),
        payload: {
          seoTitle,
          seoDescription,
          ogImageUrl: "https://example.com/cover.jpg",
          blocks: [
            { id: "b1", type: "text", data: { html: longText } },
            { id: "b2", type: "image", data: { url: "https://example.com/img.jpg", alt: "Açıklayıcı alt metin" } },
          ],
        },
      });

      expect(update.statusCode).toBe(200);
      expect(update.json().data.seoScore).toBe(100);
      expect(update.json().data.seoScoreIssues).toEqual([]);
    });

    it("assigns the creating user as author by default, and returns a UserSummary", async () => {
      const create = await app.inject({
        method: "POST",
        url: "/api/v1/admin/pages",
        headers: authHeader(),
        payload: { title: "Yazar Testi" },
      });
      const page = create.json().data;
      expect(page.authorId).toBe(userId);
      expect(page.author).toMatchObject({ id: userId, name: expect.any(String), email: expect.any(String) });
    });

    it("clears SiteSettings.homePageId when the home page is trashed (restore does NOT bring it back)", async () => {
      const create = await app.inject({
        method: "POST",
        url: "/api/v1/admin/pages",
        headers: authHeader(),
        payload: { title: "Ana Sayfa Adayı", status: "PUBLISHED" },
      });
      const pageId = create.json().data.id;

      const setHome = await app.inject({
        method: "PATCH",
        url: "/api/v1/admin/settings",
        headers: authHeader(),
        payload: { homePageId: pageId },
      });
      expect(setHome.statusCode).toBe(200);
      expect(setHome.json().data.homePageId).toBe(pageId);

      await app.inject({ method: "DELETE", url: `/api/v1/admin/pages/${pageId}`, headers: authHeader() });

      const settingsAfterTrash = await app.inject({ method: "GET", url: "/api/v1/admin/settings", headers: authHeader() });
      expect(settingsAfterTrash.json().data.homePageId).toBeNull();

      // Restore bunu GERİ ALMAZ — kullanıcı manuel olarak tekrar ana sayfa seçmelidir.
      await app.inject({ method: "POST", url: `/api/v1/admin/pages/${pageId}/restore`, headers: authHeader() });
      const settingsAfterRestore = await app.inject({ method: "GET", url: "/api/v1/admin/settings", headers: authHeader() });
      expect(settingsAfterRestore.json().data.homePageId).toBeNull();
    });

    it("forbids an EDITOR from assigning another user as author (403), but allows ADMIN", async () => {
      const editor = await registerTestUser(app);
      await app.prisma.user.update({ where: { id: editor.userId }, data: { role: "EDITOR" } });
      const editorAuthHeader = { authorization: `Bearer ${editor.accessToken}` };

      const forbidden = await app.inject({
        method: "POST",
        url: "/api/v1/admin/pages",
        headers: editorAuthHeader,
        payload: { title: "Editör Yazar Testi", authorId: userId },
      });
      expect(forbidden.statusCode).toBe(403);

      const asAdmin = await app.inject({
        method: "POST",
        url: "/api/v1/admin/pages",
        headers: authHeader(),
        payload: { title: "Admin Yazar Testi", authorId: editor.userId },
      });
      expect(asAdmin.statusCode).toBe(201);
      expect(asAdmin.json().data.authorId).toBe(editor.userId);

      const nonexistentAuthor = await app.inject({
        method: "POST",
        url: "/api/v1/admin/pages",
        headers: authHeader(),
        payload: { title: "Yok Yazar Testi", authorId: "00000000-0000-0000-0000-000000000042" },
      });
      expect(nonexistentAuthor.statusCode).toBe(422);
    });
  });

  // Faz 3 (autosave) — bilinçli olarak revizyonsuz/audit'siz (bkz. lib/content-revisions.ts).
  // NOT: Page modelinde `excerpt`/`contentHtml` yok — sayfanın içerik alanı `blocks`'tur.
  describe("autosave (Faz 3)", () => {
    it("updates title/blocks, sanitizes blocks, and does not create a revision or audit log", async () => {
      const create = await app.inject({
        method: "POST",
        url: "/api/v1/admin/pages",
        headers: authHeader(),
        payload: { title: "Autosave Öncesi" },
      });
      const pageId = create.json().data.id;

      const revisionsBefore = await app.inject({
        method: "GET",
        url: `/api/v1/admin/pages/${pageId}/revisions`,
        headers: authHeader(),
      });
      expect(revisionsBefore.json().data).toHaveLength(0);

      const autosave = await app.inject({
        method: "POST",
        url: `/api/v1/admin/pages/${pageId}/autosave`,
        headers: authHeader(),
        payload: {
          title: "Autosave Sonrası",
          blocks: [{ type: "text", data: { html: '<p onclick="alert(1)">Merhaba</p>' } }],
        },
      });

      expect(autosave.statusCode).toBe(200);
      expect(autosave.json().data).toEqual({ savedAt: expect.any(String) });

      const revisionsAfter = await app.inject({
        method: "GET",
        url: `/api/v1/admin/pages/${pageId}/revisions`,
        headers: authHeader(),
      });
      expect(revisionsAfter.json().data).toHaveLength(0);

      const get = await app.inject({ method: "GET", url: `/api/v1/admin/pages/${pageId}`, headers: authHeader() });
      const dto = get.json().data;
      expect(dto.title).toBe("Autosave Sonrası");
      const html = JSON.stringify(dto.blocks);
      expect(html).not.toContain("onclick");
      expect(html).toContain("Merhaba");
    });

    it("rejects autosave on a trashed page with 409", async () => {
      const create = await app.inject({
        method: "POST",
        url: "/api/v1/admin/pages",
        headers: authHeader(),
        payload: { title: "Çöpteyken Autosave" },
      });
      const pageId = create.json().data.id;
      await app.inject({ method: "DELETE", url: `/api/v1/admin/pages/${pageId}`, headers: authHeader() });

      const autosave = await app.inject({
        method: "POST",
        url: `/api/v1/admin/pages/${pageId}/autosave`,
        headers: authHeader(),
        payload: { title: "Değişmemeli" },
      });
      expect(autosave.statusCode).toBe(409);
    });

    it("requires authentication (401)", async () => {
      const create = await app.inject({
        method: "POST",
        url: "/api/v1/admin/pages",
        headers: authHeader(),
        payload: { title: "Yetkisiz Autosave" },
      });
      const pageId = create.json().data.id;

      const res = await app.inject({
        method: "POST",
        url: `/api/v1/admin/pages/${pageId}/autosave`,
        payload: { title: "x" },
      });
      expect(res.statusCode).toBe(401);
    });

    it("VIEWER autosave ucuna erişemez (403)", async () => {
      const create = await app.inject({
        method: "POST",
        url: "/api/v1/admin/pages",
        headers: authHeader(),
        payload: { title: "VIEWER Autosave Denemesi" },
      });
      const pageId = create.json().data.id;

      const res = await app.inject({
        method: "POST",
        url: `/api/v1/admin/pages/${pageId}/autosave`,
        headers: { authorization: `Bearer ${viewerToken}` },
        payload: { title: "Değişmemeli" },
      });
      expect(res.statusCode).toBe(403);
    });

    // Faz 3 + Faz 4 etkileşimi (bkz. görev notu) — autosave `status`/`scheduledAt`'e DOKUNMAZ.
    it("SCHEDULED bir sayfada autosave çağrılırsa status/scheduledAt DEĞİŞMEZ, sadece title/blocks güncellenir", async () => {
      const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
      const create = await app.inject({
        method: "POST",
        url: "/api/v1/admin/pages",
        headers: authHeader(),
        payload: { title: "Zamanlanmışken Autosave", status: "SCHEDULED", scheduledAt: future },
      });
      const pageId = create.json().data.id;
      const beforeScheduledAt = create.json().data.scheduledAt;
      expect(create.json().data.status).toBe("SCHEDULED");

      const autosave = await app.inject({
        method: "POST",
        url: `/api/v1/admin/pages/${pageId}/autosave`,
        headers: authHeader(),
        payload: { title: "İçerik Güncellendi" },
      });
      expect(autosave.statusCode).toBe(200);

      const get = await app.inject({ method: "GET", url: `/api/v1/admin/pages/${pageId}`, headers: authHeader() });
      const dto = get.json().data;
      expect(dto.title).toBe("İçerik Güncellendi");
      expect(dto.status).toBe("SCHEDULED");
      expect(dto.scheduledAt).toBe(beforeScheduledAt);
    });
  });

  // §10.1 İçerik Sürüm Kontrolü — revizyon geri yükleme, çöpteki içerik için `PATCH`/autosave
  // ile AYNI 409 iş kuralına tabidir (bkz. security-agent bulgusu: bu kontrol eksikti).
  describe("revision restore", () => {
    it("rejects restoring a revision on a trashed page with 409, and leaves the trashed content unchanged", async () => {
      const create = await app.inject({
        method: "POST",
        url: "/api/v1/admin/pages",
        headers: authHeader(),
        payload: { title: "Çöpteyken Restore v1" },
      });
      const pageId = create.json().data.id;

      const patch = await app.inject({
        method: "PATCH",
        url: `/api/v1/admin/pages/${pageId}`,
        headers: authHeader(),
        payload: { title: "Çöpteyken Restore v2" },
      });
      expect(patch.statusCode).toBe(200);

      const revisions = (
        await app.inject({
          method: "GET",
          url: `/api/v1/admin/pages/${pageId}/revisions`,
          headers: authHeader(),
        })
      ).json().data;
      expect(revisions.length).toBeGreaterThan(0);

      await app.inject({ method: "DELETE", url: `/api/v1/admin/pages/${pageId}`, headers: authHeader() });

      const restore = await app.inject({
        method: "POST",
        url: `/api/v1/admin/pages/${pageId}/revisions/${revisions[0].id}/restore`,
        headers: authHeader(),
      });
      expect(restore.statusCode).toBe(409);

      const get = await app.inject({ method: "GET", url: `/api/v1/admin/pages/${pageId}`, headers: authHeader() });
      expect(get.json().data.title).toBe("Çöpteyken Restore v2");
      expect(get.json().data.deletedAt).not.toBeNull();
    });
  });
});
