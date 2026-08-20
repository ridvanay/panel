import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestApp } from "../helpers/build-test-app";
import { resetDatabase } from "../helpers/reset-db";
import { registerTestUser } from "../helpers/auth";

describe("content revisions, SEO fields & i18n (§10.1, §10.2, §10.5)", () => {
  let app: FastifyInstance;
  let accessToken: string;
  let userId: string;

  beforeAll(async () => {
    app = await buildTestApp();
    await resetDatabase(app.prisma);
    // İlk kayıt olan kullanıcı otomatik ADMIN olur (bkz. auth.service.ts).
    ({ accessToken, userId } = await registerTestUser(app));
  });

  afterAll(async () => {
    await resetDatabase(app.prisma);
    await app.close();
  });

  function authHeader() {
    return { authorization: `Bearer ${accessToken}` };
  }

  describe("pages", () => {
    it("creates a ContentRevision on PATCH, listing the pre-update snapshot", async () => {
      const create = await app.inject({
        method: "POST",
        url: "/api/v1/admin/pages",
        headers: authHeader(),
        payload: { title: "Orijinal Başlık" },
      });
      const pageId = create.json().data.id;

      const patch = await app.inject({
        method: "PATCH",
        url: `/api/v1/admin/pages/${pageId}`,
        headers: authHeader(),
        payload: { title: "Güncellenmiş Başlık" },
      });
      expect(patch.statusCode).toBe(200);

      const list = await app.inject({
        method: "GET",
        url: `/api/v1/admin/pages/${pageId}/revisions`,
        headers: authHeader(),
      });
      expect(list.statusCode).toBe(200);
      const revisions = list.json().data;
      expect(revisions).toHaveLength(1);
      expect(revisions[0].editedByName).toBe("Test User");
      expect(revisions[0].editedById).toBeTruthy();
      expect(revisions[0].createdAt).toBeTruthy();

      const detail = await app.inject({
        method: "GET",
        url: `/api/v1/admin/pages/${pageId}/revisions/${revisions[0].id}`,
        headers: authHeader(),
      });
      expect(detail.statusCode).toBe(200);
      expect(detail.json().data.snapshot.title).toBe("Orijinal Başlık");
      expect(detail.json().data.entityType).toBe("PAGE");
    });

    it("rejects listing revisions without authentication (401)", async () => {
      const create = await app.inject({
        method: "POST",
        url: "/api/v1/admin/pages",
        headers: authHeader(),
        payload: { title: "Yetkisiz Testi" },
      });
      const pageId = create.json().data.id;

      const res = await app.inject({ method: "GET", url: `/api/v1/admin/pages/${pageId}/revisions` });
      expect(res.statusCode).toBe(401);
    });

    it("restores a previous revision, and the restore itself creates a new revision", async () => {
      const create = await app.inject({
        method: "POST",
        url: "/api/v1/admin/pages",
        headers: authHeader(),
        payload: { title: "V1" },
      });
      const pageId = create.json().data.id;

      await app.inject({
        method: "PATCH",
        url: `/api/v1/admin/pages/${pageId}`,
        headers: authHeader(),
        payload: { title: "V2" },
      });

      const beforeRestore = await app.inject({
        method: "GET",
        url: `/api/v1/admin/pages/${pageId}/revisions`,
        headers: authHeader(),
      });
      const revisionsBefore = beforeRestore.json().data;
      expect(revisionsBefore).toHaveLength(1); // yalnızca V1 -> V2 geçişinin snapshot'ı (V1 içerir)

      const restore = await app.inject({
        method: "POST",
        url: `/api/v1/admin/pages/${pageId}/revisions/${revisionsBefore[0].id}/restore`,
        headers: authHeader(),
      });
      expect(restore.statusCode).toBe(200);
      expect(restore.json().data.title).toBe("V1");

      const afterRestore = await app.inject({
        method: "GET",
        url: `/api/v1/admin/pages/${pageId}/revisions`,
        headers: authHeader(),
      });
      const revisionsAfter = afterRestore.json().data;
      // Restore öncesi state (V2) de yeni bir revizyon olarak kaydedilir → geri dönüş de geri alınabilir.
      expect(revisionsAfter).toHaveLength(2);

      const get = await app.inject({ method: "GET", url: `/api/v1/admin/pages/${pageId}`, headers: authHeader() });
      expect(get.json().data.title).toBe("V1");
    });

    it("404s restoring a revision that does not belong to the page", async () => {
      const createA = await app.inject({
        method: "POST",
        url: "/api/v1/admin/pages",
        headers: authHeader(),
        payload: { title: "Sayfa A" },
      });
      const pageAId = createA.json().data.id;
      await app.inject({
        method: "PATCH",
        url: `/api/v1/admin/pages/${pageAId}`,
        headers: authHeader(),
        payload: { title: "Sayfa A v2" },
      });
      const revisionsA = (
        await app.inject({ method: "GET", url: `/api/v1/admin/pages/${pageAId}/revisions`, headers: authHeader() })
      ).json().data;

      const createB = await app.inject({
        method: "POST",
        url: "/api/v1/admin/pages",
        headers: authHeader(),
        payload: { title: "Sayfa B" },
      });
      const pageBId = createB.json().data.id;

      const res = await app.inject({
        method: "POST",
        url: `/api/v1/admin/pages/${pageBId}/revisions/${revisionsA[0].id}/restore`,
        headers: authHeader(),
      });
      expect(res.statusCode).toBe(404);
    });

    // Dalga 3.1 SON denetim — backend-agent bulgusu / security-agent düzeltmesi: revizyon
    // geri-yükleme, `PageBlockListSchema`'dan hiç geçmemiş (örn. v3 container şeması devreye
    // girmeden ÖNCE serbestçe kabul edilmiş) bir eski/kötü niyetli snapshot'ı artık YENİDEN
    // doğrulamadan yazmaz. Snapshot doğrudan `ContentRevision` tablosuna (API'yi, dolayısıyla
    // `PageBlockListSchema`'yı BYPASS ederek) eklenir — bu, tam olarak "şemadan hiç geçmemiş
    // eski bir snapshot" senaryosunu simüle eder.
    it("rejects (422) restoring a revision whose snapshot.blocks contains a 'javascript:' container background that never passed PageBlockListSchema", async () => {
      const create = await app.inject({
        method: "POST",
        url: "/api/v1/admin/pages",
        headers: authHeader(),
        payload: { title: "Restore Güvenlik Testi" },
      });
      const pageId = create.json().data.id;
      const pageBefore = await app.prisma.page.findUniqueOrThrow({ where: { id: pageId } });

      const maliciousRevision = await app.prisma.contentRevision.create({
        data: {
          entityType: "PAGE",
          entityId: pageId,
          editedById: userId,
          editedByName: "Test User",
          snapshot: {
            title: "Kötü Niyetli Snapshot",
            slug: pageBefore.slug,
            blocks: [
              {
                id: "c1",
                type: "container",
                // §v3 öncesi: bu şekil hiçbir zaman `PageBlockListSchema`/`ContainerBackgroundSchema`
                // protokol beyaz listesinden (§13.3) geçmedi.
                settings: { background: { type: "image", value: "javascript:alert(1)" } },
                children: [],
              },
            ],
            seoTitle: null,
            seoDescription: null,
            ogTitle: null,
            ogImageUrl: null,
            canonicalUrl: null,
            noIndex: false,
            isLegalDocument: false,
            translations: {},
          },
        },
      });

      const restore = await app.inject({
        method: "POST",
        url: `/api/v1/admin/pages/${pageId}/revisions/${maliciousRevision.id}/restore`,
        headers: authHeader(),
      });
      expect(restore.statusCode).toBe(422);
      expect(restore.json().error.code).toBe("VALIDATION_ERROR");

      // Reddedilen restore hiçbir şey YAZMAMALI — sayfa dokunulmadan kalır.
      const pageAfter = await app.prisma.page.findUniqueOrThrow({ where: { id: pageId } });
      expect(pageAfter.blocks).toEqual(pageBefore.blocks);
      expect(pageAfter.title).toBe(pageBefore.title);
    });

    it("rejects (422) restoring a revision whose snapshot.translations.<LOCALE>.blocks contains a 'javascript:' container background", async () => {
      const create = await app.inject({
        method: "POST",
        url: "/api/v1/admin/pages",
        headers: authHeader(),
        payload: { title: "Restore Çeviri Güvenlik Testi" },
      });
      const pageId = create.json().data.id;
      const pageBefore = await app.prisma.page.findUniqueOrThrow({ where: { id: pageId } });

      const maliciousRevision = await app.prisma.contentRevision.create({
        data: {
          entityType: "PAGE",
          entityId: pageId,
          editedById: userId,
          editedByName: "Test User",
          snapshot: {
            title: pageBefore.title,
            slug: pageBefore.slug,
            blocks: [],
            seoTitle: null,
            seoDescription: null,
            ogTitle: null,
            ogImageUrl: null,
            canonicalUrl: null,
            noIndex: false,
            isLegalDocument: false,
            translations: {
              EN: {
                blocks: [
                  {
                    id: "c1",
                    type: "container",
                    settings: { background: { type: "image", value: "data:text/html,<script>alert(1)</script>" } },
                    children: [],
                  },
                ],
              },
            },
          },
        },
      });

      const restore = await app.inject({
        method: "POST",
        url: `/api/v1/admin/pages/${pageId}/revisions/${maliciousRevision.id}/restore`,
        headers: authHeader(),
      });
      expect(restore.statusCode).toBe(422);

      const pageAfter = await app.prisma.page.findUniqueOrThrow({ where: { id: pageId } });
      expect(pageAfter.blocks).toEqual(pageBefore.blocks);
    });

    it("still restores a legitimate legacy snapshot (no container settings) successfully (regression check)", async () => {
      const create = await app.inject({
        method: "POST",
        url: "/api/v1/admin/pages",
        headers: authHeader(),
        payload: { title: "Legacy Restore V1" },
      });
      const pageId = create.json().data.id;

      await app.inject({
        method: "PATCH",
        url: `/api/v1/admin/pages/${pageId}`,
        headers: authHeader(),
        payload: { title: "Legacy Restore V2" },
      });

      const revisions = (
        await app.inject({ method: "GET", url: `/api/v1/admin/pages/${pageId}/revisions`, headers: authHeader() })
      ).json().data;

      const restore = await app.inject({
        method: "POST",
        url: `/api/v1/admin/pages/${pageId}/revisions/${revisions[0].id}/restore`,
        headers: authHeader(),
      });
      expect(restore.statusCode).toBe(200);
      expect(restore.json().data.title).toBe("Legacy Restore V1");
    });

    it("round-trips SEO fields (ogTitle, ogImageUrl, canonicalUrl, noIndex) via PATCH/GET", async () => {
      const create = await app.inject({
        method: "POST",
        url: "/api/v1/admin/pages",
        headers: authHeader(),
        payload: { title: "SEO Sayfası" },
      });
      const pageId = create.json().data.id;

      const patch = await app.inject({
        method: "PATCH",
        url: `/api/v1/admin/pages/${pageId}`,
        headers: authHeader(),
        payload: {
          seoTitle: "SEO Başlık",
          seoDescription: "SEO açıklama",
          ogTitle: "OG Başlık",
          ogImageUrl: "https://example.com/og.png",
          canonicalUrl: "https://example.com/canonical",
          noIndex: true,
        },
      });
      expect(patch.statusCode).toBe(200);

      const get = await app.inject({ method: "GET", url: `/api/v1/admin/pages/${pageId}`, headers: authHeader() });
      const page = get.json().data;
      expect(page.seoTitle).toBe("SEO Başlık");
      expect(page.seoDescription).toBe("SEO açıklama");
      expect(page.ogTitle).toBe("OG Başlık");
      expect(page.ogImageUrl).toBe("https://example.com/og.png");
      expect(page.canonicalUrl).toBe("https://example.com/canonical");
      expect(page.noIndex).toBe(true);
    });

    it("rejects an invalid (non-URL) canonicalUrl with 422", async () => {
      const create = await app.inject({
        method: "POST",
        url: "/api/v1/admin/pages",
        headers: authHeader(),
        payload: { title: "Geçersiz Canonical" },
      });
      const pageId = create.json().data.id;

      const patch = await app.inject({
        method: "PATCH",
        url: `/api/v1/admin/pages/${pageId}`,
        headers: authHeader(),
        payload: { canonicalUrl: "not-a-url" },
      });
      expect(patch.statusCode).toBe(422);
    });

    // §2.4 (bkz. .claude/architect-scope-i18n.md, bağlayıcı) — yazma yolu YALNIZCA küçük harf
    // locale anahtarı üretir; `EN` (büyük harf) yalnızca ESKİ veri için bir OKUMA toleransıdır.
    it("applies translations.en as a field-level fallback on the public locale-aware GET", async () => {
      const create = await app.inject({
        method: "POST",
        url: "/api/v1/admin/pages",
        headers: authHeader(),
        payload: {
          title: "TR Başlık",
          status: "PUBLISHED",
          seoDescription: "TR açıklama",
        },
      });
      const page = create.json().data;

      const patch = await app.inject({
        method: "PATCH",
        url: `/api/v1/admin/pages/${page.id}`,
        headers: authHeader(),
        payload: { translations: { en: { title: "EN Title" } } },
      });
      expect(patch.statusCode).toBe(200);
      expect(patch.json().data.translations.en.title).toBe("EN Title");

      const defaultLocale = await app.inject({ method: "GET", url: `/api/v1/pages/${page.slug}` });
      expect(defaultLocale.json().data.title).toBe("TR Başlık");

      // Sözleşme: `?locale=` büyük/küçük harf FARK ETMEKSİZİN normalize edilir (bkz.
      // lib/localization.ts::resolveEffectiveLocaleCode) — `EN` de `en` de aynı sonucu üretir.
      const enLocale = await app.inject({ method: "GET", url: `/api/v1/pages/${page.slug}?locale=EN` });
      expect(enLocale.statusCode).toBe(200);
      // Override edilen alan EN'den gelir...
      expect(enLocale.json().data.title).toBe("EN Title");
      // ...override edilmeyen alan TR/kanonik kolondan fallback eder.
      expect(enLocale.json().data.seoDescription).toBe("TR açıklama");
    });

    it("merges translations per-locale on repeated PATCH calls instead of replacing wholesale", async () => {
      const create = await app.inject({
        method: "POST",
        url: "/api/v1/admin/pages",
        headers: authHeader(),
        payload: { title: "Kısmi Çeviri" },
      });
      const pageId = create.json().data.id;

      await app.inject({
        method: "PATCH",
        url: `/api/v1/admin/pages/${pageId}`,
        headers: authHeader(),
        payload: { translations: { en: { title: "First EN Title" } } },
      });

      const second = await app.inject({
        method: "PATCH",
        url: `/api/v1/admin/pages/${pageId}`,
        headers: authHeader(),
        payload: { translations: { en: { seoTitle: "EN SEO Title" } } },
      });

      const translations = second.json().data.translations;
      // İkinci PATCH yalnızca seoTitle gönderdi ama ilk PATCH'teki title kaybolmamalı (shallow merge).
      expect(translations.en.title).toBe("First EN Title");
      expect(translations.en.seoTitle).toBe("EN SEO Title");
    });
  });

  describe("blog posts", () => {
    it("creates a ContentRevision on PATCH and restore reverts + creates a new revision", async () => {
      const create = await app.inject({
        method: "POST",
        url: "/api/v1/admin/blog",
        headers: authHeader(),
        payload: { title: "Yazı V1" },
      });
      const postId = create.json().data.id;

      await app.inject({
        method: "PATCH",
        url: `/api/v1/admin/blog/${postId}`,
        headers: authHeader(),
        payload: { title: "Yazı V2" },
      });

      const list = await app.inject({
        method: "GET",
        url: `/api/v1/admin/blog/${postId}/revisions`,
        headers: authHeader(),
      });
      expect(list.statusCode).toBe(200);
      const revisions = list.json().data;
      expect(revisions).toHaveLength(1);

      const restore = await app.inject({
        method: "POST",
        url: `/api/v1/admin/blog/${postId}/revisions/${revisions[0].id}/restore`,
        headers: authHeader(),
      });
      expect(restore.statusCode).toBe(200);
      expect(restore.json().data.title).toBe("Yazı V1");

      const afterRestore = await app.inject({
        method: "GET",
        url: `/api/v1/admin/blog/${postId}/revisions`,
        headers: authHeader(),
      });
      expect(afterRestore.json().data).toHaveLength(2);
    });

    it("applies translations.EN fallback on the public locale-aware GET for blog posts", async () => {
      const create = await app.inject({
        method: "POST",
        url: "/api/v1/admin/blog",
        headers: authHeader(),
        payload: { title: "TR Yazı Başlığı", status: "PUBLISHED", excerpt: "TR özet" },
      });
      const post = create.json().data;

      await app.inject({
        method: "PATCH",
        url: `/api/v1/admin/blog/${post.id}`,
        headers: authHeader(),
        payload: { translations: { EN: { title: "EN Post Title" } } },
      });

      const enLocale = await app.inject({ method: "GET", url: `/api/v1/blog/${post.slug}?locale=EN` });
      expect(enLocale.statusCode).toBe(200);
      expect(enLocale.json().data.title).toBe("EN Post Title");
      expect(enLocale.json().data.excerpt).toBe("TR özet");
    });
  });
});
