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
import { createSlider, cleanupSlider, createSlide, updateSlider, deleteSliderRaw } from "./support/sliders-fixtures";

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
});
