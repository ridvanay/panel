import { test, expect, type Page, type Browser } from "@playwright/test";
import { API_BASE_URL, getCachedAdminSession } from "./support/api";
import { createAuthenticatedPage } from "./support/admin-session";
import { adminCreateProductFull, adminDeleteProductPermanently, type FixtureProduct } from "./support/product-variants-fixtures";

/**
 * qa-agent — Merkezi Vergi/KDV Sınıfları özelliği (backend/db/frontend-agent tamamladı, bkz.
 * `.claude` görev tanımı) uçtan uca doğrulaması. Backend'in kendi `tests/integration/tax.test.ts`'i
 * (`app.inject`, gerçek HTTP/tarayıcı katmanı YOK) RBAC/409/422 matrisini zaten kapsıyor — bu dosya
 * o tabanın ÜSTÜNE gerçek buton tıklaması → gerçek ağ isteği → gerçek DB → UI'a yansıma zincirini
 * ekler: (1) `/admin/settings?tab=tax`'ten yeni bir vergi sınıfı ekleme, (2) ürün düzenleme
 * formunda o sınıfı seçip kaydetme + F5 sonrası kalıcılık, (3) storefront sepetinde doğru oranla
 * KDV dökümünün görünmesi, (4) eski serbest "KDV oranı (%)" metin kutusunun ARTIK OLMADIĞININ
 * regresyon güvencesi.
 *
 * `admin-product-variant-media-persistence.spec.ts` İLE AYNI desen: dosya başına TEK context
 * (`createAuthenticatedPage`, `beforeAll`/`afterAll`) — admin-session.ts başlığındaki refresh-token
 * rotasyonu riskini azaltma disiplini. Storefront sepet doğrulaması ise varsayılan (çerezsiz) `page`
 * fixture'ıyla — `cart-dedupe-drawer-shipping.spec.ts` İLE AYNI ayrım.
 */
test.describe.configure({ mode: "serial" });

const RUN_SUFFIX = Date.now().toString(36);
const TAX_RATE_NAME = `QA E2E %10 İndirimli ${RUN_SUFFIX}`;

let adminToken: string;
let adminPage: Page;
let closeAdminSession: () => Promise<void>;
let product: FixtureProduct;
let createdTaxRateId: string | null = null;

function authHeadersNoBody(token: string) {
  return { Authorization: `Bearer ${token}` };
}

interface TaxRateApiDto {
  id: string;
  name: string;
  ratePercent: number;
  isDefault: boolean;
}

/** `GET /admin/tax-rates` — yalnızca bu dosyanın oluşturduğu sınıfı bulmak/temizlemek için (fixture amaçlı, UI akışının YERİNE GEÇMEZ). */
async function findTaxRateByName(token: string, name: string): Promise<TaxRateApiDto | null> {
  const res = await fetch(`${API_BASE_URL}/admin/tax-rates`, { headers: authHeadersNoBody(token) });
  const body = (await res.json()) as { data: TaxRateApiDto[] };
  return body.data.find((r) => r.name === name) ?? null;
}

async function deleteTaxRateBestEffort(token: string, taxRateId: string): Promise<void> {
  await fetch(`${API_BASE_URL}/admin/tax-rates/${taxRateId}`, { method: "DELETE", headers: authHeadersNoBody(token) });
}

test.beforeAll(async ({ browser }: { browser: Browser }) => {
  const session = await getCachedAdminSession();
  adminToken = session.accessToken;
  ({ page: adminPage, close: closeAdminSession } = await createAuthenticatedPage(browser));

  product = await adminCreateProductFull(adminToken, {
    title: `QA Vergi Sınıfı Ürünü ${RUN_SUFFIX}`,
    priceCents: 20000,
    stockQuantity: 10,
  });
});

test.afterAll(async () => {
  await closeAdminSession();
  await adminDeleteProductPermanently(adminToken, product.id);
  // Ürün silindiğinden (`productCount` artık 0) `reassignToId` OLMADAN da silinebilir.
  if (createdTaxRateId) await deleteTaxRateBestEffort(adminToken, createdTaxRateId);
});

test("Ayarlar > Vergi Sınıfları sekmesinden yeni bir vergi sınıfı eklenir; tabloya ve başarı bildirimine yansır", async () => {
  await adminPage.goto("/admin/settings?tab=tax");
  await expect(adminPage.getByRole("heading", { name: "Vergi Sınıfları", exact: true })).toBeVisible();

  await adminPage.getByRole("button", { name: "Yeni Vergi Sınıfı Ekle" }).first().click();

  const dialog = adminPage.getByRole("dialog", { name: "Yeni Vergi Sınıfı" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Ad").fill(TAX_RATE_NAME);
  await dialog.getByLabel("Oran (%)").fill("10");
  await dialog.getByRole("button", { name: "Ekle" }).click();

  await expect(adminPage.getByText("Vergi sınıfı eklendi.")).toBeVisible();
  await expect(dialog).not.toBeVisible();

  const row = adminPage.locator("tr").filter({ hasText: TAX_RATE_NAME });
  await expect(row).toBeVisible();
  await expect(row.getByText("10", { exact: true })).toBeVisible();

  // Sonraki adımlarda ürüne atamak için gerçek id — UI akışının YERİNE geçmez, yalnızca fixture bağlantısı.
  const created = await findTaxRateByName(adminToken, TAX_RATE_NAME);
  expect(created).not.toBeNull();
  expect(created?.ratePercent).toBe(10);
  createdTaxRateId = created!.id;
});

test("Ürün düzenleme formunda vergi sınıfı seçilip kaydedilince kalıcı olur; eski serbest KDV metin kutusu ARTIK YOK", async () => {
  expect(createdTaxRateId).not.toBeNull();

  await adminPage.goto(`/admin/products/${product.id}`);
  await expect(adminPage.getByRole("heading", { name: "Ürünü Düzenle" })).toBeVisible();

  // Regresyon güvencesi (`.claude` görev notu §2) — serbest KDV yüzdesi text input'u KALDIRILDI.
  await expect(adminPage.getByLabel(/KDV oranı/)).toHaveCount(0);
  await expect(adminPage.getByText("KDV oranı (%)")).toHaveCount(0);

  const taxSelect = adminPage.getByLabel("Vergi Sınıfı");
  await expect(taxSelect).toBeVisible();
  await taxSelect.selectOption(createdTaxRateId!);

  await adminPage.getByRole("button", { name: "Kaydet" }).click();
  await expect(adminPage.getByText("Ürün kaydedildi.")).toBeVisible();

  // Tam sayfa yeniden yükleme sonrası hâlâ seçili — DB'ye gerçekten yazıldığının kanıtı.
  await adminPage.reload();
  await expect(adminPage.getByRole("heading", { name: "Ürünü Düzenle" })).toBeVisible();
  await expect(adminPage.getByLabel("Vergi Sınıfı")).toHaveValue(createdTaxRateId!);
});

test("Ürün sepete eklenince sepet sayfasında %10 KDV dökümü doğru oranla görünür", async ({ page }) => {
  await page.goto(`/products/${product.slug}`);
  await expect(page.getByRole("heading", { level: 1, name: product.title })).toBeVisible();
  await page.getByRole("button", { name: "Sepete ekle" }).click();

  const drawer = page.getByRole("dialog", { name: "Sepetiniz" });
  await expect(drawer).toBeVisible();
  await drawer.getByRole("button", { name: "Sepeti kapat" }).click();
  await expect(drawer).not.toBeVisible();

  await page.goto("/cart");
  await expect(page.getByRole("heading", { name: "Sepetim" })).toBeVisible();
  // `tax-summary-rows.tsx::formatRatePercent` — tam sayı oran ondalıksız gösterilir ("10", "10,0" DEĞİL).
  await expect(page.getByText("KDV (%10)")).toBeVisible();
});
