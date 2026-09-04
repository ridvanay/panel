import { test, expect } from "@playwright/test";
import { getCachedAdminSession } from "./support/api";
import {
  adminCreateProductFull,
  adminCreateProductVariant,
  adminDeleteProductPermanently,
  formatPriceFromCentsTRY,
  type FixtureProduct,
} from "./support/product-variants-fixtures";

/**
 * qa-agent — kullanıcının açıkça istediği "sepete ekleme akışı" kapsamı (bkz. görev tanımı madde
 * 4): (a) PDP'de adet seçip Sepete Ekle'ye basınca sepetin SEÇİLEN miktarla güncellenmesi, (b)
 * `/products` listesindeki hızlı-sepete-ekle davranışı — varyasyonsuz ürün DOĞRUDAN eklenir,
 * varyasyonlu ürün "Seçenekleri Gör"e yönlendirir (`.claude/design-notes-products-catalog.md`
 * §3.3). Sepet DEDUPE/çekmece/kargo akışları ZATEN `cart-dedupe-drawer-shipping.spec.ts`'te
 * kapsanıyor — burada TEKRAR EDİLMEZ, yalnızca bu turun YENİ katalog-kartı/adet-seçici yüzeyleri
 * test edilir.
 *
 * Kendi izole fixture ürünleriyle (`product-pdp-variants.spec.ts` İLE AYNI gerekçe) — `?search=`
 * ile sonuçlar TEK ürüne daraltılır, paylaşımlı `saas_e2e` DB'deki başka ürünlerle KARIŞMAZ.
 */
test.describe.configure({ mode: "serial" });

const RUN_SUFFIX = Date.now().toString(36);

let adminToken: string;
let productForQty: FixtureProduct; // varyasyonsuz, PDP adet seçici testi
let productSimple: FixtureProduct; // varyasyonsuz, liste hızlı-ekle testi
let productWithVariant: FixtureProduct; // varyasyonlu, liste "Seçenekleri Gör" testi

const createdProductIds: string[] = [];

function cartBadge(page: import("@playwright/test").Page) {
  return page.getByRole("link", { name: /^Sepet, \d+ ürün/ });
}

test.beforeAll(async () => {
  const session = await getCachedAdminSession();
  adminToken = session.accessToken;

  productForQty = await adminCreateProductFull(adminToken, {
    title: `QA Cart Adet Ürünü ${RUN_SUFFIX}`,
    priceCents: 4000,
    stockQuantity: 20,
  });
  createdProductIds.push(productForQty.id);

  productSimple = await adminCreateProductFull(adminToken, {
    title: `QA Cart Hizli Ekle Ürünü ${RUN_SUFFIX}`,
    priceCents: 3000,
    stockQuantity: 20,
  });
  createdProductIds.push(productSimple.id);

  productWithVariant = await adminCreateProductFull(adminToken, {
    title: `QA Cart Varyasyonlu Ürün ${RUN_SUFFIX}`,
    priceCents: 5000,
    stockQuantity: 0,
    variantOptions: [{ name: "Beden", type: "TEXT", values: [{ value: "M", swatchHex: null }] }],
  });
  productWithVariant = await adminCreateProductVariant(adminToken, productWithVariant.id, {
    optionValues: { Beden: "M" },
    stockQuantity: 20,
  });
  createdProductIds.push(productWithVariant.id);
});

test.afterAll(async () => {
  for (const id of createdProductIds) await adminDeleteProductPermanently(adminToken, id);
});

test("PDP: adet seçici ile miktar artırılıp Sepete Ekle'ye basılınca sepete SEÇİLEN miktar ekleniyor", async ({ page }) => {
  await page.goto(`/products/${productForQty.slug}`);
  await expect(page.getByRole("heading", { level: 1, name: productForQty.title })).toBeVisible();

  // Adet seçici salt stepper (`quantity-selector.tsx`) — 1 → 3, iki kez "Artır". Sepet çekmecesi
  // henüz AÇIK DEĞİL, bu yüzden `aria-live="polite"` locator'ı PDP'deki TEK adet göstergesine
  // (drawer'ınkiyle KARIŞMADAN) işaret eder.
  const increment = page.getByRole("button", { name: "Artır" });
  const qtyDisplay = page.locator('span[aria-live="polite"]');
  await increment.click();
  await increment.click();
  await expect(qtyDisplay).toHaveText("3");

  await page.getByRole("button", { name: "Sepete ekle" }).click();

  const drawer = page.getByRole("dialog", { name: "Sepetiniz" });
  await expect(drawer).toBeVisible();
  const row = drawer.locator("div.flex.gap-3").filter({ hasText: productForQty.title });
  await expect(row).toHaveCount(1);
  // Satırdaki miktar SEÇİLEN 3'ü yansıtmalı — "1" ile eklenip sonradan artırılmış OLMAMALI.
  await expect(row.locator('span[aria-live="polite"]')).toHaveText("3");

  // Çekmece açıkken arka plan (header dahil) `aria-hidden` olur (dialog a11y örüntüsü) — rozeti
  // okumadan ÖNCE çekmece kapatılır.
  await drawer.getByRole("button", { name: "Sepeti kapat" }).click();
  await expect(drawer).not.toBeVisible();

  // Header rozeti de AYNI toplamı (3) göstermeli.
  await expect(cartBadge(page)).toHaveAccessibleName("Sepet, 3 ürün");
});

test("Katalog listesi: varyasyonsuz ürünün hızlı-sepete-ekle butonu DOĞRUDAN sepete ekliyor", async ({ page }) => {
  // Kayan çubuk yalnızca `lg:` hover'a bağlı; `<lg` (dokunmatik) genişlikte HER ZAMAN görünür
  // (`.claude/design-notes-products-catalog.md` §3.3) — hover simülasyonundan bağımsız,
  // deterministik bir test için mobil görünüm genişliği kullanılır.
  await page.setViewportSize({ width: 500, height: 900 });
  await page.goto(`/products?search=${encodeURIComponent(productSimple.title)}`);
  await expect(page.getByRole("heading", { level: 3, name: productSimple.title, exact: true })).toBeVisible();

  const addButton = page.getByRole("button", { name: "Sepete ekle" });
  await addButton.click();

  // NOT: kart üzerindeki hızlı-ekle (`product-card-media.tsx`) PDP'nin AKSİNE `onAdded` PROP'U
  // GEÇMİYOR — çekmece BİLİNÇLİ olarak açılmıyor (liste taramasını kesintiye uğratmama tercihi,
  // `cart-dedupe-drawer-shipping.spec.ts`'in PDP akışından FARKLI). Bu yüzden burada eklemenin
  // GERÇEKTEN gerçekleştiği butonun kendi "Sepete eklendi" onay durumu + header rozeti ÜZERİNDEN
  // doğrulanır — `/cart` sayfasına gidilerek de çapraz kontrol edilir.
  await expect(addButton).toHaveText(/Sepete eklendi/);
  await expect(cartBadge(page)).toHaveAccessibleName("Sepet, 1 ürün");

  await page.goto("/cart");
  await expect(page.getByRole("heading", { name: "Sepetim" })).toBeVisible();
  const row = page.locator("div.flex.flex-wrap.items-center.gap-4").filter({ hasText: productSimple.title });
  await expect(row).toBeVisible();
  await expect(row.getByText(formatPriceFromCentsTRY(3000), { exact: true }).first()).toBeVisible();
});

test("Katalog listesi: varyasyonlu ürünün hızlı-ekle alanı 'Seçenekleri Gör'e dönüşüyor ve PDP'ye yönlendiriyor (sepete DİREKT eklemiyor)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 500, height: 900 });
  await page.goto(`/products?search=${encodeURIComponent(productWithVariant.title)}`);
  await expect(page.getByRole("heading", { level: 3, name: productWithVariant.title, exact: true })).toBeVisible();

  // Varyasyonlu üründe "Sepete Ekle" butonu YOK — yalnızca "Seçenekleri Gör" bağlantısı var.
  await expect(page.getByRole("button", { name: "Sepete ekle" })).toHaveCount(0);
  const optionsLink = page.getByRole("link", { name: /Seçenekleri Gör/ });
  await expect(optionsLink).toBeVisible();

  await optionsLink.click();
  await expect(page).toHaveURL(new RegExp(`/products/${productWithVariant.slug}$`));
  await expect(page.getByRole("heading", { level: 1, name: productWithVariant.title })).toBeVisible();
  // Sepet çekmecesi AÇILMAMALI — yönlendirme bir sepete-ekleme eylemi DEĞİL.
  await expect(page.getByRole("dialog", { name: "Sepetiniz" })).not.toBeVisible();
});
