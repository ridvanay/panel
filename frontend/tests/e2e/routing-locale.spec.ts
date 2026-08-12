import { test, expect } from "@playwright/test";
import { createPage, deletePagePermanently, getCachedAdminSession } from "./support/api";

/**
 * `.claude/architect-scope-i18n.md` §9 qa-agent madde 1-3, 9-10.
 * Gerçek Next.js dev sunucusuna (`playwright.config.ts` webServer, 3100) ve gerçek backend'e
 * (4001, `saas_e2e`) karşı çalışır — `frontend/src/proxy.ts` + `app/[lang]/(site)/**` taşımasının
 * tarayıcıda gerçekten doğru davrandığını doğrular (vitest'in yapamadığı, tam navigasyon zinciri).
 */

let token: string;
const createdPageIds: string[] = [];

test.beforeAll(async () => {
  const admin = await getCachedAdminSession();
  token = admin.accessToken;
});

test.afterAll(async () => {
  for (const id of createdPageIds) await deletePagePermanently(token, id);
});

test.describe("Public locale routing (§9 madde 1-3)", () => {
  test("TR sayfa açılır, dil değiştirici ile EN'e geçilince /en/<en-slug> altında EN içerik gösterilir", async ({
    page,
  }) => {
    const created = await createPage(token, {
      title: "QA Rota Testi",
      slug: `qa-rota-testi-${Date.now()}`,
      html: "<p>Bu Turkce icerik.</p>",
      translations: { en: { title: "QA Routing Test", slug: `qa-routing-test-${Date.now()}`, html: "<p>This is English content.</p>" } },
    });
    createdPageIds.push(created.id as string);
    const trSlug = created.slug as string;
    const enSlug = (created.translations as Record<string, { slug: string }>).en.slug;

    await page.goto(`/${trSlug}`);
    await expect(page.locator("body")).toContainText("Bu Turkce icerik.");

    // Dil değiştirici — design-notes-i18n.md §1.1 (`Dil seç` aria-label, Globe ikonlu buton).
    await page.getByRole("button", { name: "Dil seç" }).click();
    await page.getByRole("menuitem", { name: "English" }).click();

    await page.waitForURL(new RegExp(`/en/${enSlug}$`));
    await expect(page.locator("body")).toContainText("This is English content.");
  });

  test("dil değiştiriciyle CLIENT-SIDE geçişte <html lang> güncellenir", async ({ page }) => {
    // §6.3 "`<html lang>` aktif locale'den türetilecek" — `app/layout.tsx` bunu `x-active-locale`
    // request header'ından okur (yalnızca TAM sayfa yüklemesinde). Kök layout `[lang]` segmentinin
    // ÜSTÜNDE olduğundan (Next.js layout'ları navigasyonda yeniden RENDER EDİLMEZ), dil
    // değiştiricideki `<Link>` gibi CLIENT-SIDE (RSC) navigasyonlarda kök layout tek başına
    // güncel kalamaz. Düzeltme: `components/html-lang-sync.tsx` — navigasyon-duyarlı `useParams()`
    // okuyan bir Client Component, `document.documentElement.lang`'ı imperatif olarak senkronize
    // eder (kök `app/layout.tsx`'te `<HtmlLangSync />` olarak mount edilir). Daha önce BUG olarak
    // `test.fail()` işaretliydi — düzeltildi (qa-agent raporu → frontend-agent).
    const created = await createPage(token, {
      title: "QA Lang Attr",
      slug: `qa-lang-attr-${Date.now()}`,
      html: "<p>TR icerik.</p>",
      translations: { en: { title: "QA Lang Attr EN", slug: `qa-lang-attr-en-${Date.now()}`, html: "<p>EN content.</p>" } },
    });
    createdPageIds.push(created.id as string);

    await page.goto(`/${created.slug}`);
    await page.getByRole("button", { name: "Dil seç" }).click();
    await page.getByRole("menuitem", { name: "English" }).click();
    await page.waitForURL(/\/en\//);

    await expect(page.locator("html")).toHaveAttribute("lang", "en");
  });

  test("çevrilmemiş içerik /en/... altında 404 DEĞİL, varsayılan (TR) dilde açılır (§5 sessiz fallback)", async ({
    page,
  }) => {
    const created = await createPage(token, {
      title: "QA Cevrilmemis",
      slug: `qa-cevrilmemis-${Date.now()}`,
      html: "<p>Sadece Turkce icerik mevcut.</p>",
    });
    createdPageIds.push(created.id as string);
    const slug = created.slug as string;

    const response = await page.goto(`/en/${slug}`);
    expect(response?.status()).toBe(200);
    await expect(page.locator("body")).toContainText("Sadece Turkce icerik mevcut.");
    await expect(page.getByText("Sayfa bulunamadı", { exact: false })).toHaveCount(0);
  });

  test("/tr/<slug> isteği 301 ile prefix'siz kanonik URL'e yönlendirilir", async ({ page }) => {
    const created = await createPage(token, {
      title: "QA TR Prefix",
      slug: `qa-tr-prefix-${Date.now()}`,
      html: "<p>TR prefix testi.</p>",
    });
    createdPageIds.push(created.id as string);
    const slug = created.slug as string;

    const response = await page.goto(`/tr/${slug}`);
    // Playwright `page.goto` yönlendirmeyi takip eder — son URL'in prefix'siz olduğunu doğrula.
    expect(new URL(page.url()).pathname).toBe(`/${slug}`);
    expect(response?.request().redirectedFrom()).not.toBeNull();
    await expect(page.locator("body")).toContainText("TR prefix testi.");
  });

  test("§12.2: kanonik TR slug'ı ile ama /en/ prefix'i altında gelen istek, EN'in KENDİ slug'ına 301 ile yönlendirilir", async ({
    page,
  }) => {
    // `.claude/architect-scope-i18n.md` §12.2 (bağlayıcı): "/en/gizlilik-politikasi" gibi bir
    // istek (varsayılan dilin kanonik slug'ı + farklı bir locale prefix'i) İÇERİĞİ doğru bulur
    // (backend slug fallback'i zaten çözer — bu kısım ÇALIŞIYOR, aşağıda ayrıca doğrulanıyor)
    // AMA kozmetik/SEO gerekçesiyle EN'in KENDİ güzel slug'ına yönlendirilmesi GEREKİR; aksi
    // halde aynı içerik iki farklı EN URL'inde (duplicate content) erişilebilir kalır. Düzeltme:
    // `lib/i18n/canonical-slug.ts::redirectToCanonicalSlug()` — dört detay sayfasında
    // (`[slug]`, `blog/[slug]`, `products/[slug]`, `portfolio/[slug]`) çağrılır, `localizations`
    // içindeki aktif-dil slug'ı istenenden farklıysa `permanentRedirect()` (308 — Next.js Server
    // Component'lerden üretilebilen tek "kalıcı" yönlendirme kodu, ham 301 YOKTUR) tetikler.
    // Daha önce BUG olarak `test.fail()` işaretliydi — düzeltildi (qa-agent raporu → frontend-agent).
    const enSlug = `qa-1222-en-slug-${Date.now()}`;
    const created = await createPage(token, {
      title: "QA 12.2 Canonical Under EN",
      slug: `qa-1222-tr-slug-${Date.now()}`,
      html: "<p>TR icerik.</p>",
      translations: { en: { title: "QA 12.2 EN", slug: enSlug, html: "<p>EN icerik.</p>" } },
    });
    createdPageIds.push(created.id as string);
    const trSlug = created.slug as string;

    const response = await page.goto(`/en/${trSlug}`);
    // İçerik doğru bulunur (backend fallback'i) — bu kısım zaten ÇALIŞIYOR.
    expect(response?.status()).toBe(200);
    await expect(page.locator("body")).toContainText("EN icerik.");

    // Beklenen (mimari §12.2): 301 ile /en/<en-slug>'a yönlendirilmeliydi.
    expect(new URL(page.url()).pathname).toBe(`/en/${enSlug}`);
  });

  test("REGRESYON — mevcut TR ana sayfa ve liste rotaları prefix'siz, [lang] taşımasından etkilenmemiş", async ({
    page,
  }) => {
    // §11 açık risk tablosu: "(site) → [lang]/(site) taşıması tüm public rotalara dokunur".
    // Ana sayfa ve `/blog` liste sayfası — her ikisi de taşımadan ÖNCE de bu path'lerde
    // yayındaydı; 200 dönmeleri ve `<html lang="tr">` taşımaları regresyon YOK demektir.
    const home = await page.goto("/");
    expect(home?.status()).toBe(200);
    await expect(page.locator("html")).toHaveAttribute("lang", "tr");
    expect(new URL(page.url()).pathname).toBe("/");

    const blogList = await page.goto("/blog");
    expect(blogList?.status()).toBe(200);
    expect(new URL(page.url()).pathname).toBe("/blog");
  });
});

test.describe("SEO — hreflang / x-default (§9 madde 10)", () => {
  test("çevrilmiş içerikte hreflang + x-default var; çevrilmemiş dil için alternate YOK", async ({ page }) => {
    const translatedSlug = `qa-seo-translated-${Date.now()}`;
    const enSlug = `qa-seo-translated-en-${Date.now()}`;
    const created = await createPage(token, {
      title: "QA SEO Translated",
      slug: translatedSlug,
      html: "<p>SEO icerik.</p>",
      translations: { en: { title: "QA SEO EN", slug: enSlug, html: "<p>SEO content.</p>" } },
    });
    createdPageIds.push(created.id as string);

    await page.goto(`/${translatedSlug}`);
    const trHref = await page.locator('link[rel="alternate"][hreflang="tr"]').getAttribute("href");
    const enHref = await page.locator('link[rel="alternate"][hreflang="en"]').getAttribute("href");
    const xDefaultHref = await page.locator('link[rel="alternate"][hreflang="x-default"]').getAttribute("href");

    expect(trHref).toContain(`/${translatedSlug}`);
    expect(enHref).toContain(`/en/${enSlug}`);
    expect(xDefaultHref).toBe(trHref);

    // Çevrilmemiş bir sayfada EN alternate'i OLMAMALI.
    const untranslated = await createPage(token, {
      title: "QA SEO Untranslated",
      slug: `qa-seo-untranslated-${Date.now()}`,
      html: "<p>Sadece TR SEO.</p>",
    });
    createdPageIds.push(untranslated.id as string);
    await page.goto(`/${untranslated.slug}`);
    await expect(page.locator('link[rel="alternate"][hreflang="en"]')).toHaveCount(0);
    await expect(page.locator('link[rel="alternate"][hreflang="x-default"]')).toHaveCount(1);
  });
});
