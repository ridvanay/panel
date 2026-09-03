import { test, expect } from "@playwright/test";
import { getCachedAdminSession } from "./support/api";
import {
  adminCreateProductFull,
  adminCreateProductVariant,
  adminAddProductDocument,
  adminDeleteProductPermanently,
  uploadTestImageMedia,
  uploadTestPdfMedia,
  deleteTestMedia,
  formatPriceFromCentsTRY,
  type FixtureProduct,
} from "./support/product-variants-fixtures";

/**
 * qa-agent — `.claude/architect-scope-ecommerce-pro-template.md` §9.9 madde 1/2/4 (bağlayıcı E2E
 * kapsam listesi). PDP'nin varyasyon-bağlı davranışı (`ProductPurchasePanel`, §5 "storefront
 * geliştirmesi ≠ şablon") burada, `ecommerce-pro`'DAN BAĞIMSIZ, kendi fixture ürünleriyle test
 * edilir — bkz. `support/product-variants-fixtures.ts` başlığı: şablonun kendi varyasyonlarının
 * HİÇBİRİNde `imageAssetKey` dolu değil, bu yüzden "görsel değişiyor" iddiası şablon verisiyle
 * doğrulanamaz.
 *
 * Gerçek backend + Postgres (`saas_e2e`) + gerçek tarayıcıya karşı — mock YOK. Ürünler
 * `POST /admin/products` (+ `.../variants`, `.../documents`) ile ADMIN token'ıyla kurulur, PDP
 * public/anonim `page` fixture'ıyla (auth GEREKMEZ) ziyaret edilir.
 */
test.describe.configure({ mode: "serial" });

const RUN_SUFFIX = Date.now().toString(36);

let adminToken: string;
let redMedia: { id: string; url: string };
let blueMedia: { id: string; url: string };
let greenMedia: { id: string; url: string };
let coverMedia: { id: string; url: string };
let pdfMedia: { id: string; url: string; filename: string };

let variantProduct: FixtureProduct;
let lowStockProduct: FixtureProduct;
let highStockProduct: FixtureProduct;
let pdfProduct: FixtureProduct;

const createdProductIds: string[] = [];
const createdMediaIds: string[] = [];

test.beforeAll(async () => {
  const session = await getCachedAdminSession();
  adminToken = session.accessToken;

  coverMedia = await uploadTestImageMedia(adminToken, `qa-pdp-cover-${RUN_SUFFIX}.png`);
  redMedia = await uploadTestImageMedia(adminToken, `qa-pdp-red-${RUN_SUFFIX}.png`);
  blueMedia = await uploadTestImageMedia(adminToken, `qa-pdp-blue-${RUN_SUFFIX}.png`);
  greenMedia = await uploadTestImageMedia(adminToken, `qa-pdp-green-${RUN_SUFFIX}.png`);
  createdMediaIds.push(coverMedia.id, redMedia.id, blueMedia.id, greenMedia.id);

  // ---- madde 1: renk seçimi görseli+fiyatı değiştiriyor; stoksuz değer üstü çizili/seçilemez ----
  // Üç değer: Kırmızı (stokta, fiyat MİRAS), Yeşil (stokta, fiyat MUTLAK override — fiyat değişimini
  // kanıtlar), Mavi (STOKSUZ — üstü çizili/tıklanamaz olduğunu kanıtlar).
  variantProduct = await adminCreateProductFull(adminToken, {
    title: `QA PDP Varyasyon Ürünü ${RUN_SUFFIX}`,
    priceCents: 10000, // 100,00 ₺ — "Kırmızı" bunu MİRAS alır (variant.priceCents: null)
    stockQuantity: 0, // varyasyonlu üründe yok sayılır (§1.2)
    coverMediaId: coverMedia.id,
    variantOptions: [
      {
        name: "Renk",
        type: "SWATCH",
        values: [
          { value: "Kırmızı", swatchHex: "#DC2626" },
          { value: "Yeşil", swatchHex: "#16A34A" },
          { value: "Mavi", swatchHex: "#2563EB" },
        ],
      },
    ],
  });
  variantProduct = await adminCreateProductVariant(adminToken, variantProduct.id, {
    optionValues: { Renk: "Kırmızı" },
    priceCents: null, // ürün fiyatını miras al
    stockQuantity: 10,
    mediaId: redMedia.id,
  });
  variantProduct = await adminCreateProductVariant(adminToken, variantProduct.id, {
    optionValues: { Renk: "Yeşil" },
    priceCents: 15000, // 150,00 ₺ — mutlak override
    stockQuantity: 5,
    mediaId: greenMedia.id,
  });
  variantProduct = await adminCreateProductVariant(adminToken, variantProduct.id, {
    optionValues: { Renk: "Mavi" },
    priceCents: null,
    stockQuantity: 0, // stoksuz — swatch üstü çizili/tıklanamaz olmalı
    mediaId: blueMedia.id,
  });
  createdProductIds.push(variantProduct.id);

  // ---- madde 2: düşük stok uyarısı (0 < stok <= 3) ----
  lowStockProduct = await adminCreateProductFull(adminToken, {
    title: `QA PDP Düşük Stok Ürünü ${RUN_SUFFIX}`,
    priceCents: 5000,
    stockQuantity: 2,
    coverMediaId: coverMedia.id,
  });
  createdProductIds.push(lowStockProduct.id);

  highStockProduct = await adminCreateProductFull(adminToken, {
    title: `QA PDP Yüksek Stok Ürünü ${RUN_SUFFIX}`,
    priceCents: 5000,
    stockQuantity: 50,
    coverMediaId: coverMedia.id,
  });
  createdProductIds.push(highStockProduct.id);

  // ---- madde 4: PDF indirme ----
  pdfMedia = await uploadTestPdfMedia(adminToken, `qa-pdp-doc-${RUN_SUFFIX}.pdf`);
  createdMediaIds.push(pdfMedia.id);
  pdfProduct = await adminCreateProductFull(adminToken, {
    title: `QA PDP PDF Ürünü ${RUN_SUFFIX}`,
    priceCents: 5000,
    stockQuantity: 10,
    coverMediaId: coverMedia.id,
  });
  pdfProduct = await adminAddProductDocument(adminToken, pdfProduct.id, pdfMedia.id, "Kullanım Kılavuzu QA");
  createdProductIds.push(pdfProduct.id);
});

test.afterAll(async () => {
  for (const id of createdProductIds) await adminDeleteProductPermanently(adminToken, id);
  for (const id of createdMediaIds) await deleteTestMedia(adminToken, id);
});

test("madde 1: renk seçimi görseli ve fiyatı değiştiriyor; stoksuz varyasyon üstü çizili ve tıklanamaz", async ({ page }) => {
  await page.goto(`/products/${variantProduct.slug}`);
  await expect(page.getByRole("heading", { level: 1, name: variantProduct.title })).toBeVisible();

  const redRadio = page.getByRole("radio", { name: "Kırmızı" });
  const mavRadio = page.getByRole("radio", { name: "Mavi — Stokta yok" });
  await expect(redRadio).toBeVisible();
  await expect(mavRadio).toBeVisible();

  // Stoksuz varyasyon: disabled (tıklanamaz) — "üstü çizili" tasarım kararı `DisabledDiagonalLine`
  // (`product-variant-selector.tsx`) ile birlikte gelir, burada erişilebilirlik sözleşmesi
  // (disabled + "Stokta yok" aria-label) doğrulanır.
  await expect(mavRadio).toBeDisabled();
  await expect(mavRadio).toHaveAttribute("aria-disabled", "true");

  const mainImage = page.locator('button[aria-label="Görseli büyüt"] img');
  // Ana fiyat bloğu — `sticky-add-to-cart-bar.tsx`nin AYNI fiyatı AYRI bir sınıfla ("text-base")
  // tekrar gösterdiği için `getByText` sayfa genelinde İKİ eşleşme buluyordu (strict-mode ihlali);
  // bu yüzden ana panelin KENDİ sınıfına ("text-2xl") sınırlandırılır.
  const mainPrice = page.locator("div.text-2xl.font-semibold.text-foreground");

  // Henüz hiçbir varyasyon seçilmedi — ana görsel ürün kapak görseli.
  await expect(mainImage).toHaveAttribute("src", coverMedia.url);
  await expect(mainPrice).toHaveText(formatPriceFromCentsTRY(10000));

  // "Sepete Ekle" varyasyon seçilmeden PASİF olmalı (design-notes §2).
  await expect(page.getByRole("button", { name: "Sepete ekle" })).toBeDisabled();
  await expect(page.getByText(/Devam etmek için Renk seçin\./)).toBeVisible();

  await redRadio.click();
  await expect(redRadio).toHaveAttribute("aria-checked", "true");
  await expect(mainImage).toHaveAttribute("src", redMedia.url);
  // Kırmızı: priceCents null → ürün fiyatını miras alır — DEĞİŞMEMELİ.
  await expect(mainPrice).toHaveText(formatPriceFromCentsTRY(10000));
  await expect(page.getByRole("button", { name: "Sepete ekle" })).toBeEnabled();

  // Yeşil: priceCents mutlak override (150,00 ₺) + kendi görseli — HEM görsel HEM fiyat değişmeli.
  const greenRadio = page.getByRole("radio", { name: "Yeşil" });
  await greenRadio.click();
  await expect(greenRadio).toHaveAttribute("aria-checked", "true");
  await expect(mainImage).toHaveAttribute("src", greenMedia.url);
  await expect(mainPrice).toHaveText(formatPriceFromCentsTRY(15000));

  // Stoksuz "Mavi"ye TIKLAMA DENEMESİ no-op olmalı (disabled buton) — seçim Yeşil'de kalır.
  await mavRadio.click({ force: true }).catch(() => undefined);
  await expect(greenRadio).toHaveAttribute("aria-checked", "true");
});

test("madde 2: düşük stokta 'Son N ürün!' görünüyor, yüksek stokta görünmüyor", async ({ page }) => {
  await page.goto(`/products/${lowStockProduct.slug}`);
  await expect(page.getByRole("heading", { level: 1, name: lowStockProduct.title })).toBeVisible();
  await expect(page.getByText("Son 2 ürün!", { exact: true })).toBeVisible();

  await page.goto(`/products/${highStockProduct.slug}`);
  await expect(page.getByRole("heading", { level: 1, name: highStockProduct.title })).toBeVisible();
  await expect(page.getByText(/Son \d+ ürün!/)).toHaveCount(0);
});

test("madde 4: PDF döküman kartından indirme — 200 + application/pdf + Content-Disposition: attachment", async ({ page }) => {
  await page.goto(`/products/${pdfProduct.slug}`);
  await expect(page.getByRole("heading", { name: "Teknik Dökümanlar" })).toBeVisible();

  const downloadLink = page.getByRole("link", { name: /Kullanım Kılavuzu QA.*dosyasını indir/ });
  await expect(downloadLink).toBeVisible();
  const href = await downloadLink.getAttribute("href");
  expect(href).toBeTruthy();

  const response = await page.request.get(href!);
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("application/pdf");
  expect(response.headers()["content-disposition"]).toBe("attachment");
});
