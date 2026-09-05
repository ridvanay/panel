import { test, expect, type Page } from "@playwright/test";
import { getCachedAdminSession } from "./support/api";
import {
  adminCreateProductFull,
  adminAddProductImage,
  adminDeleteProductPermanently,
  deleteTestMedia,
  uploadTestImageMedia,
  type FixtureProduct,
  type TestMediaFixture,
} from "./support/product-variants-fixtures";

/**
 * qa-agent — `product-gallery.tsx` (PDP galerisi) kırık-görsel placeholder regresyon/yeni-özellik
 * testi. frontend-agent bu turda (henüz commit edilmemiş) `safe-image.tsx`teki `onError`
 * prop-iletim bug'ını (host-allowlist-DIŞI düz `<img>` dalında sessizce düşüyordu, bkz. dosya
 * diff'i) düzeltti VE `product-gallery.tsx`e `product-card-media.tsx`teki desenle AYNI
 * `failedUrls` state'ini ekledi: bir görsel 404 verirse artık tarayıcının native kırık resim
 * ikonu yerine "Görsel yüklenemedi" (ana görsel) / küçük `ImageIcon` (thumbnail) placeholder'ı
 * gösteriliyor.
 *
 * `product-card-image-fallback.spec.ts` İLE AYNI desen (ağ seviyesinde `page.route` ile SADECE
 * bir medyanın URL'i 404'e zorlanır, gerçek dosya sistemine/backend'e DOKUNULMAZ) — burada PDP
 * galerisine (kapak + ek galeri görseli + thumbnail şeridi) uygulanır. Gerçek backend + Postgres
 * (`saas_e2e`) + gerçek tarayıcıya karşı — mock YOK (bkz. `product-pdp-variants.spec.ts` başlığı,
 * AYNI altyapı).
 */
test.describe.configure({ mode: "serial" });

const RUN_SUFFIX = Date.now().toString(36);

let adminToken: string;
let brokenCoverMedia: TestMediaFixture;
let okGalleryMedia: TestMediaFixture;
let product: FixtureProduct;

const createdProductIds: string[] = [];
const createdMediaIds: string[] = [];

/**
 * `product-card-image-fallback.spec.ts::matchesMediaUrl` İLE BİREBİR AYNI — `SafeImage` host'a
 * göre ya `next/image` proxy'sine (`/_next/image?url=<encodeURIComponent(rawUrl)>&...`) ya da ham
 * `<img src="rawUrl">`'e düşer, ağ seviyesinde eşleşme HER İKİ biçimi de kapsamalı.
 */
function matchesMediaUrl(url: URL, target: string): boolean {
  if (url.href === target) return true;
  return url.searchParams.get("url") === target;
}

/** Ana görsel görüntüleyici (`aria-label="Görseli büyüt"` butonu) — hem `<img>` hem placeholder dalı için ortak sarmalayıcı. */
function mainViewer(page: Page) {
  return page.locator('button[aria-label="Görseli büyüt"]');
}

function thumbnail(page: Page, index: number) {
  return page.locator(`button[aria-label="Görsel ${index}"]`);
}

test.beforeAll(async () => {
  const session = await getCachedAdminSession();
  adminToken = session.accessToken;

  brokenCoverMedia = await uploadTestImageMedia(adminToken, `qa-pdp-fallback-broken-${RUN_SUFFIX}.png`);
  okGalleryMedia = await uploadTestImageMedia(adminToken, `qa-pdp-fallback-ok-${RUN_SUFFIX}.png`);
  createdMediaIds.push(brokenCoverMedia.id, okGalleryMedia.id);

  product = await adminCreateProductFull(adminToken, {
    title: `QA PDP Fallback Ürünü ${RUN_SUFFIX}`,
    priceCents: 8000,
    stockQuantity: 10,
    coverMediaId: brokenCoverMedia.id,
  });
  createdProductIds.push(product.id);
  // `product-purchase-panel.tsx::images` türetimi — kapak İLK sırada, ek galeri görselleri
  // SONRA gelir; bu yüzden `okGalleryMedia` "Görsel 2" thumbnail'i olacak (bkz. `THUMBNAIL`
  // aria-label'ları, `index + 1` tabanlı).
  product = await adminAddProductImage(adminToken, product.id, okGalleryMedia.id);
});

test.afterAll(async () => {
  for (const id of createdProductIds) await adminDeleteProductPermanently(adminToken, id).catch(() => undefined);
  for (const id of createdMediaIds) await deleteTestMedia(adminToken, id).catch(() => undefined);
});

test("Fix 3: PDP'de 404 dönen kapak görseli 'Görsel yüklenemedi' placeholder'ı gösterir, kırık thumbnail TIKLANABİLİR kalır, sağlıklı görsele geçiş normal render eder", async ({
  page,
}) => {
  test.setTimeout(60_000);

  // Yalnızca kapak (`brokenCoverMedia`) ağ seviyesinde 404'e zorlanır — galerideki ikinci görsel
  // (`okGalleryMedia`) GERÇEK backend'den normal şekilde servis edilmeye devam eder.
  await page.route(
    (url) => matchesMediaUrl(url, brokenCoverMedia.url),
    (route) => route.fulfill({ status: 404, contentType: "text/plain", body: "not found" })
  );
  const okImageResponsePromise = page.waitForResponse(
    (res) => matchesMediaUrl(new URL(res.url()), okGalleryMedia.url),
    { timeout: 15_000 }
  );

  await page.goto(`/products/${product.slug}`);
  await expect(page.getByRole("heading", { level: 1, name: product.title })).toBeVisible();

  // Asıl regresyon/yeni-özellik kontrolü — `onError` state güncellemesi ASENKRON, bu yüzden
  // `expect(...).toBeVisible()`'ın otomatik yeniden deneme mekanizması kullanılır, sabit bir
  // `waitForTimeout` YAZILMAZ.
  const viewer = mainViewer(page);
  await expect(viewer.getByText("Görsel yüklenemedi")).toBeVisible();
  await expect(viewer.locator("svg.lucide-image")).toBeVisible();
  // Placeholder render edildikten SONRA `<SafeImage>` (next/image ya da ham `<img>`) DOM'dan
  // TAMAMEN kaldırılmış olmalı — tarayıcının yerel "kırık görsel" ikonuyla kalan bir `<img>`
  // DOM'da KALMAMALI.
  await expect(viewer.locator("img")).toHaveCount(0);

  // Kapağın kendi thumbnail'i ("Görsel 1") AYNI URL'i paylaştığı için o da placeholder gösterir
  // (küçük `ImageIcon`, metinsiz — bkz. `product-gallery.tsx` satır ~152-155) — ama TIKLANABİLİR
  // kalmalı (design kararı, native kırık ikonun aksine buton devre dışı BIRAKILMAZ).
  const brokenThumb = thumbnail(page, 1);
  await expect(brokenThumb.locator("svg.lucide-image")).toBeVisible();
  await expect(brokenThumb.locator("img")).toHaveCount(0);
  await expect(brokenThumb).toBeEnabled();

  // Sağlık kontrolü — müdahale EDİLMEYEN ikinci görsel (galeri) hâlâ normal bir `<img>` render
  // ediyor, placeholder YOK; ağ isteği GERÇEKTEN 200 dönüyor (route'umuz onu YANLIŞLIKLA da
  // engellemedi).
  const okImageResponse = await okImageResponsePromise;
  expect(okImageResponse.status(), "müdahale edilmeyen galeri görselinin isteği 200 dönmeli").toBe(200);
  const okThumb = thumbnail(page, 2);
  await expect(okThumb.locator("svg.lucide-image")).toHaveCount(0);
  await expect(okThumb.locator("img")).toBeVisible();

  // Sağlıklı thumbnail'a geçiş — ana görsel ARTIK placeholder DEĞİL, gerçek `<img>` göstermeli
  // (placeholder durumu `activeUrl`'e ÖZGÜ, kalıcı/global bir "galeri bozuk" bayrağı DEĞİL).
  await okThumb.click();
  await expect(okThumb).toHaveAttribute("aria-current", "true");
  await expect(viewer.getByText("Görsel yüklenemedi")).toHaveCount(0);
  await expect(viewer.locator("img")).toBeVisible();

  // Kırık thumbnail'a GERİ dönüş — placeholder yeniden görünmeli (state kalıcı/doğru şekilde
  // `failedUrls` Set'inden okunuyor, yeniden mount'ta yeniden 404 denemesi GEREKMİYOR).
  await brokenThumb.click();
  await expect(brokenThumb).toHaveAttribute("aria-current", "true");
  await expect(viewer.getByText("Görsel yüklenemedi")).toBeVisible();
});
