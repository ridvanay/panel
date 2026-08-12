import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestApp } from "../helpers/build-test-app";
import { resetDatabase } from "../helpers/reset-db";
import { registerTestUser } from "../helpers/auth";

/**
 * §10.5 Çoklu Dil & Yerelleştirme (bkz. .claude/architect-scope-i18n.md, bağlayıcı karar
 * dokümanı) — backend-agent unit/entegrasyon testleri (§9 backend-agent madde 11-12):
 * fallback zinciri, slug çakışması (409), isDefault devri, geçersiz locale'in fallback
 * ürettiği (400 DEĞİL), ve isLegalDocument'in gövdeyi boşalttığı (admin route etkilenmiyor).
 */
describe("localization (§10.5)", () => {
  let app: FastifyInstance;
  let adminToken: string;
  let editorToken: string;

  beforeAll(async () => {
    app = await buildTestApp();
    await resetDatabase(app.prisma);

    const admin = await registerTestUser(app, { email: "i18n-admin@example.com" });
    adminToken = admin.accessToken;

    const editor = await registerTestUser(app, { email: "i18n-editor@example.com" });
    await app.prisma.user.update({ where: { id: editor.userId }, data: { role: "EDITOR" } });
    editorToken = editor.accessToken;
  });

  afterAll(async () => {
    await resetDatabase(app.prisma);
    await app.close();
  });

  function adminHeader() {
    return { authorization: `Bearer ${adminToken}` };
  }
  function editorHeader() {
    return { authorization: `Bearer ${editorToken}` };
  }

  describe("Locale CRUD (/locales, /admin/locales)", () => {
    it("seeds tr (default) and en on public GET /locales", async () => {
      const res = await app.inject({ method: "GET", url: "/api/v1/locales" });
      expect(res.statusCode).toBe(200);
      const codes = res.json().data.map((l: { code: string }) => l.code).sort();
      expect(codes).toEqual(["en", "tr"]);
      const tr = res.json().data.find((l: { code: string }) => l.code === "tr");
      expect(tr.isDefault).toBe(true);
    });

    it("GET /admin/locales requires authentication but allows any SiteRole, and includes translatedContentCount", async () => {
      const unauth = await app.inject({ method: "GET", url: "/api/v1/admin/locales" });
      expect(unauth.statusCode).toBe(401);

      const res = await app.inject({ method: "GET", url: "/api/v1/admin/locales", headers: editorHeader() });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.every((l: { translatedContentCount?: number }) => typeof l.translatedContentCount === "number")).toBe(
        true
      );
    });

    it("only ADMIN can create a new locale; EDITOR gets 403", async () => {
      const forbidden = await app.inject({
        method: "POST",
        url: "/api/v1/admin/locales",
        headers: editorHeader(),
        payload: { code: "de", label: "Almanca", nativeLabel: "Deutsch" },
      });
      expect(forbidden.statusCode).toBe(403);

      const created = await app.inject({
        method: "POST",
        url: "/api/v1/admin/locales",
        headers: adminHeader(),
        payload: { code: "DE", label: "Almanca", nativeLabel: "Deutsch" },
      });
      expect(created.statusCode).toBe(201);
      // "küçük harf, `_` → `-`" normalizasyonu (bkz. openapi.yaml POST açıklaması).
      expect(created.json().data.code).toBe("de");
      expect(created.json().data.isDefault).toBe(false);
      expect(created.json().data.enabled).toBe(false);
    });

    it("rejects a duplicate locale code with 409", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/admin/locales",
        headers: adminHeader(),
        payload: { code: "de", label: "Almanca (tekrar)", nativeLabel: "Deutsch" },
      });
      expect(res.statusCode).toBe(409);
    });

    it("rejects an invalid locale code with 422", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/admin/locales",
        headers: adminHeader(),
        payload: { code: "!!not-valid!!", label: "Geçersiz", nativeLabel: "Invalid" },
      });
      expect(res.statusCode).toBe(422);
    });

    it("does not allow removing the default flag without transferring it, and cannot disable the default locale", async () => {
      const removeDefault = await app.inject({
        method: "PATCH",
        url: "/api/v1/admin/locales/tr",
        headers: adminHeader(),
        payload: { isDefault: false },
      });
      expect(removeDefault.statusCode).toBe(422);

      const disableDefault = await app.inject({
        method: "PATCH",
        url: "/api/v1/admin/locales/tr",
        headers: adminHeader(),
        payload: { enabled: false },
      });
      expect(disableDefault.statusCode).toBe(422);
    });

    it("transfers isDefault to another locale in a single operation (old default is unset)", async () => {
      // Varsayılan yapılmadan önce etkin olmalı (enabled:false iken isDefault:true 422 döner).
      await app.inject({
        method: "PATCH",
        url: "/api/v1/admin/locales/de",
        headers: adminHeader(),
        payload: { enabled: true },
      });

      const transfer = await app.inject({
        method: "PATCH",
        url: "/api/v1/admin/locales/de",
        headers: adminHeader(),
        payload: { isDefault: true },
      });
      expect(transfer.statusCode).toBe(200);
      expect(transfer.json().data.isDefault).toBe(true);

      const list = await app.inject({ method: "GET", url: "/api/v1/admin/locales", headers: adminHeader() });
      const byCode = Object.fromEntries(list.json().data.map((l: { code: string; isDefault: boolean }) => [l.code, l.isDefault]));
      expect(byCode.de).toBe(true);
      expect(byCode.tr).toBe(false);

      // Test izolasyonu için varsayılanı geri al.
      const restore = await app.inject({
        method: "PATCH",
        url: "/api/v1/admin/locales/tr",
        headers: adminHeader(),
        payload: { isDefault: true },
      });
      expect(restore.statusCode).toBe(200);
    });

    it("cannot delete the default locale (422), but can delete a non-default locale (204)", async () => {
      const deleteDefault = await app.inject({ method: "DELETE", url: "/api/v1/admin/locales/tr", headers: adminHeader() });
      expect(deleteDefault.statusCode).toBe(422);

      const deleteNonDefault = await app.inject({ method: "DELETE", url: "/api/v1/admin/locales/de", headers: adminHeader() });
      expect(deleteNonDefault.statusCode).toBe(204);

      const list = await app.inject({ method: "GET", url: "/api/v1/locales" });
      expect(list.json().data.map((l: { code: string }) => l.code)).not.toContain("de");
    });
  });

  describe("Fallback chain & localizations[] (Product/PortfolioItem — §0.1b ÖNCELİK 1 düzeltmesi)", () => {
    it("Product: translations are now READABLE on the public GET (previously write-only)", async () => {
      const create = await app.inject({
        method: "POST",
        url: "/api/v1/admin/products",
        headers: adminHeader(),
        payload: {
          title: "TR Ürün",
          priceCents: 1000,
          seoDescription: "TR açıklama",
          status: "PUBLISHED",
          translations: { en: { title: "EN Product", slug: "en-product" } },
        },
      });
      expect(create.statusCode).toBe(201);
      const product = create.json().data;
      expect(product.localizations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ locale: "tr", translated: true }),
          expect.objectContaining({ locale: "en", translated: true, slug: "en-product" }),
        ])
      );

      const defaultGet = await app.inject({ method: "GET", url: `/api/v1/products/${product.slug}` });
      expect(defaultGet.json().data.title).toBe("TR Ürün");

      const enGet = await app.inject({ method: "GET", url: `/api/v1/products/${product.slug}?locale=en` });
      expect(enGet.statusCode).toBe(200);
      expect(enGet.json().data.title).toBe("EN Product");
      // Override edilmeyen alan (seoDescription) kanonik dilden fallback eder.
      expect(enGet.json().data.seoDescription).toBe("TR açıklama");

      // §4/§12.2 — dile özel slug ile de doğrudan erişilebilir.
      const byEnSlug = await app.inject({ method: "GET", url: `/api/v1/products/en-product?locale=en` });
      expect(byEnSlug.statusCode).toBe(200);
      expect(byEnSlug.json().data.title).toBe("EN Product");
    });

    it("PortfolioItem: translations are now READABLE on the public GET (previously write-only)", async () => {
      const create = await app.inject({
        method: "POST",
        url: "/api/v1/admin/portfolio",
        headers: adminHeader(),
        payload: {
          title: "TR Portföy",
          status: "PUBLISHED",
          translations: { en: { title: "EN Portfolio" } },
        },
      });
      expect(create.statusCode).toBe(201);
      const item = create.json().data;

      const enGet = await app.inject({ method: "GET", url: `/api/v1/portfolio/${item.slug}?locale=en` });
      expect(enGet.statusCode).toBe(200);
      expect(enGet.json().data.title).toBe("EN Portfolio");
    });

    it("an unknown/disabled locale query silently falls back to the default locale (never 400/422)", async () => {
      const create = await app.inject({
        method: "POST",
        url: "/api/v1/admin/products",
        headers: adminHeader(),
        payload: { title: "Fallback Ürün", priceCents: 500, status: "PUBLISHED" },
      });
      const product = create.json().data;

      const res = await app.inject({ method: "GET", url: `/api/v1/products/${product.slug}?locale=xx-totally-bogus` });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.title).toBe("Fallback Ürün");
    });
  });

  describe("Slug çakışması (409 CONFLICT)", () => {
    it("rejects a locale-specific slug that collides with another content's slug in the same locale", async () => {
      const first = await app.inject({
        method: "POST",
        url: "/api/v1/admin/pages",
        headers: adminHeader(),
        payload: { title: "Birinci Sayfa", translations: { en: { title: "First EN", slug: "shared-slug" } } },
      });
      expect(first.statusCode).toBe(201);

      const second = await app.inject({
        method: "POST",
        url: "/api/v1/admin/pages",
        headers: adminHeader(),
        payload: { title: "İkinci Sayfa" },
      });
      const secondId = second.json().data.id;

      const conflict = await app.inject({
        method: "PATCH",
        url: `/api/v1/admin/pages/${secondId}`,
        headers: adminHeader(),
        payload: { translations: { en: { title: "Second EN", slug: "shared-slug" } } },
      });
      expect(conflict.statusCode).toBe(409);
    });

    it("deleting a locale's translation (null) removes its ContentSlug row and frees the slug", async () => {
      const create = await app.inject({
        method: "POST",
        url: "/api/v1/admin/pages",
        headers: adminHeader(),
        payload: { title: "Silinecek Çeviri", translations: { en: { title: "To Delete EN", slug: "free-me" } } },
      });
      const pageId = create.json().data.id;
      expect(create.json().data.translations.en.title).toBe("To Delete EN");

      const del = await app.inject({
        method: "PATCH",
        url: `/api/v1/admin/pages/${pageId}`,
        headers: adminHeader(),
        payload: { translations: { en: null } },
      });
      expect(del.statusCode).toBe(200);
      expect(del.json().data.translations.en).toBeUndefined();
      expect(del.json().data.localizations.find((l: { locale: string }) => l.locale === "en").translated).toBe(false);

      // Slug artık serbest — başka bir içerik onu kullanabilmeli (çakışma OLMAMALI).
      const other = await app.inject({
        method: "POST",
        url: "/api/v1/admin/pages",
        headers: adminHeader(),
        payload: { title: "Yeniden Kullanım", translations: { en: { title: "Reused EN", slug: "free-me" } } },
      });
      expect(other.statusCode).toBe(201);
    });
  });

  describe("isLegalDocument (§5.1 — hukuki belge istisnası)", () => {
    it("EDITOR gets 403 when sending isLegalDocument; ADMIN succeeds and an audit entry is created", async () => {
      const create = await app.inject({
        method: "POST",
        url: "/api/v1/admin/pages",
        headers: adminHeader(),
        payload: { title: "Gizlilik Politikası", status: "PUBLISHED" },
      });
      const pageId = create.json().data.id;
      expect(create.json().data.isLegalDocument).toBe(false);

      const editorAttempt = await app.inject({
        method: "PATCH",
        url: `/api/v1/admin/pages/${pageId}`,
        headers: editorHeader(),
        payload: { isLegalDocument: true },
      });
      expect(editorAttempt.statusCode).toBe(403);

      const adminSet = await app.inject({
        method: "PATCH",
        url: `/api/v1/admin/pages/${pageId}`,
        headers: adminHeader(),
        payload: { isLegalDocument: true },
      });
      expect(adminSet.statusCode).toBe(200);
      expect(adminSet.json().data.isLegalDocument).toBe(true);

      const logs = await app.inject({
        method: "GET",
        url: "/api/v1/admin/logs?action=content.legal_flag_change",
        headers: adminHeader(),
      });
      expect(logs.statusCode).toBe(200);
      expect(logs.json().data.some((log: { targetId: string }) => log.targetId === pageId)).toBe(true);
    });

    it("blanks `blocks` (server-side) for an untranslated locale, keeps `title`, returns 200 (never 404); admin route stays raw", async () => {
      const create = await app.inject({
        method: "POST",
        url: "/api/v1/admin/pages",
        headers: adminHeader(),
        payload: {
          title: "KVKK Aydınlatma Metni",
          status: "PUBLISHED",
          blocks: [{ type: "text", data: { html: "<p>Türkçe hukuki metin</p>" } }],
          isLegalDocument: true,
        },
      });
      const page = create.json().data;
      expect(page.isLegalDocument).toBe(true);

      // Çevrilmemiş dilde: blocks BOŞ, title KORUNUR, 404 DÖNMEZ.
      const enGet = await app.inject({ method: "GET", url: `/api/v1/pages/${page.slug}?locale=en` });
      expect(enGet.statusCode).toBe(200);
      expect(enGet.json().data.blocks).toEqual([]);
      expect(enGet.json().data.title).toBe("KVKK Aydınlatma Metni");

      // Admin route HAM kaydı döndürür — editör bozulmaz.
      const adminGet = await app.inject({ method: "GET", url: `/api/v1/admin/pages/${page.id}`, headers: adminHeader() });
      expect(adminGet.json().data.blocks.length).toBe(1);

      // EN'e çevrildikten sonra normal şekilde EN gövdesiyle açılır.
      await app.inject({
        method: "PATCH",
        url: `/api/v1/admin/pages/${page.id}`,
        headers: adminHeader(),
        payload: {
          translations: {
            en: { title: "GDPR Notice", blocks: [{ type: "text", data: { html: "<p>English legal text</p>" } }] },
          },
        },
      });

      const enGetAfterTranslation = await app.inject({ method: "GET", url: `/api/v1/pages/${page.slug}?locale=en` });
      expect(enGetAfterTranslation.statusCode).toBe(200);
      expect(enGetAfterTranslation.json().data.title).toBe("GDPR Notice");
      expect(enGetAfterTranslation.json().data.blocks.length).toBe(1);
    });

    it("a non-legal page (isLegalDocument: false) still applies normal silent fallback in the same situation", async () => {
      const create = await app.inject({
        method: "POST",
        url: "/api/v1/admin/pages",
        headers: adminHeader(),
        payload: {
          title: "Normal Sayfa",
          status: "PUBLISHED",
          blocks: [{ type: "text", data: { html: "<p>Türkçe içerik</p>" } }],
        },
      });
      const page = create.json().data;
      expect(page.isLegalDocument).toBe(false);

      const enGet = await app.inject({ method: "GET", url: `/api/v1/pages/${page.slug}?locale=en` });
      expect(enGet.statusCode).toBe(200);
      // Çeviri yok → blocks BOŞALTILMAZ, kanonik (TR) içerik sessizce fallback eder.
      expect(enGet.json().data.blocks.length).toBe(1);
      expect(enGet.json().data.title).toBe("Normal Sayfa");
    });

    // security-agent bulgusu (bkz. .claude/security-review-i18n.md, ORTA-YÜKSEK) — revizyon
    // geri yükleme yolu, ADMIN-only `isLegalDocument` kuralını ve `content.legal_flag_change`
    // audit'ini ATLAYABİLİYORDU. Regresyon: EDITOR, `isLegalDocument` alanı FARKLI olan eski bir
    // revizyonu geri yükleyince bu alan sessizce DEĞİŞMEMELİ (restore'un geri kalanı bloklanmaz),
    // ve sahte bir "SUCCESS" audit kaydı üretilmemeli.
    it("restoring a revision never lets an EDITOR silently flip isLegalDocument (field is skipped, no fabricated audit); ADMIN can and it is audited", async () => {
      const create = await app.inject({
        method: "POST",
        url: "/api/v1/admin/pages",
        headers: adminHeader(),
        payload: { title: "Mesafeli Satış Sözleşmesi", status: "PUBLISHED" },
      });
      const page = create.json().data;
      expect(page.isLegalDocument).toBe(false);

      // Revizyon 1: isLegalDocument=true iken snapshotlanır (bu PATCH `true`'ya çeker VE
      // `snapshotBeforeUpdate` az önceki `false` durumunu bir revizyon olarak kaydeder).
      const toTrue = await app.inject({
        method: "PATCH",
        url: `/api/v1/admin/pages/${page.id}`,
        headers: adminHeader(),
        payload: { isLegalDocument: true, title: "Mesafeli Satış Sözleşmesi v2" },
      });
      expect(toTrue.statusCode).toBe(200);
      expect(toTrue.json().data.isLegalDocument).toBe(true);

      // Bu andaki (isLegalDocument=true) durumu bir REVİZYON olarak yakalamak için tekrar
      // PATCH'leriz (ADMIN, meşru) — `snapshotBeforeUpdate` güncellemeden HEMEN ÖNCEKİ durumu
      // (isLegalDocument: true) revizyona yazar.
      const toFalse = await app.inject({
        method: "PATCH",
        url: `/api/v1/admin/pages/${page.id}`,
        headers: adminHeader(),
        payload: { isLegalDocument: false, title: "Mesafeli Satış Sözleşmesi v3" },
      });
      expect(toFalse.statusCode).toBe(200);
      expect(toFalse.json().data.isLegalDocument).toBe(false);

      const revisionsRes = await app.inject({
        method: "GET",
        url: `/api/v1/admin/pages/${page.id}/revisions`,
        headers: adminHeader(),
      });
      const revisions = revisionsRes.json().data as { id: string }[];
      // En yeni önce döner (bkz. listContentRevisions) — snapshot'ı isLegalDocument:true olan
      // revizyon, `toFalse` PATCH'inden HEMEN ÖNCEKİ durumdur → listedeki EN YENİ revizyon.
      const revisionWithLegalTrue = revisions[0]!.id;
      const revisionDetail = await app.inject({
        method: "GET",
        url: `/api/v1/admin/pages/${page.id}/revisions/${revisionWithLegalTrue}`,
        headers: adminHeader(),
      });
      expect((revisionDetail.json().data.snapshot as { isLegalDocument?: boolean }).isLegalDocument).toBe(true);

      // `GET /admin/logs` en yeniden en eskiye döner (bkz. logs.routes.ts) — bu sayfaya ait
      // audit kayıtlarını izole etmek için her adımda `targetId === page.id` ile filtrelenir
      // (dosyadaki DİĞER testlerin de aynı action'ı üretmiş olabileceği göz önünde bulundurulur).
      async function legalFlagLogsForPage() {
        const res = await app.inject({
          method: "GET",
          url: "/api/v1/admin/logs?action=content.legal_flag_change",
          headers: adminHeader(),
        });
        return (res.json().data as { targetId: string; status: string }[]).filter((log) => log.targetId === page.id);
      }

      // `toTrue`/`toFalse` PATCH'leri (ADMIN, meşru) zaten 2 SUCCESS kaydı üretti — bu sayı
      // aşağıdaki delta karşılaştırmalarının başlangıç noktasıdır.
      const logsBeforeEditorRestore = await legalFlagLogsForPage();
      expect(logsBeforeEditorRestore.length).toBe(2);
      expect(logsBeforeEditorRestore.every((log) => log.status === "SUCCESS")).toBe(true);

      // Mevcut durum isLegalDocument=false; EDITOR bu (isLegalDocument=true İÇEREN) revizyonu
      // geri yükler.
      const editorRestore = await app.inject({
        method: "POST",
        url: `/api/v1/admin/pages/${page.id}/revisions/${revisionWithLegalTrue}/restore`,
        headers: editorHeader(),
      });
      // Restore'un TAMAMI reddedilmez (403 DEĞİL) — yalnızca `isLegalDocument` alanı atlanır.
      expect(editorRestore.statusCode).toBe(200);
      // KRİTİK: bayrak SESSİZCE true'ya dönmedi.
      expect(editorRestore.json().data.isLegalDocument).toBe(false);
      // Geri kalan alanlar (title vb.) normal şekilde geri yüklendi (restore engellenmedi).
      expect(editorRestore.json().data.title).toBe("Mesafeli Satış Sözleşmesi v2");

      const dbPage = await app.prisma.page.findUniqueOrThrow({ where: { id: page.id } });
      expect(dbPage.isLegalDocument).toBe(false);

      // Sahte bir SUCCESS audit kaydı OLUŞMADI — tam olarak BİR yeni kayıt eklendi ve o da
      // FORBIDDEN statüsünde (reddedilen deneme görünür, ama restore'u bloklamadı).
      const logsAfterEditorRestore = await legalFlagLogsForPage();
      expect(logsAfterEditorRestore.length).toBe(logsBeforeEditorRestore.length + 1);
      const newestAfterEditor = logsAfterEditorRestore[0]!; // en yeni önce
      expect(newestAfterEditor.status).toBe("FORBIDDEN");

      // ADMIN AYNI revizyonu geri yüklerse bayrak GERÇEKTEN değişir ve normal (SUCCESS) audit üretilir.
      const adminRestore = await app.inject({
        method: "POST",
        url: `/api/v1/admin/pages/${page.id}/revisions/${revisionWithLegalTrue}/restore`,
        headers: adminHeader(),
      });
      expect(adminRestore.statusCode).toBe(200);
      expect(adminRestore.json().data.isLegalDocument).toBe(true);

      const logsAfterAdminRestore = await legalFlagLogsForPage();
      expect(logsAfterAdminRestore.length).toBe(logsAfterEditorRestore.length + 1);
      const newestAfterAdmin = logsAfterAdminRestore[0]!;
      expect(newestAfterAdmin.status).toBe("SUCCESS");
    });
  });
});
