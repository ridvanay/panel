import { test, expect } from "@playwright/test";
import { getCachedAdminSession } from "./support/api";
import {
  adminCreateProductFull,
  adminCreateProductCategory,
  adminDeleteProductPermanently,
  adminDeleteProductCategory,
  type FixtureProduct,
  type FixtureProductCategory,
} from "./support/product-variants-fixtures";

/**
 * qa-agent — `.claude/architect-scope-search-and-order-emails.md` §1.6 qa-agent görev listesi:
 * header'daki canlı ürün arama popover'ının uçtan uca doğrulaması (gerçek tarayıcı + gerçek
 * backend + gerçek Postgres `saas_e2e`).
 *
 * İzole fixture verisi: `saas_e2e` onlarca spec dosyasının paylaştığı tek bir DB'dir — genel
 * "ka" gibi kısa bir terim GERÇEK arama tabanında onlarca alakasız ürüne (`kategori`, `kart` vb.
 * içeren başka spec'lerin fixture ürünleri) çarpıp sonuç kümesini deterministik olmaktan
 * çıkarabilir (5 ürün / 3 kategori tavanı, salesCount/seq sıralaması — bkz. §1.4). Bu yüzden
 * `product-catalog-add-to-cart.spec.ts`/`product-pdp-variants.spec.ts` İLE AYNI desen: RUN_SUFFIX
 * ile TEK bu koşuma özgü, başka hiçbir fixture'la çakışmayan bir terim üretilir; testler kendi
 * ürettiği veriden BAĞIMSIZ sonuç görmeyeceğini garanti eder.
 */
test.describe.configure({ mode: "serial" });

const RUN_SUFFIX = Date.now().toString(36);
// Rastgele+benzersiz, Türkçe karakter İÇERMEYEN bir kök terim — hem ürün başlığında hem kategori
// adında ayrı ayrı geçer ki TEK bir arama isteği hem "Ürünler" hem "Kategoriler" grubunu doldursun.
const SEARCH_TERM = `zqe2e${RUN_SUFFIX}`;
const PRODUCT_TITLE = `Zqe2e Arama Ürünü ${SEARCH_TERM}`;
const CATEGORY_NAME = `Zqe2e Arama Kategori ${SEARCH_TERM}`;
const NO_MATCH_TERM = `nomatch-${RUN_SUFFIX}-xyz`;

let adminToken: string;
let product: FixtureProduct;
let category: FixtureProductCategory;

test.beforeAll(async () => {
  const session = await getCachedAdminSession();
  adminToken = session.accessToken;

  category = await adminCreateProductCategory(adminToken, { name: CATEGORY_NAME });
  product = await adminCreateProductFull(adminToken, {
    title: PRODUCT_TITLE,
    priceCents: 12_345,
    stockQuantity: 10,
    categoryId: category.id,
  });
});

test.afterAll(async () => {
  if (product) await adminDeleteProductPermanently(adminToken, product.id);
  if (category) await adminDeleteProductCategory(adminToken, category.id);
});

/** Header'daki masaüstü (≥1024px, varsayılan Playwright viewport'u zaten bunun üstünde) kalıcı
 *  arama input'u — `header-search.tsx`'teki `aria-label="Ürün ara"` `role="combobox"`. */
function searchInput(page: import("@playwright/test").Page) {
  return page.getByRole("combobox", { name: "Ürün ara" });
}

test("1 karakterde istek atılmaz ve popover açılmaz", async ({ page }) => {
  const searchRequests: string[] = [];
  await page.route("**/products/search**", (route) => {
    searchRequests.push(route.request().url());
    return route.continue();
  });

  await page.goto("/");
  const input = searchInput(page);
  await input.click();
  await input.fill(SEARCH_TERM.slice(0, 1));
  // Debounce (250ms) + ağ gecikmesi payı — istek ASLA atılmamalı (min 2 karakter kuralı §1.6-b).
  await page.waitForTimeout(600);

  expect(searchRequests).toHaveLength(0);
  await expect(page.getByRole("listbox", { name: "Arama sonuçları" })).not.toBeVisible();
});

test("≥2 karakterde açılır kutuda ürün VE kategori grubu görünür, sonuca tıklayınca doğru ürün sayfasına gider", async ({
  page,
}) => {
  await page.goto("/");
  const input = searchInput(page);
  await input.click();
  await input.fill(SEARCH_TERM);

  const listbox = page.getByRole("listbox", { name: "Arama sonuçları" });
  await expect(listbox).toBeVisible({ timeout: 5_000 });

  const productOption = listbox.getByRole("option", { name: new RegExp(PRODUCT_TITLE) });
  const categoryOption = listbox.getByRole("option", { name: CATEGORY_NAME, exact: true });
  await expect(productOption).toBeVisible();
  await expect(categoryOption).toBeVisible();

  // §3 — grup sırası bağlayıcı: Ürünler ÖNCE, Kategoriler SONRA (görsel gruplama doğrulaması).
  await expect(listbox.getByText("Ürünler", { exact: true })).toBeVisible();
  await expect(listbox.getByText("Kategoriler", { exact: true })).toBeVisible();

  await productOption.click();
  await expect(page).toHaveURL(new RegExp(`/products/${product.slug}$`));
  await expect(page.getByRole("heading", { level: 1, name: PRODUCT_TITLE })).toBeVisible();
});

test("bulunamayan terimde boş durum metni gösterilir", async ({ page }) => {
  await page.goto("/");
  const input = searchInput(page);
  await input.click();
  await input.fill(NO_MATCH_TERM);

  await expect(page.getByText(`"${NO_MATCH_TERM}" için sonuç bulunamadı`)).toBeVisible({ timeout: 5_000 });
});

test("'Tüm sonuçları gör' katalog sayfasına (/products?search=...) geçer ve ürünü orada gösterir", async ({ page }) => {
  await page.goto("/");
  const input = searchInput(page);
  await input.click();
  await input.fill(SEARCH_TERM);

  const listbox = page.getByRole("listbox", { name: "Arama sonuçları" });
  await expect(listbox).toBeVisible({ timeout: 5_000 });

  await page.getByRole("link", { name: "Tüm sonuçları gör" }).click();
  await expect(page).toHaveURL(new RegExp(`/products\\?search=${encodeURIComponent(SEARCH_TERM)}$`));
  await expect(page.getByRole("heading", { level: 3, name: PRODUCT_TITLE, exact: true })).toBeVisible();
});
