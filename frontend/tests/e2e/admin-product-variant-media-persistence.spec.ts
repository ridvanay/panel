import { test, expect, type Page, type Browser } from "@playwright/test";
import { getCachedAdminSession } from "./support/api";
import { createAuthenticatedPage } from "./support/admin-session";
import {
  adminCreateProductFull,
  adminCreateProductVariant,
  adminDeleteProductPermanently,
  deleteTestMedia,
  type FixtureProduct,
} from "./support/product-variants-fixtures";

/**
 * qa-agent — Admin `ProductVariantsPanel` (`components/admin/products/product-variants-panel.tsx`)
 * UI'ında "Görsel Seç" → `MediaPicker` → seç → satırın KENDİ "Kaydet" butonu → F5/tam sayfa
 * yeniden yükleme → hâlâ seçili akışının GERÇEK bir tarayıcı üzerinden uçtan uca doğrulaması.
 *
 * Bağlam (görev tanımı madde 3) — bu akış BUGÜNE KADAR yalnızca iki dolaylı yoldan kanıtlanıyordu:
 * (1) backend-agent'ın `backend/tests/integration/products.test.ts`teki `PATCH .../variants/:id`
 * round-trip testleri (API seviyesi, persistans backend'de sağlam — `mediaId` set/null-temizle/
 * geçersiz-id/PDF-mediaId senaryoları), (2) `product-pdp-variants.spec.ts`teki PDP testi (varyasyon
 * görselini API üzerinden KURUP public tarafta doğruluyor, admin UI'ın KENDİSİNİ HİÇ tıklamıyor).
 * `MediaPicker`/admin-login/tab-navigasyon altyapısı zaten olgun (bkz. `admin-page-builder-
 * gallery.spec.ts`, `admin-session.ts`) — bu yüzden qa-agent bu üçüncü, GERÇEKTEN tıklayan katmanı
 * eklemeyi tercih etti (görev tanımındaki "altyapı ağırsa eklemek zorunda değilsin" muafiyeti
 * burada GEÇERLİ DEĞİL, altyapı zaten hazır).
 *
 * BULGU (performance/frontend-agent'a yönlendirilecek, bu turun kapsamı DIŞINDA, qa-agent
 * DÜZELTMEDİ) — `MediaPicker` (`components/admin/media/media-picker.tsx::load`) `GET /admin/media`'yı
 * SABİT `limit: 100` ile, TEK sayfa (cursor ilerletme/"daha fazla yükle" YOK) çeker; backend bu
 * listeyi `orderBy: { seq: "asc" }` (EN ESKİDEN yeniye) döndürür (`media.routes.ts`). Paylaşımlı
 * `saas_e2e` veritabanında (onlarca spec dosyasının biriktirdiği fixture medyası) kütüphanede
 * 100'den FAZLA dosya varsa, YENİ yüklenen bir medya HİÇBİR ZAMAN ilk sayfada görünmez — üstüne
 * üstlük arama kutusu (`query`) da yalnızca ZATEN YÜKLENMİŞ `items`'ı istemci tarafında filtreler,
 * sunucuya yeni bir arama sorgusu ATMAZ — yani "en eski 100" dışındaki hiçbir dosya arama ile de
 * BULUNAMAZ. qa-agent bunu bu testi yazarken YANLIŞLIKLA tetikledi (API ile önceden yüklenmiş bir
 * fixture medyası "Tüm Dosyalar 100" listesinde YOKTU, testi 30sn timeout'a düşürdü) — bu yüzden
 * bu test KASITLI OLARAK API-fixture'ı DEĞİL, `MediaPicker`'ın KENDİ "Yükle" (dosya input'u)
 * akışını kullanıyor (yüklenen dosya `onSelect`'e ANINDA/senkron geçer, liste sayfalamasına HİÇ
 * bağımlı DEĞİL) — hem daha gerçekçi bir kullanıcı akışı (yeni görsel yükleyip ATAMA) hem de bu
 * pagination sınırlamasından ETKİLENMEYEN sağlam bir test.
 *
 * Gerçek backend + Postgres (`saas_e2e`) + gerçek tarayıcıya karşı — mock YOK. `createAuthenticatedPage`
 * İLE AYNI risk notu (`admin-session.ts` başlığı) geçerlidir: bu dosya KENDİ context'ini
 * `beforeAll`/`afterAll` içinde açıp kapatır, başka bir spec dosyasıyla PAYLAŞMAZ.
 */
test.describe.configure({ mode: "serial", retries: 1 });

const RUN_SUFFIX = Date.now().toString(36);
const UPLOAD_FILENAME = `qa-admin-variant-media-${RUN_SUFFIX}.png`;

/** `support/product-variants-fixtures.ts::TEST_PNG_BASE64` İLE BİREBİR AYNI 1×1 şeffaf PNG. */
const TEST_PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

let adminPage: Page;
let closeSession: () => Promise<void>;
let adminToken: string;
let product: FixtureProduct;

const createdProductIds: string[] = [];
const createdMediaIds: string[] = [];

/**
 * `product-variants-panel.tsx`'teki per-varyasyon `<Card>` — silme butonunun aria-label'ı
 * (`"${label}" varyasyonunu sil`) TEK bu satıra özgü olduğundan, en yakın `rounded-xl` (Card kök
 * class'ı) atasına çıkılarak satır GÜVENİLİR şekilde SKOPLANIR (sayfada birden fazla `Card`
 * olduğu için düz `div.rounded-xl` seçicisi TEK BAŞINA belirsiz olurdu — dış "Varyasyon
 * kombinasyonları" Card'ı da aynı sınıfı taşır).
 */
function variantRow(page: Page, label: string) {
  const deleteButton = page.getByRole("button", { name: `"${label}" varyasyonunu sil` });
  return deleteButton.locator(
    "xpath=ancestor::div[contains(concat(' ', normalize-space(@class), ' '), ' rounded-xl ')][1]"
  );
}

async function openVariantsTab(page: Page, productId: string) {
  await page.goto(`/admin/products/${productId}`);
  await expect(page.getByRole("heading", { name: "Ürünü Düzenle" })).toBeVisible({ timeout: 15_000 });
  await page.getByRole("tab", { name: "Varyasyon & Döküman" }).click();
  await expect(page.getByRole("heading", { name: "Varyasyon kombinasyonları" })).toBeVisible();
}

test.beforeAll(async ({ browser }: { browser: Browser }, testInfo) => {
  testInfo.setTimeout(60_000);
  const session = await getCachedAdminSession();
  adminToken = session.accessToken;
  ({ page: adminPage, close: closeSession } = await createAuthenticatedPage(browser));

  product = await adminCreateProductFull(adminToken, {
    title: `QA Admin Varyasyon Görseli ${RUN_SUFFIX}`,
    priceCents: 12000,
    stockQuantity: 0,
    variantOptions: [{ name: "Renk", type: "SWATCH", values: [{ value: "Kırmızı", swatchHex: "#DC2626" }] }],
  });
  createdProductIds.push(product.id);
  // KASITLI OLARAK `mediaId` GÖNDERİLMEZ — UI'ın kendisinin sıfırdan bir görsel ATAYABİLDİĞİNİ
  // kanıtlamak için varyasyon görselsiz başlar (yalnızca "temizleme" değil "ekleme" yolu da test edilir).
  await adminCreateProductVariant(adminToken, product.id, {
    optionValues: { Renk: "Kırmızı" },
    stockQuantity: 5,
  });
});

test.afterAll(async () => {
  if (closeSession) await closeSession();
  for (const id of createdProductIds) await adminDeleteProductPermanently(adminToken, id).catch(() => undefined);
  for (const id of createdMediaIds) await deleteTestMedia(adminToken, id).catch(() => undefined);
});

test("Görsel Seç → MediaPicker'dan yükle-ve-seç → satır 'Kaydet' → F5 sonrası hâlâ seçili; 'Kaldır' → 'Kaydet' → F5 sonrası hâlâ boş", async () => {
  test.setTimeout(60_000);

  await openVariantsTab(adminPage, product.id);

  const row = variantRow(adminPage, "Kırmızı");
  await expect(row.getByRole("button", { name: "Görsel seç" })).toBeVisible();
  await expect(row.locator("img")).toHaveCount(0);

  await row.getByRole("button", { name: "Görsel seç" }).click();
  await expect(adminPage.getByRole("heading", { name: "Görsel Seç" })).toBeVisible();

  // Bkz. dosya başlığındaki BULGU — kütüphaneden HAZIR bir öğe seçmek yerine (paylaşımlı
  // `saas_e2e`'de >100 dosya birikmiş olabilir, MediaPicker'ın sabit tek-sayfalık `limit: 100`
  // listesinde YENİ/eski fixture'lar GÖRÜNMEYEBİLİR) doğrudan "Yükle" akışı kullanılır — tek
  // seçim modunda `handleFileChange` yüklenen medyayı ANINDA `onSelect`e geçirip modalı kapatır.
  const uploadResponsePromise = adminPage.waitForResponse(
    (res) => res.request().method() === "POST" && res.url().includes("/admin/media") && res.ok()
  );
  await adminPage.locator('input[aria-label="Bilgisayardan görsel yükle"]').setInputFiles({
    name: UPLOAD_FILENAME,
    mimeType: "image/png",
    buffer: Buffer.from(TEST_PNG_BASE64, "base64"),
  });
  const uploadResponse = await uploadResponsePromise;
  const uploadedMedia = ((await uploadResponse.json()) as { data: { id: string; url: string; filename: string } }).data;
  createdMediaIds.push(uploadedMedia.id);
  expect(uploadedMedia.filename).toBe(UPLOAD_FILENAME);

  await expect(adminPage.getByRole("heading", { name: "Görsel Seç" })).toHaveCount(0);

  // Seçim satırda ANINDA (henüz kaydedilmeden) yansır — yerel form state, `patchRow`.
  await expect(row.locator("img")).toHaveAttribute("src", uploadedMedia.url);
  await expect(row.getByRole("button", { name: "Görsel seç" })).toHaveCount(0);

  await row.getByRole("button", { name: "Kaydet" }).click();
  await expect(adminPage.getByText("Varyasyon güncellendi.").last()).toBeVisible({ timeout: 10_000 });

  // Kalıcılık kanıtı — tam sayfa yeniden yükleme (state'ten DEĞİL, taze bir GET'ten okunur).
  await openVariantsTab(adminPage, product.id);
  const rowAfterReload = variantRow(adminPage, "Kırmızı");
  await expect(rowAfterReload.locator("img")).toHaveAttribute("src", uploadedMedia.url);
  await expect(rowAfterReload.getByRole("button", { name: "Görsel seç" })).toHaveCount(0);

  // Temizleme yolu — "Varyasyon görselini kaldır" → satırın KENDİ "Kaydet"i → F5 sonrası hâlâ boş
  // (backend-agent'ın `products.test.ts`teki "PATCH mediaId: null → GET" senaryosunun UI'dan
  // TETİKLENEN hâli).
  await rowAfterReload.getByRole("button", { name: "Varyasyon görselini kaldır" }).click();
  await expect(rowAfterReload.locator("img")).toHaveCount(0);
  await expect(rowAfterReload.getByRole("button", { name: "Görsel seç" })).toBeVisible();

  await rowAfterReload.getByRole("button", { name: "Kaydet" }).click();
  await expect(adminPage.getByText("Varyasyon güncellendi.").last()).toBeVisible({ timeout: 10_000 });

  await openVariantsTab(adminPage, product.id);
  const rowFinal = variantRow(adminPage, "Kırmızı");
  await expect(rowFinal.locator("img")).toHaveCount(0);
  await expect(rowFinal.getByRole("button", { name: "Görsel seç" })).toBeVisible();
});
