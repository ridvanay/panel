import { test, expect, type Page } from "@playwright/test";
import {
  API_BASE_URL,
  createPage,
  deletePagePermanently,
  getAdminAppearance,
  getCachedAdminSession,
  patchAppearance,
} from "./support/api";
import { createAuthenticatedPage } from "./support/admin-session";

/**
 * qa-agent — `.claude/design-notes-header-colors.md` (Header/Menü Renk Sistemi + akıllı yapışkan
 * (smart sticky) header davranışı, görev sırası ui-designer → backend-agent → frontend-agent →
 * qa-agent) için e2e kapsamı. Backend/frontend implementasyonu zaten kendi
 * unit/entegrasyon testleriyle kapsanıyor (`backend/tests/integration/appearance.test.ts`,
 * `frontend/tests/unit/admin-appearance-*.test.tsx`, `frontend/tests/unit/site-header*.test.tsx`)
 * — bu dosya SADECE gerçek tarayıcı + gerçek backend + gerçek Postgres ile:
 *  1) admin canlı önizlemenin (kaydetmeden) ANINDA — network round-trip OLMADAN — güncellendiğini,
 *  2) "Bu bölümü kaydet"in sunucu tarafında kalıcı olduğunu (`admin-appearance-theme-tokens.spec.ts`
 *     ile AYNI desen: `expect.poll` + `page.reload()`),
 *  3) public `(site)` layout'unun `revalidate: 60` eventual-consistency'siyle (`.poll(...,
 *     { timeout: 90_000 })`, AYNI dosyadaki desen — reaktif bir "fix" GEREKMEZ, bu proje kararı)
 *     yeni `--site-header-*` token'larını yansıttığını,
 *  4) `stickyHeaderEnabled=true` iken akıllı sticky scroll davranışının (aşağı kaydırmada > 120px
 *     sonra gizlenme; YUKARI kaydırmanın scrollY'nin HERHANGİ bir noktasında — eski bug'ın SADECE
 *     `scrollY===0`'da çalıştığı senaryonun AKSİNE — anında geri gelmesi; `scrollY < 20`'de idle/
 *     gölgesiz duruma dönmesi) gerçek tarayıcı scroll simülasyonuyla doğru çalıştığını doğrular.
 *
 * qa-agent bulgusu (frontend-agent/ui-designer'a raporlanmalı, bu dosyada SADECE atlatılıyor,
 * DÜZELTİLMİYOR — bkz. proje kuralı "qa-agent bug'ı kendi düzeltmez"): `headerLinkColor` alanının
 * admin UI etiketi ("Bağlantı Rengi", `frontend/src/app/admin/appearance/page.tsx` ~satır 1394,
 * `design-notes-header-colors.md` §6'daki kod iskeletiyle birebir) MEVCUT `linkColor` alanının
 * ("Bileşen Renkleri" grubu, AYNI "Stil / Renk" sekmesinde, AYNI ANDA DOM'da) etiketiyle BİREBİR
 * AYNI — ikisi de `ColorField`'in ürettiği "Bağlantı Rengi — hex kod" aria-label'ını üretir. İki
 * farklı, aynı sayfada aynı anda görünen form alanı için birebir aynı erişilebilir isim (a) ekran
 * okuyucu kullanıcıların iki alanı ayırt etmesini zorlaştırır, (b) `page.getByLabel("Bağlantı
 * Rengi — hex kod")` KULLANAN herhangi bir Playwright locator'ını strict-mode ihlaliyle (2 eşleşme)
 * PATLATIR. Bu dosya bu yüzden `getByLabel` YERİNE `id` tabanlı bir yardımcı kullanır (`hexInputFor`,
 * aşağıda — native renk `<input>`'unun `id`'sinden DOM kardeşliğiyle hex `<Input>`'u bulur). Öneri:
 * `headerLinkColor` etiketi "Menü Bağlantı Rengi" gibi ayırt edici bir metne değiştirilmeli (görev
 * tanımının kendisi de zaten tutarlı biçimde "menü rengi" terminolojisini kullanıyor).
 *
 * NOT (auth): `admin-appearance-theme-tokens.spec.ts` başlığındaki AYNI gerekçeyle bu dosya kendi
 * `browser`/context'ini `support/admin-session.ts` ile kurar.
 */
test.describe.configure({ timeout: 150_000, retries: 2 });

const FRONTEND_URL = process.env.E2E_FRONTEND_URL ?? "http://localhost:3100";

// Diğer appearance e2e dosyalarında (`#22c55e`, `#0ea5e9`, `#ff2d78`, `#065f46`) KULLANILMAYAN,
// belirgin hex'ler — tesadüfi eşleşme riskini ortadan kaldırır.
const HEADER_BG_TEST = "#123456cc";
const HEADER_STICKY_BG_TEST = "#123456f2";
const HEADER_LINK_TEST = "#0d9488";
const HEADER_LINK_HOVER_TEST = "#0f766e";
const HEADER_LINK_ACTIVE_TEST = "#7c3aed";

let page: Page;
let closeSession: () => Promise<void>;
let token: string;
let original: {
  headerBgColor: string;
  headerStickyBgColor: string;
  headerStickyBlurEnabled: boolean;
  headerLinkColor: string;
  headerLinkHoverColor: string;
  headerLinkActiveColor: string;
  stickyHeaderEnabled: boolean;
};

/**
 * `ColorField`'in ürettiği hex `<Input>`'unu, native renk `<input>`'unun `id`'sinden DOM
 * kardeşliğiyle bulur — `getByLabel` KASITLI OLARAK kullanılmaz (bkz. dosya başı qa-agent
 * bulgusu: `headerLinkColor` ile `linkColor` AYNI "Bağlantı Rengi — hex kod" aria-label'ını
 * üretir, `id` ise HER ZAMAN benzersizdir).
 */
function hexInputFor(fieldId: string) {
  return page.locator(`input#${fieldId}`).locator("xpath=following-sibling::input[1]");
}

test.beforeAll(async ({ browser }) => {
  ({ page, close: closeSession } = await createAuthenticatedPage(browser));
  const admin = await getCachedAdminSession();
  token = admin.accessToken;
  const appearance = await getAdminAppearance(token);
  original = {
    headerBgColor: appearance.headerBgColor as string,
    headerStickyBgColor: appearance.headerStickyBgColor as string,
    headerStickyBlurEnabled: appearance.headerStickyBlurEnabled as boolean,
    headerLinkColor: appearance.headerLinkColor as string,
    headerLinkHoverColor: appearance.headerLinkHoverColor as string,
    headerLinkActiveColor: appearance.headerLinkActiveColor as string,
    stickyHeaderEnabled: appearance.stickyHeaderEnabled as boolean,
  };
});

test.afterAll(async () => {
  await patchAppearance(token, { ...original });
  await closeSession();
});

test("Header renk alanı değiştirilince (kaydetmeden) canlı önizleme ANINDA güncellenir", async () => {
  await page.goto("/admin/appearance");
  await page.getByRole("tab", { name: "Stil / Renk" }).click();

  const bgHexInput = hexInputFor("headerBgColor");
  await expect(bgHexInput).toBeVisible();

  const previewScope = page.locator(".site-scope");
  await expect(previewScope).toBeVisible();

  const before = await previewScope.evaluate((el) =>
    getComputedStyle(el).getPropertyValue("--site-header-bg").trim()
  );
  expect(before).not.toBe(HEADER_BG_TEST);

  await bgHexInput.fill(HEADER_BG_TEST);

  // Network round-trip YOK (henüz kaydedilmedi) — form state → `previewCssVars` React
  // re-render'ı yalnızca istemci tarafı bir state güncellemesi, bu yüzden `expect.poll` çok
  // kısa bir timeout'la (2sn, sık aralıklarla) senkron/anlık olduğunu kanıtlar — diğer appearance
  // e2e dosyalarındaki 90sn'lik `revalidate: 60` poll'unun TAM TERSİ bir iddia.
  await expect
    .poll(
      async () =>
        previewScope.evaluate((el) => getComputedStyle(el).getPropertyValue("--site-header-bg").trim()),
      { timeout: 2_000, intervals: [50, 100, 250] }
    )
    .toBe(HEADER_BG_TEST);
});

test("Header renk bölümü kaydedilince sunucuda kalıcı kalır ve reload sonrası doğru gösterilir", async () => {
  await page.goto("/admin/appearance");
  await page.getByRole("tab", { name: "Stil / Renk" }).click();

  await hexInputFor("headerBgColor").fill(HEADER_BG_TEST);
  await hexInputFor("headerLinkColor").fill(HEADER_LINK_TEST);
  await hexInputFor("headerLinkHoverColor").fill(HEADER_LINK_HOVER_TEST);
  await hexInputFor("headerLinkActiveColor").fill(HEADER_LINK_ACTIVE_TEST);
  await hexInputFor("headerStickyBgColor").fill(HEADER_STICKY_BG_TEST);

  const blurSwitch = page.getByRole("switch", { name: "Yapışkan header bulanıklığı" });
  await expect(blurSwitch).toBeVisible();
  const blurCheckedBefore = (await blurSwitch.getAttribute("aria-checked")) === "true";
  if (blurCheckedBefore) await blurSwitch.click();
  await expect(blurSwitch).toHaveAttribute("aria-checked", "false");

  await page.getByRole("button", { name: "Bu bölümü kaydet" }).click();
  await expect(page.getByText("Değişiklikler kaydedildi.")).toBeVisible();

  // Sunucu tarafında da kalıcı — UI state'e değil gerçek API'ye karşı doğrulanır
  // (`admin-appearance-theme-tokens.spec.ts` ile AYNI desen).
  await expect
    .poll(async () => (await getAdminAppearance(token)).headerBgColor, { timeout: 10_000 })
    .toBe(HEADER_BG_TEST);
  const saved = await getAdminAppearance(token);
  expect(saved.headerLinkColor).toBe(HEADER_LINK_TEST);
  expect(saved.headerLinkHoverColor).toBe(HEADER_LINK_HOVER_TEST);
  expect(saved.headerLinkActiveColor).toBe(HEADER_LINK_ACTIVE_TEST);
  expect(saved.headerStickyBgColor).toBe(HEADER_STICKY_BG_TEST);
  expect(saved.headerStickyBlurEnabled).toBe(false);

  await page.reload();
  await page.getByRole("tab", { name: "Stil / Renk" }).click();
  await expect(hexInputFor("headerBgColor")).toHaveValue(HEADER_BG_TEST);
  await expect(hexInputFor("headerLinkColor")).toHaveValue(HEADER_LINK_TEST);
  await expect(hexInputFor("headerLinkHoverColor")).toHaveValue(HEADER_LINK_HOVER_TEST);
  await expect(hexInputFor("headerLinkActiveColor")).toHaveValue(HEADER_LINK_ACTIVE_TEST);
  await expect(hexInputFor("headerStickyBgColor")).toHaveValue(HEADER_STICKY_BG_TEST);
  await expect(page.getByRole("switch", { name: "Yapışkan header bulanıklığı" })).toHaveAttribute(
    "aria-checked",
    "false"
  );
});

test("public GET /appearance ve (site) layout'un --site-header-* CSS değişkenleri eventual olarak yansır", async ({
  page: publicPage,
}) => {
  // Bir önceki testte kaydedilen değerlerin public API sözleşmesine de yansıdığını doğrular
  // (regresyon tripwire'ı, `admin-appearance-theme-tokens.spec.ts`'teki AYNI desen).
  const publicRes = await fetch(`${API_BASE_URL}/appearance`);
  const publicData = (await publicRes.json()).data as Record<string, unknown>;
  expect(publicData.headerBgColor).toBe(HEADER_BG_TEST);
  expect(publicData.headerStickyBgColor).toBe(HEADER_STICKY_BG_TEST);
  expect(publicData.headerLinkColor).toBe(HEADER_LINK_TEST);
  expect(publicData.headerLinkHoverColor).toBe(HEADER_LINK_HOVER_TEST);
  expect(publicData.headerLinkActiveColor).toBe(HEADER_LINK_ACTIVE_TEST);

  // `(site)/layout.tsx` `revalidate: 60` önbelleklidir — anlık DEĞİL, eventual consistency
  // (bu proje kararı, bkz. dosya başlığı).
  await expect
    .poll(async () => (await fetch(`${FRONTEND_URL}/`)).text(), { timeout: 90_000, intervals: [2_000] })
    .toContain(HEADER_BG_TEST);

  await publicPage.goto("/");
  const siteScope = publicPage.locator(".site-scope");
  await expect(siteScope).toBeVisible();
  const cssVars = await siteScope.evaluate((el) => {
    const style = getComputedStyle(el);
    return {
      headerBg: style.getPropertyValue("--site-header-bg").trim(),
      headerBgSticky: style.getPropertyValue("--site-header-bg-sticky").trim(),
      headerLink: style.getPropertyValue("--site-header-link").trim(),
      headerLinkHover: style.getPropertyValue("--site-header-link-hover").trim(),
      headerLinkActive: style.getPropertyValue("--site-header-link-active").trim(),
    };
  });
  expect(cssVars.headerBg).toBe(HEADER_BG_TEST);
  expect(cssVars.headerBgSticky).toBe(HEADER_STICKY_BG_TEST);
  expect(cssVars.headerLink).toBe(HEADER_LINK_TEST);
  expect(cssVars.headerLinkHover).toBe(HEADER_LINK_HOVER_TEST);
  expect(cssVars.headerLinkActive).toBe(HEADER_LINK_ACTIVE_TEST);
});

test.describe("Akıllı yapışkan (smart sticky) header — gerçek scroll simülasyonu", () => {
  let stickyTestSlug: string;
  let stickyTestPageId: string;

  test.beforeAll(async () => {
    if (!original.stickyHeaderEnabled) {
      await patchAppearance(token, { stickyHeaderEnabled: true });
    }

    // qa-agent bulgusu: `/` anasayfasının kaydırılabilir yüksekliği (bu ortamda ~409px, 1280x720
    // viewport'ta) VE `/products` katalog sayfasının (bu e2e veritabanındaki ürün sayısına göre
    // DEĞİŞKEN, ölçüldüğünde ~295px) 600px'lik aşağı kaydırma senaryosu için YETERSİZ/GÜVENİLMEZ
    // (tarayıcı `scrollTo`'yu `scrollHeight - viewportHeight`'e clamp eder). Yapay
    // `document.body.style.minHeight` ARTIRIMI YOK (görev talimatı) — bunun yerine `db-agent`in
    // seed script'i yerine kendi qa-fixture'ımız olan, GERÇEKTEN uzun (çok sayıda paragraf) bir
    // `Page` oluşturulur (`createPage` — diğer e2e dosyalarındaki fixture deseniyle AYNI). Bu,
    // sitenin GERÇEK (site) layout'unu (SiteHeader dahil) kullanan, gerçekten render edilen,
    // deterministik uzunlukta bir sayfa üretir — CSS ile sahte yükseklik DEĞİL.
    const longHtml = Array.from(
      { length: 80 },
      (_, i) => `<p>QA sticky-scroll e2e dolgu paragrafı #${i + 1} — gerçek render edilen içerik.</p>`
    ).join("\n");
    stickyTestSlug = `qa-sticky-scroll-${Date.now()}`;
    const created = await createPage(token, {
      title: "QA Sticky Scroll Test",
      slug: stickyTestSlug,
      html: longHtml,
      status: "PUBLISHED",
    });
    stickyTestPageId = created.id as string;
  });

  test.afterAll(async () => {
    if (stickyTestPageId) await deletePagePermanently(token, stickyTestPageId);
  });

  test("aşağı kaydırma > 120px'te gizlenir; YUKARI kaydırmanın HERHANGİ bir noktasında (sadece scrollY=0'da DEĞİL) anında/pürüzsüzce geri gelir; scrollY < 20'de idle'a döner", async ({
    page: publicPage,
  }) => {
    await publicPage.goto(`/${stickyTestSlug}`);
    const header = publicPage.locator(".site-scope > header").first();
    await expect(header).toBeVisible();

    const { scrollHeight, viewportHeight } = await publicPage.evaluate(() => ({
      scrollHeight: document.documentElement.scrollHeight,
      viewportHeight: window.innerHeight,
    }));
    test.skip(
      scrollHeight - viewportHeight < 650,
      `QA fixture sayfası bu ortamda sticky-scroll senaryosu için yeterli yükseklikte değil (kaydırılabilir: ${scrollHeight - viewportHeight}px)`
    );

    // İdle (scrollY=0) — sticky etkin ama henüz kaydırılmamış: görünür, gölgesiz.
    await expect(header).toBeInViewport();
    await expect(header).not.toHaveClass(/shadow-sm/);

    // Aşağı > 120px (0 → 600) — header viewport dışına gizlenir.
    await publicPage.evaluate(() => window.scrollTo(0, 600));
    await expect(header).not.toBeInViewport();

    // 100px YUKARI (600 → 500, SIFIRA DÖNMEDEN) — eski bug'da bu SADECE scrollY===0'a
    // dönünce çalışıyordu; header artık scrollY=500'de de pürüzsüzce (transition tamamlanana
    // kadar `expect`'in otomatik yeniden-denemesiyle) tekrar görünür VE sticky gölgesini alır.
    await publicPage.evaluate(() => window.scrollTo(0, 500));
    await expect(header).toBeInViewport();
    await expect(header).toHaveClass(/shadow-sm/);

    // scrollY < 20'ye dön — idle (gölgesiz) duruma döner.
    await publicPage.evaluate(() => window.scrollTo(0, 0));
    await expect(header).toBeInViewport();
    await expect(header).not.toHaveClass(/shadow-sm/);
  });
});
