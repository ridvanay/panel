import { test, expect, type Page } from "@playwright/test";
import {
  getCachedAdminSession,
  createPage as createPageFixture,
  createPageWithBlocks,
  deletePagePermanently,
  uploadTestMedia,
  deleteTestMedia,
} from "./support/api";
import { createAuthenticatedPage } from "./support/admin-session";
import { createSlider, cleanupSlider, createSlide, updateSlider, deleteSliderRaw, getSlider, buildSliderShortcode } from "./support/sliders-fixtures";
import { createBlogPost, updateBlogPostContentHtml, deleteBlogPostPermanently } from "./support/blog-fixtures";

/**
 * qa-agent — `.claude/architect-scope-advanced-slider.md` §7 "QA kapsamı" (Page-builder + public,
 * 7 senaryo). `admin-page-builder-marketing.spec.ts`teki AYNI iki-katmanlı desen: (10) admin
 * editöründe blok ekleme UI'sini `patchPageBlocks`e GÜVENMEDEN doğrulayan tek bir test, geri
 * kalan 6 senaryo backend fixture'ları (`support/sliders-fixtures.ts` + `support/api.ts`) ile
 * DOĞRUDAN kurulup GERÇEK public URL'e karşı doğrulanır — public sitenin auth İSTEMEDİĞİ için
 * (`playwright.config.ts` başlığı) bu testler varsayılan `page` fixture'ını kullanır.
 */
test.describe.configure({ retries: 1 });

const FRONTEND_URL = process.env.E2E_FRONTEND_URL ?? "http://localhost:3100";

let adminToken: string;
let adminPage: Page;
let closeAdminSession: () => Promise<void>;

test.beforeAll(async ({ browser }, testInfo) => {
  testInfo.setTimeout(60_000);
  const session = await getCachedAdminSession();
  adminToken = session.accessToken;
  ({ page: adminPage, close: closeAdminSession } = await createAuthenticatedPage(browser));
});

test.afterAll(async () => {
  if (closeAdminSession) await closeAdminSession();
});

function uniqueName(prefix: string): string {
  return `${prefix} ${Date.now().toString(36)}${Math.floor(Math.random() * 46_656).toString(36)}`;
}

function uniqueSlug(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}${Math.floor(Math.random() * 46_656).toString(36)}`;
}

/** Basit bir slayt (varsayılan degrade arka plan, tek bir belirgin metinli `heading` katmanı). */
function headingLayer(id: string, text: string) {
  return {
    id,
    type: "heading",
    content: { text, level: 2 },
    position: { xPercent: 50, yPercent: 50, origin: "middle-center", offsetX: 0, offsetY: 0 },
    style: {},
    animation: { inEffect: "fade", delayMs: 0, durationMs: 300, easing: "ease-out" },
  };
}

/**
 * `admin-page-editor-roles.spec.ts::col` ile AYNI desen — geçerli, minimal bir `ContainerSettings`,
 * yalnızca boxed yerleşim + özel genişlik/padding parametreleriyle. §9.7-4 "çift gutter" testi
 * için: `layout: "boxed"` + `customWidth` + simetrik `padding` (yatay/dikey AYNI, doğrulamayı
 * basitleştirir).
 */
function boxedContainer(id: string, customWidth: number, paddingPx: number, children: unknown[]) {
  return {
    id,
    type: "container",
    settings: {
      layout: "boxed",
      customWidth,
      direction: "column",
      justifyContent: "start",
      alignItems: "stretch",
      gap: 16,
      padding: { top: paddingPx, right: paddingPx, bottom: paddingPx, left: paddingPx },
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
      background: { type: "none" },
    },
    children,
  };
}

test.describe("Gelişmiş Slider — page-builder entegrasyonu + public render", () => {
  test("10) Sayfa düzenleyicide 'Gelişmiş Slider' bloğu ekle → slider seç → yayınla → public sayfada slaytlar görünüyor", async () => {
    const slider = await createSlider(adminToken, { name: uniqueName("QA PageBuilder Slider") });
    await createSlide(adminToken, slider.id, { layers: [headingLayer("qa-pb-heading", "Page Builder Slider Basligi")] });

    const hostPage = await createPageFixture(adminToken, {
      title: uniqueName("QA Slider PageBuilder Page"),
      slug: uniqueSlug("qa-slider-pb"),
      html: "<p>baslangic fixture icerigi</p>",
      status: "PUBLISHED",
    });

    try {
      await adminPage.goto(`/admin/pages/${hostPage.id as string}`);
      await expect(adminPage.getByRole("heading", { name: "İçerik blokları" })).toBeVisible({ timeout: 15_000 });
      await adminPage.waitForTimeout(500); // bkz. `admin-page-builder-marketing.spec.ts`teki AYNI güvenlik payı notu

      await expect(adminPage.locator('button[aria-label^="Sürükle: "]')).toHaveCount(2); // konteyner + varsayılan metin bloğu
      await adminPage.locator('button[aria-label="Konteyneri sil"]').first().click();
      await expect(adminPage.locator('button[aria-label^="Sürükle: "]')).toHaveCount(0);

      await adminPage.getByRole("button", { name: "Yeni Konteyner Ekle" }).click();
      await adminPage.getByRole("button", { name: "Tek Sütun" }).click();
      await adminPage.getByRole("button", { name: "Konteynere blok ekle" }).click();
      await adminPage.getByRole("tab", { name: "Pazarlama & Sosyal Kanıt" }).click();
      await adminPage.getByRole("menuitem", { name: "Gelişmiş Slider", exact: true }).click();

      const sliderSelect = adminPage.getByLabel("Slider seç");
      await expect(sliderSelect).toBeVisible();
      await sliderSelect.selectOption(slider.id);
      await expect(sliderSelect).toHaveValue(slider.id);

      await adminPage.getByRole("button", { name: "Kaydet", exact: true }).click();
      await expect(adminPage.getByText("Sayfa kaydedildi.").last()).toBeVisible({ timeout: 10_000 });

      const publicContext = await adminPage.context().browser()!.newContext();
      const publicPage = await publicContext.newPage();
      try {
        await publicPage.goto(`${FRONTEND_URL}/${hostPage.slug as string}`);
        await expect(publicPage.getByRole("heading", { name: "Page Builder Slider Basligi" })).toBeVisible({ timeout: 15_000 });
        await expect(publicPage.locator(".advanced-slider")).toHaveCount(1);
      } finally {
        await publicContext.close();
      }
    } finally {
      await deletePagePermanently(adminToken, hostPage.id as string);
      await cleanupSlider(adminToken, slider.id);
    }
  });

  test("11) sliderId seçilmemiş blok → public sayfada hiçbir şey render edilmiyor, hata yok", async ({ page }) => {
    const markerText = `QA marker ${Date.now()}`;
    const hostPage = await createPageWithBlocks(adminToken, {
      title: uniqueName("QA Slider No Selection Page"),
      slug: uniqueSlug("qa-slider-noselect"),
      status: "PUBLISHED",
      blocks: [
        { id: "qa-marker-block", type: "text", data: { html: `<p>${markerText}</p>` } },
        { id: "qa-empty-slider-block", type: "advanced-slider", data: {} },
      ],
    });

    try {
      const res = await page.goto(`${FRONTEND_URL}/${hostPage.slug as string}`);
      expect(res?.status()).toBe(200);
      await expect(page.getByText(markerText)).toBeVisible({ timeout: 15_000 });
      await expect(page.locator(".advanced-slider")).toHaveCount(0);
    } finally {
      await deletePagePermanently(adminToken, hostPage.id as string);
    }
  });

  test("12) Slider'ı sil (force) → public sayfa hâlâ 200 dönüyor, blok sessizce boş", async ({ page }) => {
    const slider = await createSlider(adminToken, { name: uniqueName("QA Deleted Slider") });
    const distinctiveText = `QA Silinen Slider Basligi ${Date.now()}`;
    await createSlide(adminToken, slider.id, { layers: [headingLayer("qa-deleted-heading", distinctiveText)] });

    const markerText = `QA marker deleted ${Date.now()}`;
    const hostPage = await createPageWithBlocks(adminToken, {
      title: uniqueName("QA Slider Deleted Ref Page"),
      slug: uniqueSlug("qa-slider-deletedref"),
      status: "PUBLISHED",
      blocks: [
        { id: "qa-marker-block-2", type: "text", data: { html: `<p>${markerText}</p>` } },
        { id: "qa-deleted-ref-block", type: "advanced-slider", data: { sliderId: slider.id } },
      ],
    });

    try {
      // Kullanımda olduğu için `force=true` GEREKİR (§4.3 referans koruması).
      const del = await deleteSliderRaw(adminToken, slider.id, true);
      expect(del.status).toBe(204);

      const res = await page.goto(`${FRONTEND_URL}/${hostPage.slug as string}`);
      expect(res?.status()).toBe(200);
      await expect(page.getByText(markerText)).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText(distinctiveText)).not.toBeVisible();
      await expect(page.locator(".advanced-slider")).toHaveCount(0);
    } finally {
      await deletePagePermanently(adminToken, hostPage.id as string);
      await cleanupSlider(adminToken, slider.id);
    }
  });

  test("13) Sıfır CLS — dış kutunun yüksekliği hidrasyon ÖNCESİ/SONRASI aynı; aspect-ratio modunda oran korunuyor", async ({ browser }) => {
    // Varsayılan `heightMode: aspect-ratio`, `aspectRatioWidth/Height: 16/9` (Prisma varsayılanı) —
    // §5.2 architect: dış kutunun yüksekliği SUNUCU HTML'İNDE satır içi stille belirlidir.
    const slider = await createSlider(adminToken, { name: uniqueName("QA CLS Slider") });
    await createSlide(adminToken, slider.id, { layers: [] });

    const hostPage = await createPageWithBlocks(adminToken, {
      title: uniqueName("QA Slider CLS Page"),
      slug: uniqueSlug("qa-slider-cls"),
      status: "PUBLISHED",
      blocks: [{ id: "qa-cls-block", type: "advanced-slider", data: { sliderId: slider.id } }],
    });

    try {
      const url = `${FRONTEND_URL}/${hostPage.slug as string}`;
      const viewport = { width: 1280, height: 900 };

      // (a) Ham SSR HTML'i (`aspect-ratio` satır içi stili sunucu tarafında zaten hesaplı mı?).
      const html = await (await fetch(url)).text();
      expect(html).toMatch(/aspect-ratio:\s*16\s*\/\s*9/);
      // `100vh` KULLANILMAMALI (§5.2 madde 2) — bu slider'ın kendi kökünde arama.
      const openTagMatch = html.match(/<div[^>]*class="advanced-slider[^"]*"[^>]*>/);
      const styleMatch = openTagMatch?.[0]?.match(/style="([^"]*)"/);
      expect(styleMatch?.[1] ?? "").not.toMatch(/height:\s*100vh/);

      // (b) JS KAPALI (hidrasyon YOK) — SSR'ın kendi yüksekliği.
      const noJsContext = await browser.newContext({ javaScriptEnabled: false, viewport });
      const noJsPage = await noJsContext.newPage();
      const noJsBox = await (async () => {
        await noJsPage.goto(url);
        return noJsPage.locator(".advanced-slider").boundingBox();
      })();
      await noJsContext.close();

      // (c) JS AÇIK, tam hidrasyon SONRASI.
      const jsContext = await browser.newContext({ viewport });
      const jsPage = await jsContext.newPage();
      await jsPage.goto(url);
      await expect(jsPage.locator(".advanced-slider")).toBeVisible({ timeout: 15_000 });
      await jsPage.waitForLoadState("networkidle");
      const jsBox = await jsPage.locator(".advanced-slider").boundingBox();
      await jsContext.close();

      if (!noJsBox || !jsBox) throw new Error("Slider bounding box'ı (JS'siz veya JS'li) alınamadı.");

      // Sıfır CLS kanıtı — hidrasyon öncesi/sonrası yükseklik (pratikte px yuvarlama payı ±1px).
      expect(Math.abs(noJsBox.height - jsBox.height)).toBeLessThan(2);
      // Aspect-ratio modu — 16:9 oranı korunuyor.
      expect(Math.abs(jsBox.width / jsBox.height - 16 / 9)).toBeLessThan(0.05);
    } finally {
      await deletePagePermanently(adminToken, hostPage.id as string);
      await cleanupSlider(adminToken, slider.id);
    }
  });

  test("14) Dokunma/kaydırma — sola/sağa swipe slaytı değiştiriyor; dikey scroll engellenmiyor (fade geçişi — use-pointer-swipe.ts kod yolu)", async ({
    page,
  }) => {
    // §5.1 architect — `transitionEffect: "slide"` iken TRACK framer-motion `drag="x"` ile
    // sürüklenir (tarayıcı varsayılan `touch-action: auto` zaten dikey kaydırmayı engellemez).
    // `fade`/`cube`/`zoom` iken track SÜRÜKLENMEZ, bunun yerine `use-pointer-swipe.ts` devrede
    // olur ve `touch-action: pan-y` AÇIKÇA döner (§5.1 bağlayıcı) — bu test o AÇIK sözleşmeyi
    // (touch-action + swipe eşiği) doğrulamak için `transitionEffect: FADE` kullanır.
    const slider = await createSlider(adminToken, { name: uniqueName("QA Swipe Slider") });
    await updateSlider(adminToken, slider.id, { transitionEffect: "fade" });
    await createSlide(adminToken, slider.id, { order: 0, layers: [headingLayer("qa-swipe-1", "Swipe Slayt Bir")] });
    await createSlide(adminToken, slider.id, { order: 1, layers: [headingLayer("qa-swipe-2", "Swipe Slayt Iki")] });

    const hostPage = await createPageWithBlocks(adminToken, {
      title: uniqueName("QA Slider Swipe Page"),
      slug: uniqueSlug("qa-slider-swipe"),
      status: "PUBLISHED",
      blocks: [{ id: "qa-swipe-block", type: "advanced-slider", data: { sliderId: slider.id } }],
    });

    try {
      await page.goto(`${FRONTEND_URL}/${hostPage.slug as string}`);
      const root = page.locator(".advanced-slider");
      await expect(root).toBeVisible({ timeout: 15_000 });
      await expect(page.getByRole("button", { name: "1. slayta git" })).toHaveAttribute("aria-current", "true");

      // `touch-action: pan-y` — `use-pointer-swipe.ts` `enabled` (transitionEffect !== "slide") dalı.
      const trackWrap = root.locator("div.overflow-hidden").first();
      const touchAction = await trackWrap.evaluate((el) => getComputedStyle(el).touchAction);
      expect(touchAction).toBe("pan-y");

      const box = await root.boundingBox();
      if (!box) throw new Error("Slider bounding box'ı bulunamadı.");
      const centerY = box.y + box.height / 2;
      const startX = box.x + box.width * 0.8;
      const endX = box.x + box.width * 0.2;

      await page.mouse.move(startX, centerY);
      await page.mouse.down();
      await page.mouse.move(endX, centerY);
      await page.mouse.up();

      await expect(page.getByRole("button", { name: "2. slayta git" })).toHaveAttribute("aria-current", "true", { timeout: 5_000 });

      // Sağa swipe — önceki slayta döner.
      await page.mouse.move(endX, centerY);
      await page.mouse.down();
      await page.mouse.move(startX, centerY);
      await page.mouse.up();
      await expect(page.getByRole("button", { name: "1. slayta git" })).toHaveAttribute("aria-current", "true", { timeout: 5_000 });
    } finally {
      await deletePagePermanently(adminToken, hostPage.id as string);
      await cleanupSlider(adminToken, slider.id);
    }
  });

  test("15) A11y — autoplay açıkken duraklat düğmesi DOM'da; ArrowRight slaytı ilerletiyor; pasif slaytlar aria-hidden", async ({ page }) => {
    const slider = await createSlider(adminToken, { name: uniqueName("QA A11y Slider") });
    await createSlide(adminToken, slider.id, { order: 0, layers: [headingLayer("qa-a11y-1", "A11y Slayt Bir")] });
    await createSlide(adminToken, slider.id, { order: 1, layers: [headingLayer("qa-a11y-2", "A11y Slayt Iki")] });

    const hostPage = await createPageWithBlocks(adminToken, {
      title: uniqueName("QA Slider A11y Page"),
      slug: uniqueSlug("qa-slider-a11y"),
      status: "PUBLISHED",
      blocks: [{ id: "qa-a11y-block", type: "advanced-slider", data: { sliderId: slider.id } }],
    });

    try {
      await page.goto(`${FRONTEND_URL}/${hostPage.slug as string}`);
      const root = page.locator('[role="region"][aria-roledescription="carousel"]');
      await expect(root).toBeVisible({ timeout: 15_000 });
      await expect(root).toHaveAttribute("aria-label", slider.name);

      // WCAG 2.2.2 — autoplay AÇIKKEN duraklat/oynat düğmesi HER ZAMAN render edilir.
      const playPauseButton = page.getByRole("button", { name: /Otomatik oynatmayı (duraklat|başlat)/ });
      await expect(playPauseButton).toBeVisible();

      // Slayt yapısı — `role="group"` + `aria-roledescription="slide"` + doğru `aria-label`.
      const slide1 = page.locator('[role="group"][aria-roledescription="slide"][aria-label="1 / 2"]');
      const slide2 = page.locator('[role="group"][aria-roledescription="slide"][aria-label="2 / 2"]');
      await expect(slide1).toHaveAttribute("aria-hidden", "false");
      await expect(slide2).toHaveAttribute("aria-hidden", "true");
      await expect(slide2).toHaveAttribute("inert", "");

      await root.focus();
      await page.keyboard.press("ArrowRight");

      await expect(slide2).toHaveAttribute("aria-hidden", "false");
      await expect(slide1).toHaveAttribute("aria-hidden", "true");
      await expect(slide1).toHaveAttribute("inert", "");

      // Oklar gerçek `<button>` + `aria-label`.
      await expect(page.getByRole("button", { name: "Önceki slayt" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Sonraki slayt" })).toBeVisible();
      // Bullet — `aria-current` doğru slaytta.
      await expect(page.getByRole("button", { name: "2. slayta git" })).toHaveAttribute("aria-current", "true");
    } finally {
      await deletePagePermanently(adminToken, hostPage.id as string);
      await cleanupSlider(adminToken, slider.id);
    }
  });

  test("16) prefers-reduced-motion:reduce — otomatik oynatma çalışmıyor, Ken Burns yok", async ({ browser }) => {
    const media = await uploadTestMedia(adminToken, `qa-slider-kenburns-${Date.now()}.png`);
    const slider = await createSlider(adminToken, { name: uniqueName("QA ReducedMotion Slider") });
    // Geçiş anlık olmalı (test kısa sürede otomatik-ilerlemenin OLMADIĞINI ölçüyor), `intervalMs`
    // testin kendi bekleme süresine göre kısaltılır.
    await updateSlider(adminToken, slider.id, { transitionEffect: "fade", intervalMs: 1500 });
    await createSlide(adminToken, slider.id, {
      order: 0,
      bgType: "image",
      bgMediaId: media.id,
      bgKenBurns: true,
      layers: [headingLayer("qa-rm-1", "Reduced Motion Slayt Bir")],
    });
    await createSlide(adminToken, slider.id, { order: 1, layers: [headingLayer("qa-rm-2", "Reduced Motion Slayt Iki")] });

    const hostPage = await createPageWithBlocks(adminToken, {
      title: uniqueName("QA Slider Reduced Motion Page"),
      slug: uniqueSlug("qa-slider-rm"),
      status: "PUBLISHED",
      blocks: [{ id: "qa-rm-block", type: "advanced-slider", data: { sliderId: slider.id } }],
    });

    const context = await browser.newContext({ reducedMotion: "reduce" });
    try {
      const page = await context.newPage();
      await page.goto(`${FRONTEND_URL}/${hostPage.slug as string}`);
      await expect(page.locator(".advanced-slider")).toBeVisible({ timeout: 15_000 });
      await expect(page.getByRole("button", { name: "1. slayta git" })).toHaveAttribute("aria-current", "true");

      // Ken Burns yok — arka plan görselinin sarmalayıcısında zaman içinde ölçek DEĞİŞMİYOR.
      const bgWrapper = page.locator(".advanced-slider img").first().locator("xpath=ancestor::div[1]");
      const transformAt0 = await bgWrapper.evaluate((el) => getComputedStyle(el).transform);
      await page.waitForTimeout(1000);
      const transformAt1 = await bgWrapper.evaluate((el) => getComputedStyle(el).transform);
      expect(transformAt1).toBe(transformAt0);

      // Otomatik oynatma ÇALIŞMIYOR — `intervalMs` (1500ms) çok aşan bir bekleme sonrası hâlâ 1. slayt.
      await page.waitForTimeout(3_000);
      await expect(page.getByRole("button", { name: "1. slayta git" })).toHaveAttribute("aria-current", "true");
    } finally {
      await context.close();
      await deletePagePermanently(adminToken, hostPage.id as string);
      await cleanupSlider(adminToken, slider.id);
      await deleteTestMedia(adminToken, media.id);
    }
  });

  /**
   * qa-agent — `.claude/architect-scope-advanced-slider.md` §9.7 "Genişlik Modu ve Kısa Kod"
   * eklentisi (2026-08-30). Testler 17-26 bu bölümün public-render taraflı 10 senaryosunu
   * kapsar (§9.7-2, -3, -4, -6 genişlik modu; §9.7-9, -10, -11, -12, -13, -16 kısa kod).
   */
  test.describe("Genişlik Modu (widthMode)", () => {
    test("17) widthMode: boxed slider viewport'tan KÜÇÜK ve ≤1170px; full-width slider viewport'a EŞİT", async ({ page }) => {
      const boxedSlider = await createSlider(adminToken, { name: uniqueName("QA WidthMode Boxed Slider") });
      await updateSlider(adminToken, boxedSlider.id, { widthMode: "boxed" });
      await createSlide(adminToken, boxedSlider.id, { layers: [headingLayer("qa-wm-boxed-heading", "Genislik Modu Kutulu")] });

      const fullSlider = await createSlider(adminToken, { name: uniqueName("QA WidthMode FullWidth Slider") });
      await createSlide(adminToken, fullSlider.id, { layers: [headingLayer("qa-wm-full-heading", "Genislik Modu Tam")] });

      const boxedPage = await createPageWithBlocks(adminToken, {
        title: uniqueName("QA Slider WidthMode Boxed Page"),
        slug: uniqueSlug("qa-slider-widthmode-boxed"),
        status: "PUBLISHED",
        blocks: [{ id: "qa-wm-boxed-block", type: "advanced-slider", data: { sliderId: boxedSlider.id } }],
      });
      const fullPage = await createPageWithBlocks(adminToken, {
        title: uniqueName("QA Slider WidthMode Full Page"),
        slug: uniqueSlug("qa-slider-widthmode-full"),
        status: "PUBLISHED",
        blocks: [{ id: "qa-wm-full-block", type: "advanced-slider", data: { sliderId: fullSlider.id } }],
      });

      try {
        await page.setViewportSize({ width: 1280, height: 900 });

        await page.goto(`${FRONTEND_URL}/${boxedPage.slug as string}`);
        const boxedRoot = page.locator(".advanced-slider");
        await expect(boxedRoot).toBeVisible({ timeout: 15_000 });
        const boxedBox = await boxedRoot.boundingBox();
        const boxedClientWidth = await page.evaluate(() => document.documentElement.clientWidth);
        if (!boxedBox) throw new Error("Boxed slider bounding box'ı bulunamadı.");
        expect(boxedBox.width).toBeLessThan(boxedClientWidth);
        expect(boxedBox.width).toBeLessThanOrEqual(1170);

        await page.goto(`${FRONTEND_URL}/${fullPage.slug as string}`);
        const fullRoot = page.locator(".advanced-slider");
        await expect(fullRoot).toBeVisible({ timeout: 15_000 });
        const fullBox = await fullRoot.boundingBox();
        const fullClientWidth = await page.evaluate(() => document.documentElement.clientWidth);
        if (!fullBox) throw new Error("Full-width slider bounding box'ı bulunamadı.");
        // `clientWidth` scrollbar'ı HARİÇ TUTAR — kenardan kenara sözleşmenin doğru ölçüm noktası.
        expect(Math.abs(fullBox.width - fullClientWidth)).toBeLessThan(2);
      } finally {
        await deletePagePermanently(adminToken, boxedPage.id as string);
        await deletePagePermanently(adminToken, fullPage.id as string);
        await cleanupSlider(adminToken, boxedSlider.id);
        await cleanupSlider(adminToken, fullSlider.id);
      }
    });

    test("18) KRİTİK geriye dönük uyumluluk: widthMode alanına HİÇ dokunulmamış slider, EK SARMALAYICI DOM OLMADAN bugünkü (full-width) genişlikte render ediliyor", async ({
      page,
    }) => {
      // `createSlider` `widthMode` GÖNDERMEZ (Prisma varsayılanı FULL_WIDTH) — bu, migration
      // SONRASI mevcut/eski sliderların davranışını temsil eder (§9.1.4 architect kabul kriteri).
      const slider = await createSlider(adminToken, { name: uniqueName("QA WidthMode Untouched Slider") });
      await createSlide(adminToken, slider.id, { layers: [] });

      const hostPage = await createPageWithBlocks(adminToken, {
        title: uniqueName("QA Slider WidthMode Untouched Page"),
        slug: uniqueSlug("qa-slider-widthmode-untouched"),
        status: "PUBLISHED",
        blocks: [{ id: "qa-wm-untouched-block", type: "advanced-slider", data: { sliderId: slider.id } }],
      });

      try {
        expect((await getSlider(adminToken, slider.id)).widthMode).toBe("full-width");

        await page.setViewportSize({ width: 1280, height: 900 });
        await page.goto(`${FRONTEND_URL}/${hostPage.slug as string}`);
        const root = page.locator(".advanced-slider");
        await expect(root).toBeVisible({ timeout: 15_000 });

        const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
        const box = await root.boundingBox();
        if (!box) throw new Error("Slider bounding box'ı bulunamadı.");
        expect(Math.abs(box.width - clientWidth)).toBeLessThan(2);

        // EK SARMALAYICI DOM YOK (§9.1.4 bağlayıcı) — kök elemanın ebeveyni herhangi bir
        // boxed satır içi `max-width` stili TAŞIMIYOR (boş bir `<div>` bile eklenmedi).
        const parentStyle = await root.evaluate((el) => el.parentElement?.getAttribute("style"));
        expect(parentStyle ?? "").not.toContain("max-width");
      } finally {
        await deletePagePermanently(adminToken, hostPage.id as string);
        await cleanupSlider(adminToken, slider.id);
      }
    });

    test("19) Boxed slider bir 'container' bloğunun İÇİNE konduğunda çift gutter OLUŞMUYOR", async ({ page }) => {
      const slider = await createSlider(adminToken, { name: uniqueName("QA WidthMode InContainer Slider") });
      await updateSlider(adminToken, slider.id, { widthMode: "boxed" });
      await createSlide(adminToken, slider.id, { layers: [] });

      const CONTAINER_WIDTH = 900;
      const CONTAINER_PADDING = 24;
      const hostPage = await createPageWithBlocks(adminToken, {
        title: uniqueName("QA Slider WidthMode InContainer Page"),
        slug: uniqueSlug("qa-slider-widthmode-incontainer"),
        status: "PUBLISHED",
        blocks: [
          boxedContainer("qa-wm-container", CONTAINER_WIDTH, CONTAINER_PADDING, [
            { id: "qa-wm-incontainer-block", type: "advanced-slider", data: { sliderId: slider.id } },
          ]),
        ],
      });

      try {
        await page.setViewportSize({ width: 1280, height: 900 });
        await page.goto(`${FRONTEND_URL}/${hostPage.slug as string}`);
        const root = page.locator(".advanced-slider");
        await expect(root).toBeVisible({ timeout: 15_000 });

        // `chrome: "bare"` (konteyner İÇİ) → boxed widthMode ek bir sarmalayıcı DOM ÜRETMEZ
        // (§9.1.3 matrisi) — slider genişliği konteynerin İÇ genişliğine (dış genişlik -
        // 2×padding) eşit olmalı; konteynerin KENDİ boxed genişliğinden bağımsız bir "çift
        // gutter" (ör. hem konteyner hem sliderın kendi 1170px sarmalayıcısı) OLUŞMAMALI.
        const measurements = await root.evaluate((el) => {
          const sliderRect = el.getBoundingClientRect();
          const containerEl = el.parentElement!;
          const containerRect = containerEl.getBoundingClientRect();
          const containerStyle = containerEl.getAttribute("style") ?? "";
          return { sliderWidth: sliderRect.width, containerWidth: containerRect.width, containerStyle };
        });

        expect(measurements.containerStyle).toMatch(/max-width:\s*900px/);
        const expectedInnerWidth = measurements.containerWidth - 2 * CONTAINER_PADDING;
        expect(Math.abs(measurements.sliderWidth - expectedInnerWidth)).toBeLessThan(2);
      } finally {
        await deletePagePermanently(adminToken, hostPage.id as string);
        await cleanupSlider(adminToken, slider.id);
      }
    });

    test("20) Sıfır CLS boxed modda da korunuyor: hidrasyon öncesi/sonrası dış kutu yüksekliği aynı", async ({ browser }) => {
      const slider = await createSlider(adminToken, { name: uniqueName("QA WidthMode CLS Boxed Slider") });
      await updateSlider(adminToken, slider.id, { widthMode: "boxed" });
      await createSlide(adminToken, slider.id, { layers: [] });

      const hostPage = await createPageWithBlocks(adminToken, {
        title: uniqueName("QA Slider WidthMode CLS Page"),
        slug: uniqueSlug("qa-slider-widthmode-cls"),
        status: "PUBLISHED",
        blocks: [{ id: "qa-wm-cls-block", type: "advanced-slider", data: { sliderId: slider.id } }],
      });

      try {
        const url = `${FRONTEND_URL}/${hostPage.slug as string}`;
        const viewport = { width: 1280, height: 900 };

        const html = await (await fetch(url)).text();
        expect(html).toMatch(/aspect-ratio:\s*16\s*\/\s*9/);
        // Boxed sarmalayıcı SUNUCU HTML'İNDE zaten mevcut (hidrasyonu BEKLEMEZ) — §9.1.3 mimar
        // kararı: sarmalayıcı `AdvancedSlider`'ın İÇİNDE render edilir, JS ile SONRADAN eklenmez.
        expect(html).toMatch(/max-width:\s*1170px/);

        const noJsContext = await browser.newContext({ javaScriptEnabled: false, viewport });
        const noJsPage = await noJsContext.newPage();
        const noJsBox = await (async () => {
          await noJsPage.goto(url);
          return noJsPage.locator(".advanced-slider").boundingBox();
        })();
        await noJsContext.close();

        const jsContext = await browser.newContext({ viewport });
        const jsPage = await jsContext.newPage();
        await jsPage.goto(url);
        await expect(jsPage.locator(".advanced-slider")).toBeVisible({ timeout: 15_000 });
        await jsPage.waitForLoadState("networkidle");
        const jsBox = await jsPage.locator(".advanced-slider").boundingBox();
        await jsContext.close();

        if (!noJsBox || !jsBox) throw new Error("Slider bounding box'ı (JS'siz veya JS'li) alınamadı.");

        // Sıfır CLS kanıtı — hidrasyon öncesi/sonrası yükseklik (pratikte px yuvarlama payı ±1px).
        expect(Math.abs(noJsBox.height - jsBox.height)).toBeLessThan(2);
        // Boxed genişlik — viewport (1280) `mx-auto` sarmalayıcı yüzünden 1170'i AŞMIYOR.
        expect(jsBox.width).toBeLessThanOrEqual(1170);
        expect(Math.abs(jsBox.width / jsBox.height - 16 / 9)).toBeLessThan(0.05);
      } finally {
        await deletePagePermanently(adminToken, hostPage.id as string);
        await cleanupSlider(adminToken, slider.id);
      }
    });
  });

  test.describe("Kısa Kod / Embed Mekanizması", () => {
    test("21) Bir sayfaya 'text' bloğu ekle, içine kısa kodu yapıştır, yayınla → public sayfada slider CANLI render ediliyor", async ({
      page,
    }) => {
      const slider = await createSlider(adminToken, { name: uniqueName("QA Shortcode Text Slider") });
      await createSlide(adminToken, slider.id, { order: 0, layers: [headingLayer("qa-sc-text-1", "Kisa Kod Metin Slayt Bir")] });
      await createSlide(adminToken, slider.id, { order: 1, layers: [headingLayer("qa-sc-text-2", "Kisa Kod Metin Slayt Iki")] });

      const hostPage = await createPageWithBlocks(adminToken, {
        title: uniqueName("QA Slider Shortcode Text Page"),
        slug: uniqueSlug("qa-slider-shortcode-text"),
        status: "PUBLISHED",
        blocks: [
          {
            id: "qa-sc-text-block",
            type: "text",
            data: { html: `<p>Once metin ${buildSliderShortcode(slider.id)} sonra metin</p>` },
          },
        ],
      });

      try {
        await page.goto(`${FRONTEND_URL}/${hostPage.slug as string}`);
        await expect(page.getByText("Once metin")).toBeVisible({ timeout: 15_000 });
        await expect(page.getByText("sonra metin")).toBeVisible();

        const root = page.locator(".advanced-slider");
        await expect(root).toHaveCount(1);
        await expect(root.getByText("Kisa Kod Metin Slayt Bir")).toBeVisible();

        // Oklar TIKLANABİLİR (2 slayt olduğu için render edilirler) — kısa kod render'ı GERÇEK
        // `AdvancedSlider` motorunu kullanır, statik bir görüntü DEĞİL.
        const nextButton = page.getByRole("button", { name: "Sonraki slayt" });
        await expect(nextButton).toBeVisible();
        await expect(nextButton).toBeEnabled();
        await nextButton.click();
        await expect(page.getByRole("button", { name: "2. slayta git" })).toHaveAttribute("aria-current", "true", { timeout: 5_000 });
      } finally {
        await deletePagePermanently(adminToken, hostPage.id as string);
        await cleanupSlider(adminToken, slider.id);
      }
    });

    test("22) 'custom-html' bloğunda AYNI davranış", async ({ page }) => {
      const slider = await createSlider(adminToken, { name: uniqueName("QA Shortcode CustomHtml Slider") });
      await createSlide(adminToken, slider.id, { layers: [headingLayer("qa-sc-html-1", "Kisa Kod CustomHtml Slayt")] });

      const hostPage = await createPageWithBlocks(adminToken, {
        title: uniqueName("QA Slider Shortcode CustomHtml Page"),
        slug: uniqueSlug("qa-slider-shortcode-customhtml"),
        status: "PUBLISHED",
        blocks: [
          {
            id: "qa-sc-html-block",
            type: "custom-html",
            data: { html: `<p>Ozel HTML once ${buildSliderShortcode(slider.id)} sonra</p>` },
          },
        ],
      });

      try {
        await page.goto(`${FRONTEND_URL}/${hostPage.slug as string}`);
        await expect(page.getByText("Ozel HTML once")).toBeVisible({ timeout: 15_000 });
        await expect(page.locator(".advanced-slider")).toHaveCount(1);
        await expect(page.getByText("Kisa Kod CustomHtml Slayt")).toBeVisible();
      } finally {
        await deletePagePermanently(adminToken, hostPage.id as string);
        await cleanupSlider(adminToken, slider.id);
      }
    });

    test("23) Blog yazısının içeriğine kısa kod eklenirse blog detay sayfasında slider render ediliyor", async ({ page }) => {
      const slider = await createSlider(adminToken, { name: uniqueName("QA Shortcode Blog Slider") });
      await createSlide(adminToken, slider.id, { layers: [headingLayer("qa-sc-blog-1", "Kisa Kod Blog Slayt")] });

      const post = await createBlogPost(adminToken, { title: uniqueName("QA Shortcode Blog Post"), status: "PUBLISHED" });
      await updateBlogPostContentHtml(adminToken, post.id, `<p>Blog once metin ${buildSliderShortcode(slider.id)} blog sonra metin</p>`);

      try {
        await page.goto(`${FRONTEND_URL}/blog/${post.slug}`);
        await expect(page.getByText("Blog once metin")).toBeVisible({ timeout: 15_000 });
        await expect(page.locator(".advanced-slider")).toHaveCount(1);
        await expect(page.getByText("Kisa Kod Blog Slayt")).toBeVisible();
      } finally {
        await deleteBlogPostPermanently(adminToken, post.id);
        await cleanupSlider(adminToken, slider.id);
      }
    });

    test("24) Var olmayan uuid ile kısa kod → sayfa 200 dönüyor, hiçbir şey render edilmiyor, konsol hatası YOK, ham kısa kod metni GÖRÜNMÜYOR", async ({
      page,
    }) => {
      const nonExistentId = "00000000-0000-4000-8000-000000000000";
      const markerText = `QA marker nonexistent shortcode ${Date.now()}`;
      const hostPage = await createPageWithBlocks(adminToken, {
        title: uniqueName("QA Slider Shortcode NonExistent Page"),
        slug: uniqueSlug("qa-slider-shortcode-nonexistent"),
        status: "PUBLISHED",
        blocks: [
          {
            id: "qa-sc-nonexistent-block",
            type: "text",
            data: { html: `<p>${markerText} ${buildSliderShortcode(nonExistentId)}</p>` },
          },
        ],
      });

      const consoleErrors: string[] = [];
      page.on("console", (msg) => {
        if (msg.type() === "error") consoleErrors.push(msg.text());
      });
      const pageErrors: Error[] = [];
      page.on("pageerror", (err) => pageErrors.push(err));

      try {
        const res = await page.goto(`${FRONTEND_URL}/${hostPage.slug as string}`);
        expect(res?.status()).toBe(200);
        await expect(page.getByText(markerText)).toBeVisible({ timeout: 15_000 });
        await expect(page.locator(".advanced-slider")).toHaveCount(0);
        await expect(page.getByText(nonExistentId)).not.toBeVisible();
        await expect(page.getByText(/\[slider id=/)).not.toBeVisible();
        await page.waitForTimeout(500); // olası gecikmeli hataları/uyarıları yakalamak için güvenlik payı
        expect(consoleErrors).toEqual([]);
        expect(pageErrors).toEqual([]);
      } finally {
        await deletePagePermanently(adminToken, hostPage.id as string);
      }
    });

    test("25) Bozuk kısa kod ([slider id=abc], tırnak yok) → düz metin olarak AYNEN görünüyor (bölme YOK)", async ({ page }) => {
      const brokenShortcode = "[slider id=abc]";
      const hostPage = await createPageWithBlocks(adminToken, {
        title: uniqueName("QA Slider Shortcode Broken Page"),
        slug: uniqueSlug("qa-slider-shortcode-broken"),
        status: "PUBLISHED",
        blocks: [
          {
            id: "qa-sc-broken-block",
            type: "text",
            data: { html: `<p>Bozuk kod burada: ${brokenShortcode} bitti.</p>` },
          },
        ],
      });

      try {
        await page.goto(`${FRONTEND_URL}/${hostPage.slug as string}`);
        await expect(page.getByText(`Bozuk kod burada: ${brokenShortcode} bitti.`)).toBeVisible({ timeout: 15_000 });
        await expect(page.locator(".advanced-slider")).toHaveCount(0);
      } finally {
        await deletePagePermanently(adminToken, hostPage.id as string);
      }
    });

    test("26) Kısa kodla gömülü slider akış İÇİNDE kalıyor: yatay kaydırma çubuğu OLUŞMUYOR", async ({ page }) => {
      const slider = await createSlider(adminToken, { name: uniqueName("QA Shortcode NoScroll Slider") });
      await createSlide(adminToken, slider.id, { layers: [headingLayer("qa-sc-noscroll-1", "Kisa Kod Scroll Testi Slaydi")] });

      const hostPage = await createPageWithBlocks(adminToken, {
        title: uniqueName("QA Slider Shortcode NoScroll Page"),
        slug: uniqueSlug("qa-slider-shortcode-noscroll"),
        status: "PUBLISHED",
        blocks: [
          {
            id: "qa-sc-noscroll-block",
            type: "text",
            data: { html: `<p>Kaydirma testi ${buildSliderShortcode(slider.id)} metni.</p>` },
          },
        ],
      });

      try {
        await page.setViewportSize({ width: 400, height: 800 }); // dar viewport — taşma riskini ARTIRIR
        await page.goto(`${FRONTEND_URL}/${hostPage.slug as string}`);
        await expect(page.locator(".advanced-slider")).toBeVisible({ timeout: 15_000 });

        const noHorizontalScroll = await page.evaluate(
          () => document.documentElement.scrollWidth <= document.documentElement.clientWidth
        );
        expect(noHorizontalScroll).toBe(true);
      } finally {
        await deletePagePermanently(adminToken, hostPage.id as string);
        await cleanupSlider(adminToken, slider.id);
      }
    });
  });
});
