import { test, expect } from "@playwright/test";
import {
  createPage,
  deletePagePermanently,
  getAdminAppearance,
  getCachedAdminSession,
  getNavigationConfig,
  patchAppearance,
  updateNavigationConfig,
} from "./support/api";

/**
 * Regresyon testi — bulunan bug: `frontend/src/app/[lang]/page.tsx` (ana sayfa, `/`) yanlışlıkla
 * `[lang]/(site)/layout.tsx` route-group'unun DIŞINDA duruyordu. Next.js'te `(site)` gibi
 * parantezli klasörler URL'e segment EKLEMEZ ama SADECE kendi İÇİNDEKİ sayfaları sarar — bu
 * grubun bir KARDEŞİ olarak duran `[lang]/page.tsx` ortak `SiteHeader`/`SiteFooter`'ı, admin
 * panelinden yönetilen Navigasyon menüsünü, `--site-primary` vb. Görünüm CSS değişkenlerini ve
 * Özel CSS/JS enjeksiyonunu HİÇ almıyordu — admin panelinde yapılan hiçbir değişiklik ana
 * sayfada görünmüyordu (diğer TÜM public sayfalar, zaten `(site)/` içinde oldukları için
 * ETKİLENMEMİŞTİ). Düzeltme: sayfa `[lang]/(site)/page.tsx`'e taşındı, `(site)/[slug]/page.tsx`
 * ile AYNI desene (yalnızca kendi içeriğini döndürür, header/footer'ı KENDİSİ render ETMEZ)
 * uyacak şekilde sadeleştirildi. URL yapısı DEĞİŞMEDİ (`/`, `/en` vb.).
 *
 * NOT (kasıtlı tasarım kararı): bu test CMS'te bir "Ana Sayfa" (`SiteSettings.homePageId`)
 * SEÇMEZ — `homePageId` boşken `/` kendi iç `Navbar`/`<footer>`'ı olan bir `FallbackHome`
 * gösterir (bkz. `components/marketing/fallback-home.tsx`), ama bu içerik de `[lang]/(site)/
 * page.tsx` (`RootPage`) İÇİNDE render edildiği için YİNE `(site)/layout.tsx`'in SiteHeader/
 * SiteFooter/nav/appearance'ını ÜSTÜNE alır — yani bu senaryo regresyonu doğrulamak için zaten
 * YETERLİDİR ve `fetchHomepageServer()`'ın `revalidate: 60` önbelleğinin GERÇEK bir "Ana Sayfa"
 * atanmasından sonra tazelenmesini bekleyen (~60sn'lik, gereksiz) bir ek gecikmeden KAÇINIR.
 * `FallbackHome`'un kendi `<footer>`, `(site)/layout.tsx`'in `<main>`'i İÇİNE nested olduğu için
 * HTML5 spesine göre `contentinfo` rolünü ALMAZ (yalnızca üst düzey `<footer>` alır) — bu yüzden
 * `getByRole("contentinfo")` genel `footer` etiket seçicisinden DAHA GÜVENİLİRDİR (strict-mode
 * ihlali YOK, doğrudan bu testte doğrulandı).
 *
 * Bu dosya bu regresyonun bir daha SESSİZCE geri gelmemesini iki katmanda garanti eder:
 *  1) Statik yapı — ana sayfa ile GERÇEK bir CMS sayfasının header/nav/footer DOM iskeleti
 *     (`nav[aria-label="Site gezinme"]` içindeki kök linkler, `getByRole("contentinfo")`) BİREBİR
 *     aynı. Ana sayfa `(site)/layout.tsx`'i almıyorsa bu iki liste ya BOŞ/farklı olur ya da nav/
 *     footer hiç render edilmez.
 *  2) Dinamik değer akışı — admin panelinden (API üzerinden, `support/api.ts` fixture'larıyla)
 *     navigasyona eklenen BENZERSİZ etiketli bir link VE değiştirilen `primaryColor`, hem ana
 *     sayfada HEM DE bir CMS sayfasında yansır. `(site)/layout.tsx`'in navigasyon/appearance
 *     fetch'leri `revalidate: 60` ile önbelleklidir (§4.3 ile AYNI politika — bkz.
 *     `admin-locale-management.spec.ts`); bu yüzden anlık DEĞİL, `expect.poll` ile (o dosyadaki
 *     AYNI desen) eventual-consistency penceresi kabul edilerek doğrulanır. Bu iki fetch (`/
 *     navigation`, `/appearance`) HER rotada AYNI URL/önbellek anahtarıyla okunduğu için (ana
 *     sayfa dahil, `homePageId`'den BAĞIMSIZ), ana sayfada bir kez tazelendikten sonra CMS
 *     sayfasında da HEMEN (ek bekleme OLMADAN) görünür — bkz. aşağıdaki ikinci `expect.poll`'un
 *     neden kısa sürede geçtiği.
 */

// `revalidate: 60` önbellek penceresi (bkz. dosya başlığı) `playwright.config.ts`'in genel
// `timeout: 30_000`'ini AŞABİLİR — bu yüzden bu dosyadaki TÜM testler/hook'lar için timeout
// büyütülür (Playwright `beforeAll`/`afterAll` de dahil `test.describe.configure({ timeout })`'a
// uyar) ve `admin-locale-management.spec.ts`teki AYNI gerekçeyle (yerel ortamda zamanlama
// varyansı) `retries` eklenir.
test.describe.configure({ timeout: 150_000, retries: 2 });

const FRONTEND_URL = process.env.E2E_FRONTEND_URL ?? "http://localhost:3100";
const NAV_LABEL = `QA Home Layout Parity ${Date.now()}`;
// Varsayılan `#4f46e5`'ten kolayca ayırt edilebilir, geçerli bir 6 haneli hex renk (`HexColorSchema`).
const TEST_PRIMARY_COLOR = "#0ea5a5";

let token: string;
let originalNavigation: Record<string, unknown>;
let originalPrimaryColor: string;
let testPage: Record<string, unknown>;

test.beforeAll(async () => {
  const admin = await getCachedAdminSession();
  token = admin.accessToken;

  originalNavigation = await getNavigationConfig(token);
  const appearance = await getAdminAppearance(token);
  originalPrimaryColor = appearance.primaryColor as string;

  testPage = await createPage(token, {
    title: "QA Home Layout Parity CMS Page",
    slug: `qa-home-layout-parity-${Date.now()}`,
    html: "<p>QA layout parity icerik.</p>",
  });
});

test.afterAll(async () => {
  // Navigasyon `PUT` TAM DEĞİŞTİRME (replace) semantiğine sahiptir (bkz. `navigation.routes.ts`
  // `deleteMany` + `createMany`) — orijinal DTO'nun AYNEN geri yazılması gerekir (bkz.
  // `support/api.ts::updateNavigationConfig` başlığı).
  await updateNavigationConfig(token, {
    headerCtaLabel: originalNavigation.headerCtaLabel,
    headerCtaHref: originalNavigation.headerCtaHref,
    footerCopyrightText: originalNavigation.footerCopyrightText,
    navigationItems: originalNavigation.navigationItems,
    socialLinks: originalNavigation.socialLinks,
    footerColumns: originalNavigation.footerColumns,
  });
  await patchAppearance(token, { primaryColor: originalPrimaryColor });
  await deletePagePermanently(token, testPage.id as string);
});

test.describe("Ana sayfa layout parity — regresyon: (site) route-group'unun DIŞINDA kalmasın", () => {
  test("ana sayfa ile bir CMS sayfası aynı header/nav/footer DOM iskeletini paylaşır", async ({ page }) => {
    await page.goto("/");
    const homeNav = page.locator('nav[aria-label="Site gezinme"]');
    await expect(homeNav).toBeVisible();
    await expect(page.getByRole("contentinfo")).toBeVisible();
    const homeLinkLabels = await homeNav.getByRole("link").allTextContents();

    await page.goto(`/${testPage.slug}`);
    const cmsNav = page.locator('nav[aria-label="Site gezinme"]');
    await expect(cmsNav).toBeVisible();
    await expect(page.getByRole("contentinfo")).toBeVisible();
    const cmsLinkLabels = await cmsNav.getByRole("link").allTextContents();

    // Regresyon kanıtı: ana sayfa `(site)/layout.tsx`'i ALMIYORSA header/nav ya TAMAMEN eksik
    // ya da farklı (eski, elle yazılmış, admin'deki Navigasyon menüsünden BAĞIMSIZ) bir yapıda
    // olurdu — iki sayfanın BİREBİR aynı linkleri (admin'de tanımlı TEK navigasyon menüsünden)
    // göstermesi bunun artık mümkün olmadığını kanıtlar.
    expect(homeLinkLabels).toEqual(cmsLinkLabels);
    expect(homeLinkLabels.length).toBeGreaterThan(0);
  });

  test("admin panelinden navigasyona eklenen benzersiz link VE primaryColor değişikliği ANA SAYFADA da yansır", async ({
    page,
  }) => {
    const rootItems = (originalNavigation.navigationItems as Array<Record<string, unknown>>).filter(
      (item) => item.parentId == null
    );
    const maxOrder = rootItems.reduce((max, item) => Math.max(max, item.order as number), -1);

    await updateNavigationConfig(token, {
      headerCtaLabel: originalNavigation.headerCtaLabel,
      headerCtaHref: originalNavigation.headerCtaHref,
      footerCopyrightText: originalNavigation.footerCopyrightText,
      navigationItems: [
        ...(originalNavigation.navigationItems as Array<Record<string, unknown>>),
        { label: NAV_LABEL, href: "/", order: maxOrder + 1, parentId: null },
      ],
      socialLinks: originalNavigation.socialLinks,
      footerColumns: originalNavigation.footerColumns,
    });
    await patchAppearance(token, { primaryColor: TEST_PRIMARY_COLOR });

    // `revalidate: 60` — anlık değil, eventual consistency (bkz. dosya başlığı). Tıpkı
    // `admin-locale-management.spec.ts` "madde 7" testindeki gibi, önce hafif bir `fetch` ile
    // poll edilir (tam sayfa navigasyonu tekrar tekrar TETİKLENMEZ), sonra GERÇEK bir
    // `page.goto` ile DOM üzerinden doğrulanır.
    await expect
      .poll(async () => (await fetch(`${FRONTEND_URL}/`)).text(), { timeout: 90_000, intervals: [2_000] })
      .toContain(NAV_LABEL);

    await page.goto("/");
    await expect(page.locator('nav[aria-label="Site gezinme"]').getByRole("link", { name: NAV_LABEL })).toBeVisible();
    const homePrimary = await page
      .locator(".site-scope")
      .evaluate((el) => getComputedStyle(el).getPropertyValue("--site-primary").trim());
    expect(homePrimary).toBe(TEST_PRIMARY_COLOR);

    // AYNI değerler bir CMS sayfasında da (regresyondan ÖNCE de zaten çalışan yol) yansır — ana
    // sayfanın artık o sayfayla EŞİT davrandığını kanıtlamak için ikinci bir referans noktası.
    // `/navigation` ve `/appearance` HER rotada AYNI önbellek anahtarıyla okunduğu için (bkz.
    // dosya başlığı) bu ikinci poll'un YUKARIDAKİ ana sayfa poll'undan çok daha hızlı geçmesi
    // BEKLENİR (aynı önbellek girdisi zaten tazelendi) — yine de eventual-consistency ihtimaline
    // karşı aynı desen korunur.
    await expect
      .poll(async () => (await fetch(`${FRONTEND_URL}/${testPage.slug}`)).text(), {
        timeout: 90_000,
        intervals: [2_000],
      })
      .toContain(NAV_LABEL);

    await page.goto(`/${testPage.slug}`);
    await expect(page.locator('nav[aria-label="Site gezinme"]').getByRole("link", { name: NAV_LABEL })).toBeVisible();
    const cmsPrimary = await page
      .locator(".site-scope")
      .evaluate((el) => getComputedStyle(el).getPropertyValue("--site-primary").trim());
    expect(cmsPrimary).toBe(TEST_PRIMARY_COLOR);
  });
});
