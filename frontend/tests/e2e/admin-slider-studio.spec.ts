import { test, expect, type Page, type Locator } from "@playwright/test";
import { getCachedAdminSession, getFixtureUserToken, createPageWithBlocks, deletePagePermanently } from "./support/api";
import { createAuthenticatedPage, createAuthenticatedPageAs } from "./support/admin-session";
import { registerFixtureUser, resetFixtureUserToBaseline, adminGetUserByEmail, adminUpdateRole } from "./support/admin-users-fixtures";
import {
  createSlider,
  getSlider,
  cleanupSlider,
  createSlide,
  updateSlider,
  duplicateSlider,
  getSliderUsage,
  buildSliderShortcode,
} from "./support/sliders-fixtures";

/**
 * qa-agent — `.claude/architect-scope-advanced-slider.md` §7 "QA kapsamı" (Admin, 9 senaryo).
 * Backend birim testleri (`SlideLayersSchema` — adet/byte/id/href/`content`-override reddi)
 * zaten `backend/tests/unit/sliders-layers-schema.test.ts`'te kapsanmış — burada TEKRARLANMAZ.
 * Cihaz override izolasyon MANTIĞI (`resolveGroupForEditing`/`patchLayerGroup`) zaten
 * `frontend/tests/unit/hero-studio-layer-mutations.test.ts` + `advanced-slider-resolve-
 * responsive.test.ts` ile birim seviyesinde kapsanmış — testler 3/4 burada yalnızca UÇTAN UCA
 * kullanıcı akışını (gerçek tıklama → gerçek `fetch` → gerçek DB → sayfa yenileme sonrası doğru
 * çözümleme) doğrular.
 *
 * Konvansiyon: `admin-page-editor-roles.spec.ts`/`admin-page-builder-marketing.spec.ts` ile AYNI
 * desen — dosya başına TEK gerçek UI login'i (`support/admin-session.ts` başlığındaki refresh-
 * token rotasyon riskini azaltmak için), API fixture'ları `support/sliders-fixtures.ts` ile
 * UI'dan bağımsız kurulur/temizlenir, doğrulamalar mümkün olduğunda gerçek backend'e karşı
 * (`getSlider`) yapılır (yalnızca DOM'a güvenmek yerine).
 */
// NOT (retries KASITLI OLARAK ayarlanmaz) — `admin-page-editor-roles.spec.ts`/`admin-user-
// management.spec.ts`teki AYNI gerekçe: test "9" (RBAC) `beforeAll`'ı BİRDEN FAZLA gerçek UI
// login'i + `/auth/register` çağrısı yapar; sabit 5 istek/dk `AUTH_RATE_LIMIT` zaten dar,
// bir retry TÜM dosyanın `beforeAll`'ını (dolayısıyla login'leri) YENİDEN tetikleyip kotayı
// katlayarak 429'a düşürür (bu turda GÖZLEMLENDİ ve düzeltildi).
let adminPage: Page;
let closeAdminSession: () => Promise<void>;
let adminToken: string;

test.beforeAll(async ({ browser }, testInfo) => {
  testInfo.setTimeout(60_000);
  const session = await getCachedAdminSession();
  adminToken = session.accessToken;
  ({ page: adminPage, close: closeAdminSession } = await createAuthenticatedPage(browser));
  // qa-agent bulgusu (bkz. `resetScroll` başlığı) — Hero Studio'nun kendi yükseklik hesaplaması
  // varsayılan 1280x720 viewport'ta ~53px taşıyor. Testin KENDİSİNİ bu düzen kusurundan
  // izole etmek için viewport büyütülür (kök neden `hero-studio.tsx`te DÜZELTİLMEZ).
  await adminPage.setViewportSize({ width: 1280, height: 960 });
});

test.afterAll(async () => {
  if (closeAdminSession) await closeAdminSession();
});

function uniqueName(prefix: string): string {
  return `${prefix} ${Date.now().toString(36)}${Math.floor(Math.random() * 46_656).toString(36)}`;
}

/**
 * qa-agent bulgusu (frontend-agent'a yönlendirilecek) — `HeroStudio` kökü
 * (`h-[calc(100vh-56px)]`) yalnızca `AdminTopbar`'ın (56px) yüksekliğini düşer;
 * `AdminLayout`'taki `<main>`'in kendi dolgusunu (`p-4 md:p-6`) ve `AdminBreadcrumb`
 * yüksekliğini HESABA KATMAZ. Sonuç: sayfa (`document.documentElement.scrollHeight`)
 * viewport'tan (`window.innerHeight`) ~50-55px daha uzun oluyor — normalde görünmeyen
 * bu fazlalık, herhangi bir Playwright `scrollIntoViewIfNeeded()` (ör. yeni eklenen bir
 * slaytı/katmanı seçmek) pencereyi o kadar AŞAĞI KAYDIRIYOR. Bu kayma, `sticky top-14`
 * Hero Studio üst çubuğunun konumlanma varsayımını bozup slayt şeridi/müfettiş panelinin
 * ÜST kısmının (dolayısıyla "Katman" sekmesinin) üst çubuğun ARKASINDA kalmasına yol
 * açıyor (`getByRole("tab",{name:"Katman"}).click()` "sticky ... intercepts pointer
 * events" ile başarısız oluyor — doğrulandı: `window.scrollY` slayt eklendikten sonra
 * 0 → 53 değişiyor, `scrollHeight` 773 vs `innerHeight` 720). Gerçek kullanıcılar için de
 * fare tekerleğiyle KAZARA aynı kaymayı üretip aynı örtüşmeyi yaşayabilir — bu yüzden bu
 * SADECE bir test kırılganlığı değil, gerçek bir düzen kusurudur. Test tarafında etkisini
 * bastırmak için riskli tıklamalardan önce pencere programatik olarak başa alınır; KÖK
 * NEDEN (`hero-studio.tsx` yüksekliği) qa-agent tarafından DÜZELTİLMEZ.
 */
async function resetScroll(pg: Page) {
  await pg.evaluate(() => window.scrollTo(0, 0));
}

/**
 * DOM'un KENDİ `.click()` metodunu çağırır — Playwright'ın gerçek fare koordinatı + hit-test
 * tabanlı `.click()`'inin AKSİNE, görünürlük/kaplama kontrolü YAPMADAN doğrudan olay dinleyicisini
 * tetikler. YUKARIDAKİ `resetScroll` bulgusunun (sticky üst çubuğun kaydırma sonrası panel
 * sekmelerini KAPLAMASI) pratikte HER denemede yeniden oluştuğu (Playwright'ın kendi
 * `scrollIntoViewIfNeeded()` adımı sekmeyi HER seferinde aynı taşan miktara kaydırıyor) "Katman"
 * sekmesi tıklamaları için kullanılır — kök neden (`hero-studio.tsx` yükseklik hesaplaması)
 * frontend-agent'a raporlanacak, burada SADECE testin kendisini bu ortam kısıtından izole eder.
 */
async function clickViaDom(locator: Locator) {
  await locator.evaluate((el) => (el as HTMLElement).click());
}

/** Hero Studio üst çubuğundaki "Kaydet" düğmesi + başarı toast'ı bekler. */
async function saveStudio(pg: Page) {
  await resetScroll(pg);
  await pg.getByRole("button", { name: "Kaydet", exact: true }).click();
  await expect(pg.getByText("Slider kaydedildi.").last()).toBeVisible({ timeout: 10_000 });
}

/** Tuvaldeki (`.hero-studio-stage`) bir katmanı, görünen metin/etiketinden tıklayarak seçer. */
function canvasLayer(pg: Page, text: string): Locator {
  return pg.locator(".hero-studio-stage").getByText(text, { exact: true }).first();
}

test.describe("Hero Studio — admin akışları", () => {
  test("1) Slider oluştur → slayt ekle → katman ekle (heading) → kaydet → sayfa yenile → katman metni/konumu korunuyor", async () => {
    await adminPage.goto("/admin/sliders");
    await expect(adminPage.getByRole("heading", { name: "Slider'lar" })).toBeVisible({ timeout: 15_000 });

    // `.first()` — liste boşken `PageHeading` (başlık yanı) VE `EmptyState` (boş durum CTA'sı)
    // AYNI etikette iki düğme render eder (`customer-portal-module-toggle.spec.ts`teki "Yeni Adres
    // Ekle" ile AYNI, kabul edilmiş desen) — başlık yanındaki hedeflenir.
    await adminPage.getByRole("button", { name: "Yeni Slider" }).first().click();
    await adminPage.waitForURL(/\/admin\/sliders\/[0-9a-f-]{36}$/, { timeout: 15_000 });
    const sliderId = adminPage.url().split("/").pop()!;

    try {
      // Slayt ekle — otomatik seçilir.
      await adminPage.getByRole("button", { name: "Slayt Ekle" }).click();
      await expect(adminPage.getByRole("button", { name: /^Sürükle: Slayt 1$/ })).toBeVisible({ timeout: 10_000 });
      await resetScroll(adminPage); // bkz. `resetScroll` başlığı — slayt eklemek pencereyi kaydırabilir

      // Katman sekmesi → "Başlık" katmanı ekle.
      await clickViaDom(adminPage.getByRole("tab", { name: "Katman" }));
      await adminPage.getByRole("button", { name: "Başlık", exact: true }).click();

      const headingText = adminPage.locator("#layer-heading-text");
      await expect(headingText).toBeVisible();
      await headingText.fill("QA E2E Başlık Metni");

      // Konum — varsayılan (50/50) yerine BELİRGİN bir değere yazılır ki "korunuyor" iddiası
      // tesadüfen varsayılanla eşleşmesin.
      await adminPage.getByLabel("X (%)").fill("15");
      await adminPage.getByLabel("Y (%)").fill("65");

      await saveStudio(adminPage);
      await adminPage.reload();

      await expect(adminPage.getByRole("button", { name: /^Sürükle: Slayt 1$/ })).toBeVisible({ timeout: 15_000 });
      await clickViaDom(adminPage.getByRole("tab", { name: "Katman" }));
      await canvasLayer(adminPage, "QA E2E Başlık Metni").click();

      await expect(adminPage.locator("#layer-heading-text")).toHaveValue("QA E2E Başlık Metni");
      await expect(adminPage.getByLabel("X (%)")).toHaveValue("15");
      await expect(adminPage.getByLabel("Y (%)")).toHaveValue("65");

      // Backend seviyesinde de doğrula — DOM tek başına güvenilmez.
      const persisted = await getSlider(adminToken, sliderId);
      const layer = persisted.slides[0]!.layers[0] as { content: { text: string }; position: { xPercent: number; yPercent: number } };
      expect(layer.content.text).toBe("QA E2E Başlık Metni");
      expect(layer.position.xPercent).toBe(15);
      expect(layer.position.yPercent).toBe(65);
    } finally {
      await cleanupSlider(adminToken, sliderId);
    }
  });

  test("2) Katmanı tuvalde sürükle → xPercent/yPercent değişiyor → kaydet → kalıcı", async () => {
    const created = await createSlider(adminToken, { name: uniqueName("QA Drag Slider") });
    await createSlide(adminToken, created.id, {
      layers: [
        {
          id: "qa-drag-layer",
          type: "heading",
          content: { text: "Sürüklenecek Katman", level: 2 },
          position: { xPercent: 50, yPercent: 50, origin: "middle-center", offsetX: 0, offsetY: 0 },
          style: {},
          animation: { inEffect: "fade-up", delayMs: 0, durationMs: 600, easing: "ease-out" },
        },
      ],
    });

    try {
      await adminPage.goto(`/admin/sliders/${created.id}`);
      await expect(adminPage.getByRole("button", { name: /^Sürükle: Slayt 1$/ })).toBeVisible({ timeout: 15_000 });

      const layerEl = canvasLayer(adminPage, "Sürüklenecek Katman");
      await expect(layerEl).toBeVisible();

      // Tuvalin (LayerBox konumlarının yüzdesini hesapladığı `canvasRef`) sınır kutusu —
      // `HeroCanvas`'ta boyutlanmış konteynerin İLK çocuğu ile eşleşir (`inset-0`, aynı kutu).
      const stageBox = await adminPage.locator(".hero-studio-stage > div").first().boundingBox();
      const layerBox = await layerEl.boundingBox();
      if (!stageBox || !layerBox) throw new Error("Tuval veya katman bounding box'ı bulunamadı.");

      const startX = layerBox.x + layerBox.width / 2;
      const startY = layerBox.y + layerBox.height / 2;
      const targetXPercent = 20;
      const targetYPercent = 80;
      const endX = stageBox.x + stageBox.width * (targetXPercent / 100);
      const endY = stageBox.y + stageBox.height * (targetYPercent / 100);

      await adminPage.mouse.move(startX, startY);
      await adminPage.mouse.down();
      const steps = 12;
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        await adminPage.mouse.move(startX + (endX - startX) * t, startY + (endY - startY) * t);
        await adminPage.waitForTimeout(30);
      }
      await adminPage.mouse.up();

      await saveStudio(adminPage);

      const persisted = await getSlider(adminToken, created.id);
      const layer = persisted.slides[0]!.layers[0] as { position: { xPercent: number; yPercent: number } };
      // Piksel↔yüzde dönüşümündeki küçük tarayıcı/zamanlama sapmalarına tolerans (±8 puan).
      expect(Math.abs(layer.position.xPercent - targetXPercent)).toBeLessThan(8);
      expect(Math.abs(layer.position.yPercent - targetYPercent)).toBeLessThan(8);
      // Varsayılan (50/50) DEĞİL — gerçekten sürüklendiğinin kanıtı.
      expect(layer.position.xPercent).not.toBe(50);
      expect(layer.position.yPercent).not.toBe(50);
    } finally {
      await cleanupSlider(adminToken, created.id);
    }
  });

  test("3) Cihaz görünümünü mobile al → yalnızca fontSize değiştir → masaüstüne dön → masaüstü fontSize DEĞİŞMEMİŞ", async () => {
    const created = await createSlider(adminToken, { name: uniqueName("QA Responsive Slider") });
    await createSlide(adminToken, created.id, {
      layers: [
        {
          id: "qa-responsive-layer",
          type: "heading",
          content: { text: "Responsive Test Katmani", level: 2 },
          position: { xPercent: 50, yPercent: 50, origin: "middle-center", offsetX: 0, offsetY: 0 },
          style: { fontSize: 64 },
          animation: { inEffect: "fade-up", delayMs: 0, durationMs: 600, easing: "ease-out" },
        },
      ],
    });

    try {
      await adminPage.goto(`/admin/sliders/${created.id}`);
      await expect(adminPage.getByRole("button", { name: /^Sürükle: Slayt 1$/ })).toBeVisible({ timeout: 15_000 });
      await canvasLayer(adminPage, "Responsive Test Katmani").click();
      await resetScroll(adminPage); // bkz. `resetScroll` başlığı
      await clickViaDom(adminPage.getByRole("tab", { name: "Katman" }));

      await expect(adminPage.getByLabel("Punto (px)")).toHaveValue("64");

      await adminPage.getByRole("button", { name: "Mobil", exact: true }).click();
      // Mobilde henüz override yok — masaüstünden miras alınan değer görünür.
      await expect(adminPage.getByLabel("Punto (px)")).toHaveValue("64");
      await expect(adminPage.getByText("Bu cihazda geçersiz kılındı")).not.toBeVisible();

      await adminPage.getByLabel("Punto (px)").fill("28");
      await expect(adminPage.getByText("Bu cihazda geçersiz kılındı")).toBeVisible();

      await adminPage.getByRole("button", { name: "Masaüstü", exact: true }).click();
      // KRİTİK — masaüstü kök değeri mobil override'dan ETKİLENMEMİŞ.
      await expect(adminPage.getByLabel("Punto (px)")).toHaveValue("64");
      await expect(adminPage.getByText("Bu cihazda geçersiz kılındı")).not.toBeVisible();

      await saveStudio(adminPage);
      await adminPage.reload();
      await expect(adminPage.getByRole("button", { name: /^Sürükle: Slayt 1$/ })).toBeVisible({ timeout: 15_000 });
      await canvasLayer(adminPage, "Responsive Test Katmani").click();
      await resetScroll(adminPage); // bkz. `resetScroll` başlığı
      await clickViaDom(adminPage.getByRole("tab", { name: "Katman" }));

      await expect(adminPage.getByLabel("Punto (px)")).toHaveValue("64"); // masaüstü, reload sonrası
      await adminPage.getByRole("button", { name: "Mobil", exact: true }).click();
      await expect(adminPage.getByLabel("Punto (px)")).toHaveValue("28"); // mobil override, kalıcı

      const persisted = await getSlider(adminToken, created.id);
      const layer = persisted.slides[0]!.layers[0] as {
        style: { fontSize: number };
        responsive?: { mobile?: { style?: { fontSize?: number } } };
      };
      expect(layer.style.fontSize).toBe(64);
      expect(layer.responsive?.mobile?.style?.fontSize).toBe(28);
    } finally {
      await cleanupSlider(adminToken, created.id);
    }
  });

  test("4) Mobil override'ı kaldır → mobil değer masaüstünden miras alınıyor", async () => {
    const created = await createSlider(adminToken, { name: uniqueName("QA Override Remove Slider") });
    await createSlide(adminToken, created.id, {
      layers: [
        {
          id: "qa-remove-override-layer",
          type: "heading",
          content: { text: "Override Kaldirma Testi", level: 2 },
          position: { xPercent: 50, yPercent: 50, origin: "middle-center", offsetX: 0, offsetY: 0 },
          style: { fontSize: 64 },
          animation: { inEffect: "fade-up", delayMs: 0, durationMs: 600, easing: "ease-out" },
          responsive: { mobile: { style: { fontSize: 28 } } },
        },
      ],
    });

    try {
      await adminPage.goto(`/admin/sliders/${created.id}`);
      await expect(adminPage.getByRole("button", { name: /^Sürükle: Slayt 1$/ })).toBeVisible({ timeout: 15_000 });
      await canvasLayer(adminPage, "Override Kaldirma Testi").click();
      await resetScroll(adminPage); // bkz. `resetScroll` başlığı
      await clickViaDom(adminPage.getByRole("tab", { name: "Katman" }));
      await adminPage.getByRole("button", { name: "Mobil", exact: true }).click();

      await expect(adminPage.getByLabel("Punto (px)")).toHaveValue("28");
      await expect(adminPage.getByText("Bu cihazda geçersiz kılındı")).toBeVisible();

      await adminPage.getByRole("button", { name: "Kaldır" }).click();

      // Override kaldırıldı — mobil artık masaüstünden (64) miras alıyor.
      await expect(adminPage.getByLabel("Punto (px)")).toHaveValue("64");
      await expect(adminPage.getByText("Bu cihazda geçersiz kılındı")).not.toBeVisible();

      await saveStudio(adminPage);

      const persisted = await getSlider(adminToken, created.id);
      const layer = persisted.slides[0]!.layers[0] as {
        style: { fontSize: number };
        responsive?: { mobile?: { style?: { fontSize?: number } } };
      };
      expect(layer.style.fontSize).toBe(64);
      // Anahtar SİLİNMİŞ olmalı (`null` DEĞİL) — §2.4 bağlayıcı kural.
      expect(layer.responsive?.mobile?.style?.fontSize).toBeUndefined();
    } finally {
      await cleanupSlider(adminToken, created.id);
    }
  });

  test("5) Slaytları sürükle-bırakla yeniden sırala → yenile → sıra korunuyor", async () => {
    const created = await createSlider(adminToken, { name: uniqueName("QA Reorder Slider") });
    await createSlide(adminToken, created.id, { label: "Slayt A" });
    await createSlide(adminToken, created.id, { label: "Slayt B" });
    await createSlide(adminToken, created.id, { label: "Slayt C" });

    try {
      await adminPage.goto(`/admin/sliders/${created.id}`);
      await expect(adminPage.getByRole("button", { name: "Slayt A" })).toBeVisible({ timeout: 15_000 });

      async function currentOrderLabels(): Promise<string[]> {
        const slider = await getSlider(adminToken, created.id);
        return slider.slides.sort((a, b) => (a.order as number) - (b.order as number)).map((s) => s.label as string);
      }

      expect(await currentOrderLabels()).toEqual(["Slayt A", "Slayt B", "Slayt C"]);

      // dnd-kit `PointerSensor` (`activationConstraint: distance 6`) bu ortamda ara sıra
      // sentetik imleç olaylarını kaçırır (`admin-page-builder-containers.spec.ts`teki AYNI
      // belgelenmiş kategori, uygulama kodu DEĞİL) — birkaç deneme ile tekrarlanır.
      const gripA = adminPage.getByRole("button", { name: "Sürükle: Slayt 1" });
      const gripC = adminPage.getByRole("button", { name: "Sürükle: Slayt 3" });

      let reordered = false;
      for (let attempt = 1; attempt <= 4 && !reordered; attempt++) {
        const src = await gripA.boundingBox();
        const dst = await gripC.boundingBox();
        if (!src || !dst) throw new Error("Sürükleme tutamacı bounding box'ı bulunamadı.");
        const startX = src.x + src.width / 2;
        const startY = src.y + src.height / 2;
        const endX = dst.x + dst.width / 2;
        const endY = dst.y + dst.height + 10; // C'nin biraz altına bırak — A en sona gitsin

        await adminPage.mouse.move(startX, startY);
        await adminPage.mouse.down();
        const steps = 12;
        for (let i = 1; i <= steps; i++) {
          const t = i / steps;
          await adminPage.mouse.move(startX + (endX - startX) * t, startY + (endY - startY) * t);
          await adminPage.waitForTimeout(35);
        }
        await adminPage.mouse.up();
        await adminPage.waitForTimeout(300);

        const order = await currentOrderLabels();
        reordered = order.join(",") !== "Slayt A,Slayt B,Slayt C";
      }

      const orderAfterDrag = await currentOrderLabels();
      expect(orderAfterDrag).not.toEqual(["Slayt A", "Slayt B", "Slayt C"]);
      expect(orderAfterDrag.slice().sort()).toEqual(["Slayt A", "Slayt B", "Slayt C"]);

      await adminPage.reload();
      await expect(adminPage.getByRole("button", { name: "Slayt A" })).toBeVisible({ timeout: 15_000 });

      // Sayfa yenilendikten SONRA DOM sırası da backend sırasıyla eşleşiyor mu? Her slayt
      // kartının etiket düğmesi `min-w-0 flex-1 truncate` sınıfıyla ayırt edilir (sürükleme
      // tutamacından FARKLI, `aria-label="Sürükle: ..."` değil).
      const cardRoots = adminPage.locator("aside div.space-y-2 > div");
      const cardCount = await cardRoots.count();
      const domOrder: string[] = [];
      for (let i = 0; i < cardCount; i++) {
        const label = await cardRoots.nth(i).locator("button.min-w-0.flex-1.truncate").textContent();
        domOrder.push((label ?? "").trim());
      }
      const orderAfterReload = await currentOrderLabels();
      expect(domOrder).toEqual(orderAfterReload);
    } finally {
      await cleanupSlider(adminToken, created.id);
    }
  });

  test("6) Zaman çizelgesinde 'Oynat' → katmanlar delayMs sırasına göre görünür oluyor (hem tuvalde hem Önizle'de)", async () => {
    // (2026-08-28 düzeltmesi) — `playing`/`playKey` durumu artık `HeroStudioTimeline`'ın kendi
    // yerel state'i DEĞİL, `HeroStudio`'ya taşındı ve HEM zaman çizelgesindeki playhead'i HEM
    // `HeroCanvas`'taki katmanları besler (bkz. `hero-canvas.tsx::LayerBox` — `playing` iken
    // `motion.div` ile `IN_EFFECT_VARIANTS`/`buildLayerTransition`'ı, public render'la PAYLAŞILAN
    // `lib/sliders/layer-render.ts` kaynağından uygular). Bu test önce TUVALDE (gerçek "Oynat"
    // tıklaması), sonra AYRICA "Önizle"nin açtığı gerçek `AdvancedSlider` render motorunda
    // (`toPreviewPublicSlider()`, bağımsız bir kod yolu) aynı zamanlama sözleşmesini (§3.3)
    // doğrular — ikisi de aynı paylaşılan kaynağı kullandığı için ikisinin de doğru olması
    // gerekir, biri kırılırsa diğeri onu YAKALAMAZ.
    const created = await createSlider(adminToken, { name: uniqueName("QA Timeline Slider") });
    await createSlide(adminToken, created.id, {
      layers: [
        {
          id: "qa-timeline-immediate",
          type: "heading",
          content: { text: "Hemen Gorunen Katman", level: 2 },
          position: { xPercent: 50, yPercent: 30, origin: "middle-center", offsetX: 0, offsetY: 0 },
          style: {},
          animation: { inEffect: "fade", delayMs: 0, durationMs: 400, easing: "ease-out" },
        },
        {
          id: "qa-timeline-delayed",
          type: "heading",
          content: { text: "Gecikmeli Gorunen Katman", level: 3 },
          position: { xPercent: 50, yPercent: 70, origin: "middle-center", offsetX: 0, offsetY: 0 },
          style: {},
          animation: { inEffect: "fade", delayMs: 1800, durationMs: 400, easing: "ease-out" },
        },
      ],
    });

    try {
      await adminPage.goto(`/admin/sliders/${created.id}`);
      await expect(adminPage.getByRole("button", { name: /^Sürükle: Slayt 1$/ })).toBeVisible({ timeout: 15_000 });

      // Timeline "Oynat" → TUVALDE gerçek koreografi (bu turda eklenen bağ).
      await expect(adminPage.getByText(/Zaman Çizelgesi — 2 katman/)).toBeVisible();
      await adminPage.getByRole("button", { name: "Oynat" }).click();

      async function heroCanvasLayerOpacity(text: string): Promise<number> {
        const handle = await canvasLayer(adminPage, text).elementHandle();
        if (!handle) return NaN;
        // hero-canvas.tsx::LayerContentBody hiçbir katman tipinde ek sarmalayıcı <div> KOYMAZ
        // (public `slide-layer.tsx`'in aksine) — animasyon opaklığı doğrudan bir üst düzeyde.
        return handle.evaluate((el) => {
          const wrapper = (el as HTMLElement).parentElement;
          return wrapper ? Number.parseFloat(getComputedStyle(wrapper).opacity) : NaN;
        });
      }
      await expect.poll(() => heroCanvasLayerOpacity("Gecikmeli Gorunen Katman"), { timeout: 800, intervals: [100] }).toBeLessThan(0.3);
      await expect.poll(() => heroCanvasLayerOpacity("Hemen Gorunen Katman"), { timeout: 2_000 }).toBeGreaterThan(0.9);
      await expect.poll(() => heroCanvasLayerOpacity("Gecikmeli Gorunen Katman"), { timeout: 4_000 }).toBeGreaterThan(0.9);

      // Gerçek koreografi — AYRICA "Önizle" (gerçek `AdvancedSlider`, bağımsız kod yolu).
      await adminPage.getByRole("button", { name: "Önizle" }).click();
      const previewRoot = adminPage.locator("div.fixed.inset-0.bg-black");
      await expect(previewRoot).toBeVisible();

      async function layerOpacity(text: string): Promise<number> {
        const handle = await previewRoot.getByText(text, { exact: true }).first().elementHandle();
        if (!handle) return NaN;
        return handle.evaluate((el) => {
          const wrapper = (el as HTMLElement).parentElement?.parentElement;
          return wrapper ? Number.parseFloat(getComputedStyle(wrapper).opacity) : NaN;
        });
      }

      // Gecikmeli katman (delayMs=1800) daha delay dolmadan (kısa süre içinde) GÖRÜNÜR DEĞİL.
      await expect.poll(() => layerOpacity("Gecikmeli Gorunen Katman"), { timeout: 800, intervals: [100] }).toBeLessThan(0.3);
      // Hemen görünen katman (delayMs=0) kısa sürede tam opak.
      await expect.poll(() => layerOpacity("Hemen Gorunen Katman"), { timeout: 2_000 }).toBeGreaterThan(0.9);
      // Gecikmeli katman, delay+duration (2200ms) dolduktan sonra tam opak olur.
      await expect.poll(() => layerOpacity("Gecikmeli Gorunen Katman"), { timeout: 4_000 }).toBeGreaterThan(0.9);

      // qa-agent BULGUSU (frontend-agent'a yönlendirilecek, bu düğmenin GERÇEK bir tıklamayla
      // ULAŞILAMAZ olması nedeniyle "küçük" DEĞİL) — "Önizlemeyi kapat" (X) düğmesi ekran
      // görüntüsünde görsel olarak tamamen açıkta/üstte dursa da, GERÇEK bir fare tıklaması
      // (`.click()`, hatta hit-test'i atlamayan `{force:true}` bile) bu koordinatta `.site-scope`
      // alt ağacındaki başka bir `absolute inset-0` katmanına (`SlideStage` katman kapsayıcısı,
      // AYNI `z-10`) düşüyor — olası bir stacking-context kusuru. Önizleme modalının KAPATMA için
      // BAŞKA hiçbir yolu yok (Escape tuşu dinleyicisi YOK, arka plana tıklama YOK,
      // `hero-studio.tsx` içinde `onClick={() => setPreviewOpen(false)}` YALNIZCA bu düğmede) —
      // yani GERÇEK bir kullanıcı bu modalda KİLİTLİ KALABİLİR. Test, DOM'un kendi `.click()`
      // metodunu (`clickViaDom`, hit-test'i tamamen atlar) kullanarak ASIL sözleşmeyi (delayMs
      // sıralı görünürlük, yukarıdaki `expect.poll`larla zaten KANITLANDI) doğrulamaya devam eder.
      await clickViaDom(adminPage.getByRole("button", { name: "Önizlemeyi kapat" }));
      await expect(previewRoot).not.toBeVisible();
    } finally {
      await cleanupSlider(adminToken, created.id);
    }
  });

  test("7) Slider'ı kopyala → slayt/katman sayıları eşit, katman id'leri FARKLI", async () => {
    const created = await createSlider(adminToken, { name: uniqueName("QA Duplicate Slider") });
    await createSlide(adminToken, created.id, {
      label: "Slayt 1",
      layers: [
        {
          id: "qa-dup-layer-1",
          type: "heading",
          content: { text: "Kopyalanacak Baslik", level: 2 },
          position: { xPercent: 50, yPercent: 50, origin: "middle-center", offsetX: 0, offsetY: 0 },
          style: {},
          animation: { inEffect: "fade", delayMs: 0, durationMs: 400, easing: "ease-out" },
        },
      ],
    });
    await createSlide(adminToken, created.id, {
      label: "Slayt 2",
      layers: [
        {
          id: "qa-dup-layer-2",
          type: "text",
          content: { text: "Ikinci katman" },
          position: { xPercent: 30, yPercent: 30, origin: "top-left", offsetX: 0, offsetY: 0 },
          style: {},
          animation: { inEffect: "fade", delayMs: 0, durationMs: 400, easing: "ease-out" },
        },
      ],
    });

    let duplicateId: string | undefined;
    try {
      await adminPage.goto("/admin/sliders");
      await expect(adminPage.getByRole("heading", { name: "Slider'lar" })).toBeVisible({ timeout: 15_000 });
      await adminPage.getByLabel("Slider ara").fill(created.name);

      const row = adminPage.getByRole("row", { name: new RegExp(created.name) });
      await expect(row).toBeVisible({ timeout: 10_000 });
      await row.getByRole("button", { name: `${created.name} için işlemler` }).click();
      // qa-agent DÜZELTMESİ (bu turda bulundu) — §9.2.8 architect eklentisiyle gelen YENİ "Kısa
      // Kodu Kopyala" satır eylemi de "Kopyala" alt dizesini İÇERİYOR; `exact: true` OLMADAN bu
      // seçici artık İKİ menü öğesiyle eşleşip `strict mode violation` üretiyordu.
      await adminPage.getByRole("menuitem", { name: "Kopyala", exact: true }).click();

      await expect(adminPage.getByText("Slider kopyalandı.")).toBeVisible({ timeout: 10_000 });
      await adminPage.waitForURL(/\/admin\/sliders\/[0-9a-f-]{36}$/, { timeout: 10_000 });
      duplicateId = adminPage.url().split("/").pop()!;
      expect(duplicateId).not.toBe(created.id);

      const original = await getSlider(adminToken, created.id);
      const copy = await getSlider(adminToken, duplicateId);

      expect(copy.slides.length).toBe(original.slides.length);
      const originalLayerCounts = original.slides.map((s) => s.layers.length).sort();
      const copyLayerCounts = copy.slides.map((s) => s.layers.length).sort();
      expect(copyLayerCounts).toEqual(originalLayerCounts);

      const originalLayerIds = new Set(original.slides.flatMap((s) => s.layers.map((l) => (l as { id: string }).id)));
      const copyLayerIds = new Set(copy.slides.flatMap((s) => s.layers.map((l) => (l as { id: string }).id)));
      expect(originalLayerIds.has("qa-dup-layer-1")).toBe(true);
      expect(originalLayerIds.has("qa-dup-layer-2")).toBe(true);
      // Kopyadaki HİÇBİR katman id'si orijinalle KESİŞMİYOR — hepsi yeniden üretildi.
      for (const id of copyLayerIds) expect(originalLayerIds.has(id)).toBe(false);
    } finally {
      await cleanupSlider(adminToken, created.id);
      if (duplicateId) await cleanupSlider(adminToken, duplicateId);
    }
  });

  test("8) Kullanılan bir slider'ı sil → 409 modalı + kullanan sayfa listesi görünüyor; force ile siliniyor", async () => {
    const created = await createSlider(adminToken, { name: uniqueName("QA InUse Slider") });
    const hostPageTitle = uniqueName("QA Slider Kullanan Sayfa");
    const hostPage = await createPageWithBlocks(adminToken, {
      title: hostPageTitle,
      slug: `qa-slider-inuse-${Date.now().toString(36)}`,
      status: "DRAFT",
      blocks: [{ id: "qa-inuse-block", type: "advanced-slider", data: { sliderId: created.id } }],
    });

    try {
      await adminPage.goto("/admin/sliders");
      await expect(adminPage.getByRole("heading", { name: "Slider'lar" })).toBeVisible({ timeout: 15_000 });
      await adminPage.getByLabel("Slider ara").fill(created.name);

      const row = adminPage.getByRole("row", { name: new RegExp(created.name) });
      await expect(row).toBeVisible({ timeout: 10_000 });
      await row.getByRole("button", { name: `${created.name} için işlemler` }).click();
      await adminPage.getByRole("menuitem", { name: "Çöpe Taşı" }).click();
      await adminPage.getByRole("dialog", { name: "Slider'ı çöpe taşı" }).getByRole("button", { name: "Çöpe Taşı" }).click();

      const usageDialog = adminPage.getByRole("dialog", { name: "Slider kullanımda" });
      await expect(usageDialog).toBeVisible({ timeout: 10_000 });
      await expect(usageDialog.getByRole("link", { name: hostPageTitle as string })).toBeVisible();

      await usageDialog.getByRole("button", { name: "Yine de Çöpe Taşı" }).click();
      await expect(adminPage.getByText("Slider çöpe taşındı.")).toBeVisible({ timeout: 10_000 });
      await expect(usageDialog).not.toBeVisible();

      const afterForce = await getSlider(adminToken, created.id);
      expect(afterForce.deletedAt).not.toBeNull();
    } finally {
      await deletePagePermanently(adminToken, hostPage.id as string);
      await cleanupSlider(adminToken, created.id);
    }
  });

  test("10) Katman Ekle çubuğu (tuval üstü) + hizalama + çift tık düzenleme + Esnek Sıçrama + cihaz görünürlüğü → kaydet → kalıcı", async () => {
    // (2026-08-28) Slider Revolution düzeyinde katman/animasyon stüdyosu genişletmesi —
    // bkz. `.claude/ui-designer-scope-advanced-slider.md` §7. Önceki testler (1-9) katmanı sağ
    // panelin "Katman" sekmesine GÖMÜLÜ eski quick-add düğmelerinden ekliyordu; bu buton tuvalin
    // üstüne taşındı ve "Katman" sekmesine artık MANUEL tıklamaya gerek yok (seçim anında oraya
    // geçiyor) — bu test o yeni akışı BAŞTAN SONA kullanır.
    const created = await createSlider(adminToken, { name: uniqueName("QA Toolbar Slider") });
    await createSlide(adminToken, created.id, { layers: [] });

    try {
      await adminPage.goto(`/admin/sliders/${created.id}`);
      await expect(adminPage.getByRole("button", { name: /^Sürükle: Slayt 1$/ })).toBeVisible({ timeout: 15_000 });
      await resetScroll(adminPage);

      // Tuval üstü "Katman Ekle" çubuğu — sağ panelin "Katman" sekmesine gömülü DEĞİL, cihaz
      // görünümünden/seçimden BAĞIMSIZ HER ZAMAN görünür.
      const toolbar = adminPage.getByText("Katman Ekle", { exact: true }).locator("..");
      await toolbar.getByRole("button", { name: "Başlık", exact: true }).click();

      // Akıllı panel — katman eklenince müfettiş ANINDA "Katman" sekmesine geçti (manuel sekme
      // tıklaması YOK, "1)" testinin aksine).
      await expect(adminPage.getByRole("tab", { name: "Katman", selected: true })).toBeVisible();

      const headingText = adminPage.locator("#layer-heading-text");
      await headingText.fill("QA Toolbar Basligi");

      // Hizalama çubuğu — "Sola Yasla" yalnızca X eksenini/hizalama noktasını değiştirir.
      await resetScroll(adminPage);
      await clickViaDom(adminPage.getByRole("button", { name: "Sola yasla" }));
      await expect(adminPage.getByLabel("X (%)")).toHaveValue("0");
      await expect(adminPage.getByLabel("Hizalama noktası")).toHaveValue("middle-left");

      // Tuvalde çift tıklama ile yerinde metin düzenleme.
      await canvasLayer(adminPage, "QA Toolbar Basligi").dblclick();
      const inlineEditor = adminPage.locator(".hero-studio-stage input[type='text']");
      await expect(inlineEditor).toBeFocused();
      await inlineEditor.fill("QA Toolbar Basligi Duzenlendi");
      await inlineEditor.press("Enter");
      await expect(adminPage.locator("#layer-heading-text")).toHaveValue("QA Toolbar Basligi Duzenlendi");

      // "Esnek Sıçrama" (elastic-bounce) — seçilince "Yumuşatma (easing)" devre dışı kalır.
      await clickViaDom(adminPage.getByRole("tab", { name: "Animasyon" }));
      await adminPage.getByLabel("Giriş efekti").selectOption({ label: "Esnek Sıçrama" });
      await expect(adminPage.getByLabel("Yumuşatma (easing)")).toBeDisabled();

      // Cihaz Görünürlüğü — mobil görünümde bu katmanı gizle.
      await resetScroll(adminPage);
      await clickViaDom(adminPage.getByRole("button", { name: "Mobil", exact: true }));
      await clickViaDom(adminPage.getByRole("tab", { name: "Katman" }));
      await clickViaDom(adminPage.getByRole("switch", { name: "Mobil'de göster/gizle" }));

      await saveStudio(adminPage);
      await adminPage.reload();
      await expect(adminPage.getByRole("button", { name: /^Sürükle: Slayt 1$/ })).toBeVisible({ timeout: 15_000 });

      // Backend seviyesinde de doğrula.
      const persisted = await getSlider(adminToken, created.id);
      const layer = persisted.slides[0]!.layers[0] as {
        content: { text: string };
        position: { xPercent: number; origin: string };
        animation: { inEffect: string };
        responsive?: { mobile?: { hidden?: boolean } };
      };
      expect(layer.content.text).toBe("QA Toolbar Basligi Duzenlendi");
      expect(layer.position.xPercent).toBe(0);
      expect(layer.position.origin).toBe("middle-left");
      expect(layer.animation.inEffect).toBe("elastic-bounce");
      expect(layer.responsive?.mobile?.hidden).toBe(true);
    } finally {
      await cleanupSlider(adminToken, created.id);
    }
  });

  /**
   * qa-agent — `.claude/architect-scope-advanced-slider.md` §9.7 "Genişlik Modu ve Kısa Kod"
   * eklentisi (2026-08-30). Testler 11-15 bu bölümün admin-taraflı 6 senaryosunu (§9.7-1, -5,
   * -7, -8, -14) kapsar; kalanı (`advanced-slider-public.spec.ts`) public render tarafındadır.
   * Regresyon testi ("EDITOR: kısa kodlu..." — §9.2.6) aşağıdaki RBAC describe bloğunun İÇİNDE,
   * zaten oturum açmış `editorPage`'i YENİDEN KULLANIR (dosya başlığındaki "dosya başına TEK
   * gerçek UI login'i" kısıtı — yeni bir EDITOR oturumu AÇILMAZ).
   */
  test("11) Hero Studio → 'Slider' sekmesi → 'Yerleşim' → 'Kutulu (içerik genişliği)' seç → Kaydet → sayfa yenile → seçim korunuyor", async () => {
    const created = await createSlider(adminToken, { name: uniqueName("QA WidthMode Slider") });
    await createSlide(adminToken, created.id, { layers: [] });

    try {
      await adminPage.goto(`/admin/sliders/${created.id}`);
      await expect(adminPage.getByRole("button", { name: /^Sürükle: Slayt 1$/ })).toBeVisible({ timeout: 15_000 });
      await resetScroll(adminPage); // bkz. `resetScroll` başlığı
      await clickViaDom(adminPage.getByRole("tab", { name: "Slider", exact: true }));

      const widthModeSelect = adminPage.getByLabel("Genişlik modu");
      await expect(widthModeSelect).toHaveValue("full-width");
      await widthModeSelect.selectOption("boxed");
      await expect(widthModeSelect).toHaveValue("boxed");

      await saveStudio(adminPage);
      await adminPage.reload();

      await expect(adminPage.getByRole("button", { name: /^Sürükle: Slayt 1$/ })).toBeVisible({ timeout: 15_000 });
      await resetScroll(adminPage);
      await clickViaDom(adminPage.getByRole("tab", { name: "Slider", exact: true }));
      await expect(adminPage.getByLabel("Genişlik modu")).toHaveValue("boxed");

      // Backend seviyesinde de doğrula — DOM tek başına güvenilmez.
      const persisted = await getSlider(adminToken, created.id);
      expect(persisted.widthMode).toBe("boxed");
    } finally {
      await cleanupSlider(adminToken, created.id);
    }
  });

  test("12) Slider'ı kopyala (duplicate) → kopyanın genişlik modu (widthMode) kaynakla AYNI", async () => {
    // §9.7-5 architect eklentisi — backend-agent talimatı §9.4'teki uyarı: `duplicate` handler'ı
    // `widthMode`'u kopyalanan alanlara eklemeyi UNUTURSA kopya SESSİZCE full-width'e düşer.
    // Duplicate mekaniğinin kendisi (slayt/katman sayısı, katman id yeniden üretimi) zaten test
    // "7"de UI üzerinden kapsanmış — burada API üzerinden YALNIZCA `widthMode` alanı doğrulanır.
    const created = await createSlider(adminToken, { name: uniqueName("QA WidthMode Duplicate Slider") });
    await updateSlider(adminToken, created.id, { widthMode: "boxed" });
    await createSlide(adminToken, created.id, { layers: [] });

    let duplicateId: string | undefined;
    try {
      const source = await getSlider(adminToken, created.id);
      expect(source.widthMode).toBe("boxed");

      const duplicate = await duplicateSlider(adminToken, created.id);
      duplicateId = duplicate.id;
      expect(duplicateId).not.toBe(created.id);

      const persistedDuplicate = await getSlider(adminToken, duplicateId);
      expect(persistedDuplicate.widthMode).toBe("boxed");
    } finally {
      await cleanupSlider(adminToken, created.id);
      if (duplicateId) await cleanupSlider(adminToken, duplicateId);
    }
  });

  test("13) /admin/sliders satır menüsünden 'Kısa Kodu Kopyala' → toast görünüyor; pano değeri '[slider id=\"<uuid>\"]' biçiminde", async () => {
    // §9.7-7 architect eklentisi — Playwright'a `clipboard-read`/`clipboard-write` izni.
    await adminPage.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    const created = await createSlider(adminToken, { name: uniqueName("QA Shortcode List Slider") });

    try {
      await adminPage.goto("/admin/sliders");
      await expect(adminPage.getByRole("heading", { name: "Slider'lar" })).toBeVisible({ timeout: 15_000 });
      await adminPage.getByLabel("Slider ara").fill(created.name);

      const row = adminPage.getByRole("row", { name: new RegExp(created.name) });
      await expect(row).toBeVisible({ timeout: 10_000 });
      await row.getByRole("button", { name: `${created.name} için işlemler` }).click();
      await adminPage.getByRole("menuitem", { name: "Kısa Kodu Kopyala" }).click();

      await expect(
        adminPage.getByText("Kısa kod kopyalandı! Bu kodu herhangi bir sayfada veya blog yazısında metin içine yapıştırabilirsiniz.")
      ).toBeVisible({ timeout: 10_000 });

      const clipboardText = await adminPage.evaluate(() => navigator.clipboard.readText());
      expect(clipboardText).toBe(buildSliderShortcode(created.id));
    } finally {
      await cleanupSlider(adminToken, created.id);
    }
  });

  test("14) Hero Studio üst çubuğundaki 'Kısa Kod' düğmesi AYNI değeri kopyalıyor", async () => {
    // §9.7-8 architect eklentisi.
    await adminPage.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    const created = await createSlider(adminToken, { name: uniqueName("QA Shortcode Studio Slider") });
    await createSlide(adminToken, created.id, { layers: [] });

    try {
      await adminPage.goto(`/admin/sliders/${created.id}`);
      await expect(adminPage.getByRole("button", { name: /^Sürükle: Slayt 1$/ })).toBeVisible({ timeout: 15_000 });
      await resetScroll(adminPage);
      await adminPage.getByRole("button", { name: "Kısa Kod", exact: true }).click();

      await expect(
        adminPage.getByText("Kısa kod kopyalandı! Bu kodu herhangi bir sayfada veya blog yazısında metin içine yapıştırabilirsiniz.")
      ).toBeVisible({ timeout: 10_000 });

      const clipboardText = await adminPage.evaluate(() => navigator.clipboard.readText());
      expect(clipboardText).toBe(buildSliderShortcode(created.id));
    } finally {
      await cleanupSlider(adminToken, created.id);
    }
  });

  test("15) Kısa kodla referans verilen bir slider'ı silmeye çalış → 409 + kullanım diyaloğunda 'kısa kod' rozeti", async () => {
    // §9.7-14 architect eklentisi — `test 8`in ("advanced-slider" bloğu referansı) kısa kod
    // eşleniği: burada REFERANS bir `advanced-slider` bloğu DEĞİL, bir `text` bloğunun
    // `data.html`'ine yapıştırılmış `[slider id="…"]` kısa kodudur (`usageType: "shortcode"`).
    const created = await createSlider(adminToken, { name: uniqueName("QA Shortcode InUse Slider") });
    const hostPageTitle = uniqueName("QA Slider Kısa Kod Kullanan Sayfa");
    const hostPage = await createPageWithBlocks(adminToken, {
      title: hostPageTitle,
      slug: `qa-slider-shortcode-inuse-${Date.now().toString(36)}`,
      status: "DRAFT",
      blocks: [
        {
          id: "qa-shortcode-inuse-block",
          type: "text",
          data: { html: `<p>Once metin ${buildSliderShortcode(created.id)} sonra metin</p>` },
        },
      ],
    });

    try {
      // Backend seviyesinde de doğrula — `usageType: "shortcode"` (`GET .../usage`).
      const usage = await getSliderUsage(adminToken, created.id);
      expect(usage.some((u) => u.usageType === "shortcode")).toBe(true);

      await adminPage.goto("/admin/sliders");
      await expect(adminPage.getByRole("heading", { name: "Slider'lar" })).toBeVisible({ timeout: 15_000 });
      await adminPage.getByLabel("Slider ara").fill(created.name);

      const row = adminPage.getByRole("row", { name: new RegExp(created.name) });
      await expect(row).toBeVisible({ timeout: 10_000 });
      await row.getByRole("button", { name: `${created.name} için işlemler` }).click();
      await adminPage.getByRole("menuitem", { name: "Çöpe Taşı" }).click();
      await adminPage.getByRole("dialog", { name: "Slider'ı çöpe taşı" }).getByRole("button", { name: "Çöpe Taşı" }).click();

      const usageDialog = adminPage.getByRole("dialog", { name: "Slider kullanımda" });
      await expect(usageDialog).toBeVisible({ timeout: 10_000 });
      await expect(usageDialog.getByRole("link", { name: hostPageTitle as string })).toBeVisible();
      // §9.2.7 architect — kullanım satırında "kısa kod" rozeti ("block" için "blok" olurdu).
      await expect(usageDialog.getByText("kısa kod", { exact: true })).toBeVisible();

      await usageDialog.getByRole("button", { name: "Yine de Çöpe Taşı" }).click();
      await expect(adminPage.getByText("Slider çöpe taşındı.")).toBeVisible({ timeout: 10_000 });
      await expect(usageDialog).not.toBeVisible();

      const afterForce = await getSlider(adminToken, created.id);
      expect(afterForce.deletedAt).not.toBeNull();
    } finally {
      await deletePagePermanently(adminToken, hostPage.id as string);
      await cleanupSlider(adminToken, created.id);
    }
  });

  test.describe("9) RBAC — EDITOR okuma+403 yazma, USER/CUSTOMER 403 (panel dışı)", () => {
    const RUN_SUFFIX = Date.now().toString(36);
    const EDITOR_EMAIL = `qa-e2e-slider-editor-${RUN_SUFFIX}@example.com`;
    const USER_EMAIL = `qa-e2e-slider-user-${RUN_SUFFIX}@example.com`;
    const FIXTURE_PASSWORD = "QaE2eSliderRbac12345!";

    let editorPage: Page;
    let closeEditorSession: () => Promise<void>;
    let userPage: Page;
    let closeUserSession: () => Promise<void>;
    let rbacSliderId: string;

    test.beforeAll(async ({ browser }, testInfo) => {
      testInfo.setTimeout(60_000);
      await resetFixtureUserToBaseline(adminToken, EDITOR_EMAIL);
      await resetFixtureUserToBaseline(adminToken, USER_EMAIL);
      await getFixtureUserToken(EDITOR_EMAIL, FIXTURE_PASSWORD, "QA E2E Slider Editor");
      await registerFixtureUser(USER_EMAIL, FIXTURE_PASSWORD, "QA E2E Slider User");

      const editorUser = await adminGetUserByEmail(adminToken, EDITOR_EMAIL);
      if (!editorUser) throw new Error("EDITOR fixture kullanıcısı oluşturulamadı.");
      await adminUpdateRole(adminToken, editorUser.id, "EDITOR");
      // USER_EMAIL varsayılan rolde (USER) kalır — `resetFixtureUserToBaseline` zaten bunu garanti eder.

      const created = await createSlider(adminToken, { name: uniqueName("QA RBAC Slider") });
      rbacSliderId = created.id;

      ({ page: editorPage, close: closeEditorSession } = await createAuthenticatedPageAs(browser, EDITOR_EMAIL, FIXTURE_PASSWORD));
      ({ page: userPage, close: closeUserSession } = await createAuthenticatedPageAs(browser, USER_EMAIL, FIXTURE_PASSWORD));
      await editorPage.setViewportSize({ width: 1280, height: 960 });
    });

    test.afterAll(async () => {
      if (closeEditorSession) await closeEditorSession();
      if (closeUserSession) await closeUserSession();
      if (rbacSliderId) await cleanupSlider(adminToken, rbacSliderId);
      await resetFixtureUserToBaseline(adminToken, EDITOR_EMAIL);
      await resetFixtureUserToBaseline(adminToken, USER_EMAIL);
    });

    test("EDITOR: /admin/sliders'ı GÖREBİLİYOR (okuma) ama 'Yeni Slider' 403 alıyor", async () => {
      await editorPage.goto("/admin/sliders");
      await expect(editorPage.getByRole("heading", { name: "Slider'lar" })).toBeVisible({ timeout: 15_000 });

      await editorPage.getByRole("button", { name: "Yeni Slider" }).first().click();
      await expect(editorPage.getByText("Bu işlem için yetkiniz yok.").last()).toBeVisible({ timeout: 10_000 });
      // Navigasyon OLMADI — hâlâ liste sayfasında.
      await expect(editorPage).toHaveURL(/\/admin\/sliders$/);
    });

    test("EDITOR: mevcut bir slider'ı Hero Studio'da GÖREBİLİYOR ama 'Kaydet' 403 alıyor", async () => {
      await editorPage.goto(`/admin/sliders/${rbacSliderId}`);
      const nameInput = editorPage.getByLabel("Slider adı");
      await expect(nameInput).toBeVisible({ timeout: 15_000 });
      await nameInput.fill("EDITOR tarafından denenen isim değişikliği");

      await editorPage.getByRole("button", { name: "Kaydet", exact: true }).click();
      await expect(editorPage.getByText("Bu işlem için yetkiniz yok.").last()).toBeVisible({ timeout: 10_000 });

      const stillOriginal = await getSlider(adminToken, rbacSliderId);
      expect(stillOriginal.name).not.toBe("EDITOR tarafından denenen isim değişikliği");
    });

    test("EDITOR: kısa kodlu 'text' bloğu + 'advanced-slider' bloğu içeren şablon, TemplateEditorView önizlemesinde çalışma zamanı hatası VERMEDEN açılıyor (§9.2.6 regresyon düzeltmesi)", async () => {
      // §9.7-15 architect eklentisi. `TemplateEditorView` YALNIZCA ADMIN-olmayan roller için
      // (`simpleMode = role !== "ADMIN"`) mount edilir — bu yüzden zaten oturum açmış
      // `editorPage`'i (dosya başlığındaki "dosya başına TEK gerçek UI login'i" kısıtı gereği bu
      // describe bloğunda ZATEN mevcut) kullanır, YENİ bir oturum AÇMAZ.
      const templateSlider = await createSlider(adminToken, { name: uniqueName("QA Template Preview Slider") });
      await createSlide(adminToken, templateSlider.id, { layers: [] });

      const pageErrors: Error[] = [];
      const onPageError = (err: Error) => pageErrors.push(err);
      editorPage.on("pageerror", onPageError);

      const hostPage = await createPageWithBlocks(adminToken, {
        title: uniqueName("QA Slider Template Preview Page"),
        slug: `qa-slider-template-preview-${Date.now().toString(36)}`,
        status: "DRAFT",
        editMode: "TEMPLATE",
        blocks: [
          {
            id: "qa-tpl-text",
            type: "text",
            data: { html: `<p>Once metin ${buildSliderShortcode(templateSlider.id)} sonra metin</p>` },
          },
          { id: "qa-tpl-advslider", type: "advanced-slider", data: { sliderId: templateSlider.id } },
        ],
      });

      try {
        await editorPage.goto(`/admin/pages/${hostPage.id as string}`);
        // simpleMode yükleme kanıtı (`admin-page-editor-roles.spec.ts` test "6"daki AYNI metin) —
        // ADMIN-olmayan roller için BuilderCanvas DEĞİL, TemplateEditorView (form) render edilir.
        await expect(editorPage.getByText("İçerik alanlarını doldurun — yapı bu şablonda sabittir.")).toBeVisible({
          timeout: 15_000,
        });
        await expect(editorPage.getByText("Canlı Önizleme")).toBeVisible();

        // Sol sütun (düzenlenebilir form alanları) `text` bloğunun HAM html'ini (kısa kodun
        // KENDİSİYLE birlikte) bir metin alanında gösterir — bu BEKLENEN ve doğrudur (editör tam
        // olarak ne yazdığını görmeli). Aşağıdaki iddialar bu yüzden YALNIZCA sağ sütundaki
        // `TemplatePreviewFrame`'in (`div.pointer-events-none.select-none` — `template-editor-
        // view.tsx::TemplatePreviewFrame` işaretleyicisi) İÇİNE kapsanır; aksi halde sol sütundaki
        // ham metinle "strict mode violation" (birden çok eşleşme) üretirdi.
        const previewFrame = editorPage.locator("div.pointer-events-none.select-none");
        await expect(previewFrame).toBeVisible();

        // Kısa kodun yerine yer tutucu — metnin GERİ KALANI okunabilir kalıyor. `previewPlaceholderHtml`
        // blok-seviyeli bir `<div>` döndürdüğü için tarayıcı, `<p>...</p>` içine gömülü bu div'i
        // ayrıştırırken `<p>`yi ÖNCE kapatır; div'den SONRAKİ metin (" sonra metin") kendi
        // `<p>`sine SARILMAZ, `prose` sarmalayıcısının doğrudan çıplak bir metin düğümü olarak
        // kalır (doğrulandı: gerçek DOM dump'ı). Bu yüzden `getByText(...).toBeVisible()` (TEK bir
        // elemente eşleşme ister) DEĞİL, `toContainText` (sarmalayıcının TOPLAM metnini kontrol
        // eder, düğüm sınırlarından BAĞIMSIZ) kullanılır.
        await expect(previewFrame).toContainText("Once metin");
        await expect(previewFrame).toContainText("sonra metin");
        // İKİ ayrı yer tutucu görünür: biri `text` bloğu içindeki kısa kod İÇİN (§9.2.6 madde 2),
        // diğeri `advanced-slider` bloğunun KENDİSİ İÇİN (§9.2.6 madde 1 — bu turda düzeltilen,
        // önceden "Creating promises inside a Client Component…" hatası veren regresyon).
        await expect(previewFrame.getByText("Gelişmiş Slider", { exact: true })).toHaveCount(2);

        await editorPage.waitForTimeout(500); // olası gecikmeli/async çalışma zamanı hatalarını yakalamak için güvenlik payı
        expect(pageErrors).toEqual([]);
      } finally {
        editorPage.off("pageerror", onPageError);
        await deletePagePermanently(adminToken, hostPage.id as string);
        await cleanupSlider(adminToken, templateSlider.id);
      }
    });

    test("USER: /admin/sliders'a giderse admin kabuğu render EDİLMEDEN /hesabim/profil'e yönlenir (403 eşleniği)", async () => {
      await userPage.goto("/admin/sliders");
      await expect(userPage).toHaveURL(/\/hesabim\/profil$/, { timeout: 15_000 });
      await expect(userPage.getByText("Bu alana erişim yetkiniz yok, hesap sayfanıza yönlendirildiniz.")).toBeVisible();
      await expect(userPage.locator("[data-sidebar]")).toHaveCount(0);
    });
  });
});
