import { test, expect } from "@playwright/test";
import { getCachedAdminSession, getSiteModules, patchSiteModule } from "./support/api";

/**
 * qa-agent — storefront header (`site-header.tsx`) regresyon testi + yeni arama tetikleyici/panel
 * (`header-search.tsx`::`HeaderSearchTrigger`/`HeaderSearchPanel`) uçtan uca doğrulaması.
 *
 * Bağlam: `<nav>` `flex-wrap py-4`'ten `flex-nowrap h-20`'ye geçti — arama kutusu eklenince eski
 * davranış geniş masaüstü genişliklerinde (1920/1440/1280px) CTA/dil seçici/hesap/sepet
 * ikonlarını alt satıra itiyordu. Arama artık nav'ın sağ ikon grubunun İÇİNDEKİ tek bir tetikleyici
 * ikon (`HeaderSearchTrigger`, `aria-label="Ara"`) + tıklanınca `<nav>`in DOĞRUDAN altında açılan
 * tam-genişlik bir panel (`HeaderSearchPanel`, `aria-label="Ürün ara"` input) ikilisi.
 *
 * `productsModuleEnabled` — arama tetikleyicisi/paneli VE sepet ikonu SADECE "products" modülü
 * açıkken render edilir (`site-header.tsx`). Test ortamının ambient durumundan BAĞIMSIZ,
 * deterministik çalışması için `beforeAll`'da açık olduğu GARANTİ edilir, `afterAll`'da ÖNCEKİ
 * durum geri yazılır — `tax-management.spec.ts`/`customer-portal-module-toggle.spec.ts` İLE AYNI
 * baseline+teardown deseni.
 */

let adminToken: string;
let initialProductsModuleEnabled: boolean;

test.beforeAll(async () => {
  const session = await getCachedAdminSession();
  adminToken = session.accessToken;
  const modules = await getSiteModules(adminToken);
  initialProductsModuleEnabled = modules.find((m) => m.key === "products")?.enabled ?? true;
  if (!initialProductsModuleEnabled) await patchSiteModule(adminToken, "products", true);
});

test.afterAll(async () => {
  await patchSiteModule(adminToken, "products", initialProductsModuleEnabled);
});

const DESKTOP_VIEWPORTS = [
  { width: 1920, height: 1080 },
  { width: 1440, height: 900 },
  { width: 1280, height: 800 },
] as const;

/**
 * `h-20` = 80px + `border-b` (1px) — tek satırlık bir header için makul bir üst sınır. Eski
 * `flex-wrap py-4` regresyonu (arama kutusu ikinci satıra taştığında) EN AZ bunun bir hayli
 * üstünde bir yükseklik üretirdi (ikinci satır + `py-4` boşluğu, toplamda ~140px+). Kesin piksel
 * yerine "belirgin şekilde iki satır yüksekliğinde DEĞİL" mantığıyla bir tavan konur.
 */
const SINGLE_ROW_MAX_HEIGHT = 90;
/** Aynı satırda kabul edilebilir dikey tolerans — alt satıra düşme onlarca piksellik bir sıçrama
 * üretir; bu tolerans normal alt-piksel/font-metriği farklarını yutar ama gerçek bir satır
 * atlamasını yakalar. */
const SAME_ROW_Y_TOLERANCE = 20;

for (const viewport of DESKTOP_VIEWPORTS) {
  test(`storefront header ${viewport.width}x${viewport.height} genişlikte tek satırda kalır, hiçbir ikon alt satıra düşmez`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.goto("/");

    const nav = page.locator('nav[aria-label="Site gezinme"]');
    await expect(nav).toBeVisible();
    const navBox = await nav.boundingBox();
    expect(navBox).not.toBeNull();
    expect(navBox!.height).toBeLessThanOrEqual(SINGLE_ROW_MAX_HEIGHT);

    // Sağ ikon grubu — arama tetikleyicisi, dil seçici (birden fazla dil etkinse render edilir,
    // `language-switcher.tsx`), hesap widget'ı (oturumsuz varsayılan `page` fixture'ıyla "Giriş
    // yap") ve sepet ikonu. Hepsi görünür ve AYNI satırda (yakın `y`) olmalı — "hiçbir öğe alt
    // satıra düşmedi" iddiasını doğrudan test eder, sabit piksel varsayımından daha sağlam.
    const searchTrigger = nav.getByRole("button", { name: "Ara", exact: true });
    const languageSwitcher = nav.getByRole("button", { name: "Dil seç" });
    const accountLink = nav.getByRole("link", { name: "Giriş yap" });
    const cartLink = nav.getByLabel(/^Sepet, /);

    await expect(searchTrigger).toBeVisible();
    await expect(accountLink).toBeVisible();
    await expect(cartLink).toBeVisible();

    const candidateYs: number[] = [];
    for (const locator of [searchTrigger, accountLink, cartLink]) {
      const box = await locator.boundingBox();
      expect(box).not.toBeNull();
      candidateYs.push(box!.y);
    }
    // Dil seçici yalnızca birden fazla locale etkinse render edilir (`locales.length <= 1` ise
    // `null` döner) — ortam varsayımından bağımsız kalmak için sadece GERÇEKTEN varsa dahil edilir.
    if (await languageSwitcher.count()) {
      const box = await languageSwitcher.boundingBox();
      if (box) candidateYs.push(box.y);
    }

    const maxY = Math.max(...candidateYs);
    const minY = Math.min(...candidateYs);
    expect(maxY - minY).toBeLessThan(SAME_ROW_Y_TOLERANCE);
  });
}

test.describe("Header arama tetikleyici + panel (HeaderSearchTrigger / HeaderSearchPanel)", () => {
  test("tetikleyiciye tıklayınca panel nav'ın ALTINDA tam genişlikte açılır, input odaklanır; Escape kapatır ve odağı tetikleyiciye döndürür", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");

    const nav = page.locator('nav[aria-label="Site gezinme"]');
    // Tetikleyicinin `aria-label`'ı panel açıkken "Aramayı kapat"a döner (`HeaderSearchTrigger`) —
    // sabit bir locator için HER İKİ etiketi de kabul eden bir regex kullanılır, aksi halde
    // `.click()` sonrası "Ara" adlı öğe artık DOM'da bulunamaz (isim değişti) hatası alınır.
    const trigger = nav.getByRole("button", { name: /^(Ara|Aramayı kapat)$/ });
    await expect(trigger).toBeVisible();
    await expect(trigger).toHaveAttribute("aria-expanded", "false");

    const navBox = await nav.boundingBox();
    expect(navBox).not.toBeNull();

    await trigger.click();
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    await expect(trigger).toHaveAccessibleName("Aramayı kapat");

    const input = page.getByRole("combobox", { name: "Ürün ara" });
    await expect(input).toBeVisible();
    await expect(input).toBeFocused();

    // Panel `<header>`in DOĞRUDAN çocuğu, `<nav>`in sibling'i (`header-search.tsx` başlık notu) —
    // nav'ın ALTINDA, `max-w-5xl`e tabi olmayan tam genişlikte (edge-to-edge) render edilir.
    const panel = page.locator("header > div").filter({ has: input });
    await expect(panel).toBeVisible();

    // `animate-in fade-in-0 slide-in-from-top-2 duration-150` — açılış CSS animasyonu birkaç
    // piksellik bir yukarı-kayma ile başlar (`slide-in-from-top-2`); animasyon TAMAMLANMADAN
    // ölçülen bir `boundingBox()` yanlışlıkla nav'ın altında OLMADIĞI izlenimi verebilir. Sabit bir
    // bekleme yerine (flaky'e açık) animasyon oturana kadar `toPass()` ile POLL edilir.
    await expect(async () => {
      const panelBox = await panel.boundingBox();
      expect(panelBox).not.toBeNull();
      expect(panelBox!.y).toBeGreaterThanOrEqual(navBox!.y + navBox!.height - 1);
    }).toPass({ timeout: 2_000, intervals: [50, 100, 150] });

    const panelBox = await panel.boundingBox();
    expect(panelBox).not.toBeNull();
    expect(panelBox!.width).toBeGreaterThan(navBox!.width);

    await input.press("Escape");
    await expect(input).not.toBeVisible();
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
    await expect(trigger).toBeFocused();
  });
});
