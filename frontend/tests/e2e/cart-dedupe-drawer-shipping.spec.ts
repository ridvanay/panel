import { test, expect, type Locator, type Page } from "@playwright/test";
import { getCachedAdminSession } from "./support/api";
import {
  adminCreateProductFull,
  adminCreateProductVariant,
  adminDeleteProductPermanently,
  getShippingSettings,
  patchShippingSettings,
  formatPriceFromCentsTRY,
  type FixtureProduct,
  type ShippingSettingsFixture,
} from "./support/product-variants-fixtures";

/**
 * qa-agent — `.claude/architect-scope-ecommerce-pro-template.md` §9.9 madde 3/5/6 (bağlayıcı E2E
 * kapsam listesi). §1.4'ün KRİTİK regresyon koruması (sepet dedupe) + kargo eşiği + sepet
 * çekmecesi burada, `ecommerce-pro`'DAN BAĞIMSIZ fixture ürünleriyle test edilir (bkz.
 * `product-pdp-variants.spec.ts` başlığındaki AYNI gerekçe).
 *
 * Her test KENDİ kargo ayarı durumunu (`beforeEach` ile `shippingFlatFeeCents: null`'a sıfırlanır)
 * açıkça kurar — paylaşımlı `saas_e2e` DB'de `ecommerce-pro` şablon içe aktarma testinin (ayrı bir
 * dosyada) `SiteSettings.shippingFlatFeeCents`'i KALICI olarak değiştirdiği bilinir (§4.4); dosyalar
 * arası çalıştırma SIRASINA bağımlı kırılganlık üretmemek için bu dosya kendi durumunu ambient
 * state'ten BAĞIMSIZ garanti eder.
 */
test.describe.configure({ mode: "serial" });

const RUN_SUFFIX = Date.now().toString(36);

let adminToken: string;
let originalShipping: ShippingSettingsFixture;

let dedupeSimpleProduct: FixtureProduct;
let dedupeVariantProduct: FixtureProduct;
let drawerProduct: FixtureProduct;
let shippingProduct: FixtureProduct;

const createdProductIds: string[] = [];

test.beforeAll(async () => {
  const session = await getCachedAdminSession();
  adminToken = session.accessToken;
  originalShipping = await getShippingSettings(adminToken);

  dedupeSimpleProduct = await adminCreateProductFull(adminToken, {
    title: `QA Dedupe Basit Ürün ${RUN_SUFFIX}`,
    priceCents: 3000,
    stockQuantity: 20,
  });
  createdProductIds.push(dedupeSimpleProduct.id);

  dedupeVariantProduct = await adminCreateProductFull(adminToken, {
    title: `QA Dedupe Varyasyonlu Ürün ${RUN_SUFFIX}`,
    priceCents: 4000,
    stockQuantity: 0,
    // BUG NOTU (backend-agent'a raporlandı, bkz. `ecommerce-pro-fixtures.ts::deleteKnownProductsSql`
    // başlığı) — `type: "TEXT"` bir eksende `swatchHex` alanı TAMAMEN OMİT edilirse (undefined,
    // `templates/ecommerce-pro.ts`teki "Ölçü" ekseninin YAPTIĞI gibi) `GET .../products*` 500 ile
    // çöküyor. Yazma şeması `swatchHex: null`ı TEXT için AÇIKÇA izin veriyor (yalnızca DOLU bir
    // hex değeri reddediyor) — bu yüzden BURADA bilinçli olarak `swatchHex: null` GÖNDERİLİR
    // (bug'ı BURADA tetiklemeden dedupe senaryosunu test etmek için bilinçli bir atlatma).
    variantOptions: [
      {
        name: "Beden",
        type: "TEXT",
        values: [
          { value: "S", swatchHex: null },
          { value: "L", swatchHex: null },
        ],
      },
    ],
  });
  dedupeVariantProduct = await adminCreateProductVariant(adminToken, dedupeVariantProduct.id, {
    optionValues: { Beden: "S" },
    stockQuantity: 10,
  });
  dedupeVariantProduct = await adminCreateProductVariant(adminToken, dedupeVariantProduct.id, {
    optionValues: { Beden: "L" },
    stockQuantity: 10,
  });
  createdProductIds.push(dedupeVariantProduct.id);

  drawerProduct = await adminCreateProductFull(adminToken, {
    title: `QA Sepet Çekmecesi Ürünü ${RUN_SUFFIX}`,
    priceCents: 4000,
    stockQuantity: 20,
  });
  createdProductIds.push(drawerProduct.id);

  shippingProduct = await adminCreateProductFull(adminToken, {
    title: `QA Kargo Eşiği Ürünü ${RUN_SUFFIX}`,
    priceCents: 6000,
    stockQuantity: 20,
  });
  createdProductIds.push(shippingProduct.id);
});

test.beforeEach(async () => {
  // Bkz. dosya başlığı — her test kendi kargo temeli (`configured: false`) ile başlar.
  await patchShippingSettings(adminToken, { shippingFlatFeeCents: null, freeShippingThresholdCents: null });
});

test.afterAll(async () => {
  await patchShippingSettings(adminToken, originalShipping);
  for (const id of createdProductIds) await adminDeleteProductPermanently(adminToken, id);
});

/** Sepet çekmecesindeki TEK bir satır (row) — `cart-drawer.tsx`teki `flex gap-3` konteyneri,
 *  `başlık` metniyle taranarak. */
function drawerRow(drawer: Locator, title: string): Locator {
  return drawer.locator("div.flex.gap-3").filter({ hasText: title });
}

/**
 * "Ara Toplam"/"Kargo"/"Toplam" özet satırını, TAM eşleşen etiket span'inin (`getByText(...,
 * { exact: true })`) EBEVEYNİ (satırın kendi flex konteyneri) üzerinden bulur. `hasText`
 * SUBSTRING eşleştiği için ("Ara Toplam" içinde "Toplam" da geçer) doğrudan `filter({hasText:
 * "Toplam"})` kullanmak yanlış satırı da eşleştirebilir — bu yardımcı TAM metin eşleşmesiyle
 * bu belirsizliği baştan ortadan kaldırır.
 */
function summaryRow(scope: Locator, exactLabel: string): Locator {
  return scope.getByText(exactLabel, { exact: true }).locator("xpath=..");
}

async function addToCartFromPdp(page: Page, slug: string) {
  await page.goto(`/products/${slug}`);
  await page.getByRole("button", { name: "Sepete ekle" }).click();
}

async function selectVariantAndAdd(page: Page, slug: string, axisValue: string) {
  await page.goto(`/products/${slug}`);
  await page.getByRole("radio", { name: axisValue }).click();
  await page.getByRole("button", { name: "Sepete ekle" }).click();
}

test("madde 3: sepet dedupe — varyasyonsuz aynı ürün iki kez → TEK satır miktar 2; iki farklı varyasyon → İKİ satır", async ({
  page,
}) => {
  const drawer = page.getByRole("dialog", { name: "Sepetiniz" });

  // ---- varyasyonsuz aynı ürünü İKİ KEZ ekle → TEK satır, miktar 2 ----
  await addToCartFromPdp(page, dedupeSimpleProduct.slug);
  await expect(drawer).toBeVisible();
  await expect(drawerRow(drawer, dedupeSimpleProduct.title)).toHaveCount(1);
  await expect(drawerRow(drawer, dedupeSimpleProduct.title).locator('span[aria-live="polite"]')).toHaveText("1");
  await drawer.getByRole("button", { name: "Sepeti kapat" }).click();
  await expect(drawer).not.toBeVisible();

  await addToCartFromPdp(page, dedupeSimpleProduct.slug);
  await expect(drawer).toBeVisible();
  // KRİTİK regresyon (§1.4) — hâlâ TEK satır, miktar 2'ye çıkmış olmalı (İKİNCİ bir satır DEĞİL).
  await expect(drawerRow(drawer, dedupeSimpleProduct.title)).toHaveCount(1);
  await expect(drawerRow(drawer, dedupeSimpleProduct.title).locator('span[aria-live="polite"]')).toHaveText("2");
  await drawer.getByRole("button", { name: "Sepeti kapat" }).click();

  // ---- aynı ürünün İKİ FARKLI varyasyonu → İKİ satır ----
  await selectVariantAndAdd(page, dedupeVariantProduct.slug, "S");
  await expect(drawer).toBeVisible();
  await drawer.getByRole("button", { name: "Sepeti kapat" }).click();
  await expect(drawer).not.toBeVisible();

  await selectVariantAndAdd(page, dedupeVariantProduct.slug, "L");
  await expect(drawer).toBeVisible();

  const variantRows = drawer.locator("div.flex.gap-3").filter({ hasText: dedupeVariantProduct.title });
  await expect(variantRows).toHaveCount(2);
  await expect(drawer.getByText("S", { exact: true })).toBeVisible();
  await expect(drawer.getByText("L", { exact: true })).toBeVisible();
  for (const row of await variantRows.all()) {
    await expect(row.locator('span[aria-live="polite"]')).toHaveText("1");
  }

  // Toplam satır sayısı: 1 (basit ürün, miktar 2) + 2 (iki varyasyon) = 3.
  await expect(drawer.locator("div.flex.gap-3")).toHaveCount(3);
});

test("madde 6: sepete ekleme çekmeceyi açıyor; miktar güncelleme toplamı değiştiriyor", async ({ page }) => {
  const drawer = page.getByRole("dialog", { name: "Sepetiniz" });
  await expect(drawer).not.toBeVisible();

  await addToCartFromPdp(page, drawerProduct.slug);
  await expect(drawer).toBeVisible();

  const row = drawerRow(drawer, drawerProduct.title);
  await expect(row.locator('span[aria-live="polite"]')).toHaveText("1");

  const totalRow = summaryRow(drawer, "Toplam");
  await expect(totalRow.getByText(formatPriceFromCentsTRY(4000), { exact: true })).toBeVisible();

  await row.getByRole("button", { name: "Adedi artır" }).click();
  await expect(row.locator('span[aria-live="polite"]')).toHaveText("2");
  await expect(totalRow.getByText(formatPriceFromCentsTRY(8000), { exact: true })).toBeVisible();
});

test("madde 5a: shippingFlatFeeCents=null iken kargo arayüzü HİÇ görünmüyor (regresyon)", async ({ page }) => {
  await addToCartFromPdp(page, shippingProduct.slug);
  await page.getByRole("dialog", { name: "Sepetiniz" }).getByRole("button", { name: "Sepeti kapat" }).click();

  await page.goto("/cart");
  await expect(page.getByRole("heading", { name: "Sepetim" })).toBeVisible();
  await expect(page.getByText("Kargo", { exact: true })).toHaveCount(0);
  await expect(page.getByText(/Ücretsiz kargoya son/)).toHaveCount(0);
  await expect(page.getByText("Ücretsiz kargo kazandınız!")).toHaveCount(0);
  // Toplam === Ara Toplam (kargo hiç tahsil edilmiyor) — ikisi de subtotal (6.000 kuruş).
  await expect(summaryRow(page.locator("body"), "Ara Toplam").getByText(formatPriceFromCentsTRY(6000), { exact: true })).toBeVisible();
  await expect(summaryRow(page.locator("body"), "Toplam").getByText(formatPriceFromCentsTRY(6000), { exact: true })).toBeVisible();
});

test("madde 5b: kargo eşiği — eşik altı kargo>0 + doğru metin, eşiğe ulaşınca kargo 0 ve toplam=ara toplam", async ({
  page,
}) => {
  await patchShippingSettings(adminToken, { shippingFlatFeeCents: 500, freeShippingThresholdCents: 10000 });

  await addToCartFromPdp(page, shippingProduct.slug);
  await page.getByRole("dialog", { name: "Sepetiniz" }).getByRole("button", { name: "Sepeti kapat" }).click();

  await page.goto("/cart");
  await expect(page.getByRole("heading", { name: "Sepetim" })).toBeVisible();

  // subtotal 6.000 kuruş < eşik (10.000) → kargo 500, kalan 4.000.
  await expect(page.getByText(`Ücretsiz kargoya son ${formatPriceFromCentsTRY(4000)}!`)).toBeVisible();
  await expect(summaryRow(page.locator("body"), "Kargo").getByText(formatPriceFromCentsTRY(500), { exact: true })).toBeVisible();
  await expect(summaryRow(page.locator("body"), "Toplam").getByText(formatPriceFromCentsTRY(6500), { exact: true })).toBeVisible();

  // Miktarı 2'ye çıkar → subtotal 12.000 >= eşik (10.000) → kargo 0, ücretsiz.
  await page.getByRole("button", { name: "Adedi artır" }).click();
  await expect(page.getByText("Ücretsiz kargo kazandınız!")).toBeVisible();
  await expect(summaryRow(page.locator("body"), "Kargo").getByText("Ücretsiz", { exact: true })).toBeVisible();
  await expect(summaryRow(page.locator("body"), "Toplam").getByText(formatPriceFromCentsTRY(12000), { exact: true })).toBeVisible();
});
