import { test, expect, type Page } from "@playwright/test";
import { getCachedAdminSession } from "./support/api";
import {
  adminCreateProductFull,
  adminCreateProductVariant,
  adminCreateProductCategory,
  adminDeleteProductPermanently,
  adminDeleteProductCategory,
  type FixtureProduct,
  type FixtureProductCategory,
} from "./support/product-variants-fixtures";

/**
 * qa-agent — `.claude/architect-scope-products-catalog.md` §5.7 madde 1-4/8 (bağlayıcı E2E kapsam
 * listesi), kullanıcının açıkça istediği "kategori/fiyat/renk filtrelerinin doğru sonuç getirdiğini
 * doğrula" akışı. Kendi İZOLE kategori ağacı + ürün fixture'larıyla test edilir (`product-pdp-variants.spec.ts`
 * İLE AYNI gerekçe — paylaşımlı `saas_e2e` DB'deki BAŞKA spec'lerin ürünleri sonuçları
 * kirletmesin diye YENİ, benzersiz kategoriler açılır; bir kategoriye ait ürün seti dışarıdan
 * hiçbir başka testin ürünüyle KESİŞMEZ).
 *
 * Sidebar yalnızca masaüstü genişlikte (`hidden lg:block`) render edilir — Playwright varsayılan
 * viewport'u (1280×720) `lg` kırılım noktasının (1024px) ÜSTÜNDE, mobil `Sheet` kopyası bu yüzden
 * hiç açılmaz/DOM'a KARIŞMAZ; yine de tüm locator'lar `page.locator("aside")` ile masaüstü
 * kenar çubuğuna SINIRLANIR (çift eşleşme riskini baştan ortadan kaldırmak için).
 */
test.describe.configure({ mode: "serial" });

const RUN_SUFFIX = Date.now().toString(36);

let adminToken: string;
let rootCategory: FixtureProductCategory;
let childCategory: FixtureProductCategory;
let otherCategory: FixtureProductCategory;

let productInRoot: FixtureProduct; // kategori: root, 120 TL, Kırmızı
let productDiscounted: FixtureProduct; // kategori: root, liste 2000 TL / indirimli 150 TL, Kırmızı
let productInChild: FixtureProduct; // kategori: child (root'un çocuğu), 450 TL, Mavi
let productInOther: FixtureProduct; // kategori: other (kardeş kök), 780 TL, Yeşil

const createdProductIds: string[] = [];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Sidebar'daki kategori satırının Link'i — sayaç rozeti accessible name'e karıştığı için PREFIX eşleşmesi kullanılır. */
function sidebarCategoryLink(page: Page, name: string) {
  return page.locator("aside").getByRole("link", { name: new RegExp(`^${escapeRegExp(name)}`) });
}

function productHeading(page: Page, title: string) {
  return page.getByRole("heading", { level: 3, name: title, exact: true });
}

test.beforeAll(async () => {
  const session = await getCachedAdminSession();
  adminToken = session.accessToken;

  rootCategory = await adminCreateProductCategory(adminToken, { name: `QA Kök Kategori ${RUN_SUFFIX}` });
  childCategory = await adminCreateProductCategory(adminToken, {
    name: `QA Alt Kategori ${RUN_SUFFIX}`,
    parentId: rootCategory.id,
  });
  otherCategory = await adminCreateProductCategory(adminToken, { name: `QA Diğer Kategori ${RUN_SUFFIX}` });

  productInRoot = await adminCreateProductFull(adminToken, {
    title: `QA Catalog Kök Ürünü ${RUN_SUFFIX}`,
    priceCents: 12000, // 120,00 ₺
    stockQuantity: 10,
    categoryId: rootCategory.id,
    variantOptions: [{ name: "Renk", type: "SWATCH", values: [{ value: "Kırmızı", swatchHex: "#DC2626" }] }],
  });
  productInRoot = await adminCreateProductVariant(adminToken, productInRoot.id, {
    optionValues: { Renk: "Kırmızı" },
    stockQuantity: 10,
  });
  createdProductIds.push(productInRoot.id);

  // §2.3 sözleşmesi (architect) — fiyat filtresi EFFECTIVE (indirimli) fiyata göre çalışır. Liste
  // fiyatı (2000 ₺) kasıtlı olarak filtre aralığının ÇOK DIŞINDA, indirimli fiyat (150 ₺) İÇİNDE.
  productDiscounted = await adminCreateProductFull(adminToken, {
    title: `QA Catalog İndirimli Ürün ${RUN_SUFFIX}`,
    priceCents: 200000,
    discountPriceCents: 15000,
    stockQuantity: 10,
    categoryId: rootCategory.id,
    variantOptions: [{ name: "Renk", type: "SWATCH", values: [{ value: "Kırmızı", swatchHex: "#DC2626" }] }],
  });
  productDiscounted = await adminCreateProductVariant(adminToken, productDiscounted.id, {
    optionValues: { Renk: "Kırmızı" },
    stockQuantity: 10,
  });
  createdProductIds.push(productDiscounted.id);

  productInChild = await adminCreateProductFull(adminToken, {
    title: `QA Catalog Alt Ürünü ${RUN_SUFFIX}`,
    priceCents: 45000, // 450,00 ₺
    stockQuantity: 10,
    categoryId: childCategory.id,
    variantOptions: [{ name: "Renk", type: "SWATCH", values: [{ value: "Mavi", swatchHex: "#2563EB" }] }],
  });
  productInChild = await adminCreateProductVariant(adminToken, productInChild.id, {
    optionValues: { Renk: "Mavi" },
    stockQuantity: 10,
  });
  createdProductIds.push(productInChild.id);

  productInOther = await adminCreateProductFull(adminToken, {
    title: `QA Catalog Diğer Ürünü ${RUN_SUFFIX}`,
    priceCents: 78000, // 780,00 ₺
    stockQuantity: 10,
    categoryId: otherCategory.id,
    variantOptions: [{ name: "Renk", type: "SWATCH", values: [{ value: "Yeşil", swatchHex: "#16A34A" }] }],
  });
  productInOther = await adminCreateProductVariant(adminToken, productInOther.id, {
    optionValues: { Renk: "Yeşil" },
    stockQuantity: 10,
  });
  createdProductIds.push(productInOther.id);
});

test.afterAll(async () => {
  for (const id of createdProductIds) await adminDeleteProductPermanently(adminToken, id);
  // Çocuk ÖNCE (kavramsal netlik) — DB `onDelete: SetNull` zaten sırayı zorlamıyor (§2.1).
  await adminDeleteProductCategory(adminToken, childCategory.id);
  await adminDeleteProductCategory(adminToken, rootCategory.id);
  await adminDeleteProductCategory(adminToken, otherCategory.id);
});

test("madde 1: kategori filtresi — alt kategori seçilince sadece kendi ürünü, üst kategori seçilince çocukları da dahil", async ({
  page,
}) => {
  // `revalidate: 60` önbellek penceresini bekleyen `toPass` döngüsü nedeniyle standart 30sn
  // varsayılanı (bkz. `playwright.config.ts`) yetersiz kalabilir (bkz. `admin-page-builder-dynamic.spec.ts`
  // "Son Blog Yazıları" testindeki AYNI idiom).
  test.setTimeout(150_000);
  await page.goto("/products");
  await expect(page.locator("aside").getByRole("heading", { name: "Filtrele" })).toBeVisible();

  // `fetchProductCatalogServer` `next: { revalidate: 60 }` ile önbelleklenir (bkz.
  // `lib/api/server-products.ts`) — `beforeAll`'da YENİ oluşturulan kök kategori, Next.js'in
  // stale-while-revalidate penceresi kapanana KADAR sidebar'da görünmeyebilir (gerçek prod
  // davranışı, flake DEĞİL — bkz. products.routes.ts'in `triggerPublicPageRevalidation`
  // ÇAĞIRMADIĞI, `pages.routes.ts`'in aksine — bilinen, kapsam dışı bırakılmış bir sınır).
  // `toPass` ile ~90 sn boyunca periyodik `reload` denenir.
  await expect(async () => {
    await page.reload();
    await expect(sidebarCategoryLink(page, rootCategory.name)).toBeVisible({ timeout: 5_000 });
  }).toPass({ timeout: 90_000, intervals: [5_000, 10_000] });

  // ---- üst (kök) kategoriyi seç: kendisi + çocuğu dahil, kardeş kategori HARİÇ ----
  await sidebarCategoryLink(page, rootCategory.name).click();
  await expect(page).toHaveURL(new RegExp(`category=${rootCategory.slug}`));
  await expect(productHeading(page, productInRoot.title)).toBeVisible();
  await expect(productHeading(page, productDiscounted.title)).toBeVisible();
  await expect(productHeading(page, productInChild.title)).toBeVisible();
  await expect(productHeading(page, productInOther.title)).toHaveCount(0);

  // ---- alt kategoriyi genişlet + seç: SADECE kendi ürünü, kök+kardeşin ürünleri HARİÇ ----
  await page.locator("aside").getByRole("button", { name: "Alt kategorileri göster" }).click();
  await sidebarCategoryLink(page, childCategory.name).click();
  await expect(page).toHaveURL(new RegExp(`category=${childCategory.slug}`));
  await expect(productHeading(page, productInChild.title)).toBeVisible();
  await expect(productHeading(page, productInRoot.title)).toHaveCount(0);
  await expect(productHeading(page, productDiscounted.title)).toHaveCount(0);
  await expect(productHeading(page, productInOther.title)).toHaveCount(0);

  // ---- "Tümü" filtreyi kaldırır ----
  await page.locator("aside").getByRole("link", { name: "Tümü" }).click();
  await expect(page).not.toHaveURL(/category=/);
  await expect(productHeading(page, productInOther.title)).toBeVisible();
});

test("madde 2: fiyat aralığı filtresi (manuel giriş) — indirimli ürün İNDİRİMLİ (effective) fiyata göre filtreleniyor", async ({
  page,
}) => {
  // Kök kategoriye sabitlenir (§ facet — kendisi+çocuğu: kök[120₺] + indirimli[eff. 150₺] + alt[450₺]).
  await page.goto(`/products?category=${rootCategory.slug}`);
  await expect(productHeading(page, productInRoot.title)).toBeVisible();
  await expect(productHeading(page, productDiscounted.title)).toBeVisible();
  await expect(productHeading(page, productInChild.title)).toBeVisible();

  // 140–200 ₺ aralığı: yalnızca indirimli ürünün EFFECTIVE fiyatı (150₺) bu aralıkta — orijinal
  // liste fiyatı (2000₺) olsaydı aralığın ÇOK dışında kalırdı; kök (120₺ < 140) ve alt (450₺ > 200)
  // aralık DIŞINDA kalmalı.
  //
  // BUG NOTU (frontend-agent'a raporlandı, bkz. final qa-agent özeti) — `price-range-filter.tsx`
  // her `commit()` çağrısında DİĞER alanın değerini LOKAL `range` state'inden okuyor, bu state ise
  // yalnızca sunucudan dönen YENİ `filters` prop'u (bir önceki `router.replace` TAMAMLANDIKTAN
  // SONRA) ile senkronize oluyor. Min alanına yazıp HEMEN (sunucu turu tamamlanmadan) Max alanına
  // geçip onu da commit eden bir kullanıcı, Max commit'inin `range[0]`'ı hâlâ ESKİ/sınır değeriyle
  // okuması yüzünden Min girişini SESSİZCE kaybediyor (elle doğrulandı: Min→Max hızlı ardışık
  // commit'te URL yalnızca `maxPrice` içeriyor, `minPrice` DÜŞÜYOR). Bu testte gerçek/dikkatli bir
  // kullanıcıyı taklit etmek için Min'in URL'e yansıdığı AÇIKÇA beklenir, ANCAK asıl filtreleme
  // mantığını (bu testin amacı) maskelememesi için commit'ler arası bekleme YAPILIR.
  await page.locator("aside").getByLabel("Minimum fiyat").fill("140");
  await page.locator("aside").getByLabel("Minimum fiyat").blur();
  await expect(page).toHaveURL(/minPrice=14000/);

  await page.locator("aside").getByLabel("Maksimum fiyat").fill("200");
  await page.locator("aside").getByLabel("Maksimum fiyat").blur();

  await expect(page).toHaveURL(/minPrice=14000/);
  await expect(page).toHaveURL(/maxPrice=20000/);
  await expect(productHeading(page, productDiscounted.title)).toBeVisible();
  await expect(productHeading(page, productInRoot.title)).toHaveCount(0);
  await expect(productHeading(page, productInChild.title)).toHaveCount(0);
});

test("madde 3: fiyat aralığı filtresi (slider, klavye ile taşıma) — sonuçlar aralığa göre güncelleniyor", async ({ page }) => {
  await page.goto(`/products?category=${rootCategory.slug}`);
  // Base UI `Slider.Thumb` gizli bir `<input type="range">` üzerinden çalışır — `role="slider"`
  // DOM'da AÇIKÇA yazılı değil, HTML'in örtük ARIA eşlemesinden gelir (`getByRole` bunu çözer,
  // ham `[role="slider"]` öznitelik seçicisi ÇÖZMEZ).
  const minThumb = page.locator("aside").getByRole("slider").first();
  await expect(minThumb).toBeVisible();
  await minThumb.focus();
  // Facet alt sınırı 120₺ (kök ürün) — üst tutamağı hedeflemek yerine ALT (min) tutamağı sağa
  // taşıyıp kök ürünü (120₺) aralığın DIŞINA iter; indirimli (eff. 150₺) ve alt (450₺) İÇERİDE kalır.
  // `End` tuşu tutamağı KENDİ üst sınırına götürür — bunun yerine tek tek `ArrowRight` ile 130₺'a
  // (10 adım × ~1₺, `Slider` varsayılan `step=1` birim) yaklaşacak kadar taşınır.
  for (let i = 0; i < 15; i++) {
    await minThumb.press("ArrowRight");
  }
  await expect(page).toHaveURL(/minPrice=/);
  await expect(productHeading(page, productInRoot.title)).toHaveCount(0);
  await expect(productHeading(page, productDiscounted.title)).toBeVisible();
  await expect(productHeading(page, productInChild.title)).toBeVisible();
});

test("madde 4: renk (option) filtresi — tek renk seçilince o renk, iki renk seçilince İKİSİ DE (eksen içi OR)", async ({
  page,
}) => {
  await page.goto(`/products?category=${rootCategory.slug}`);

  const redSwatch = page.locator("aside").getByRole("checkbox", { name: "Kırmızı", exact: true });
  await redSwatch.click();
  await expect(page).toHaveURL(/option=renk%3Akirmizi/);
  await expect(productHeading(page, productInRoot.title)).toBeVisible();
  await expect(productHeading(page, productDiscounted.title)).toBeVisible();
  await expect(productHeading(page, productInChild.title)).toHaveCount(0); // Mavi — dışarıda kalmalı

  const blueSwatch = page.locator("aside").getByRole("checkbox", { name: "Mavi", exact: true });
  await blueSwatch.click();
  await expect(page).toHaveURL(/option=renk%3Amavi/);
  // Kırmızı VEYA Mavi (OR) — üçü de görünür olmalı.
  await expect(productHeading(page, productInRoot.title)).toBeVisible();
  await expect(productHeading(page, productDiscounted.title)).toBeVisible();
  await expect(productHeading(page, productInChild.title)).toBeVisible();
});

test("madde 5: Filtreleri Temizle — kategori + fiyat + renk filtrelerinin TAMAMINI sıfırlıyor", async ({ page }) => {
  await page.goto(
    `/products?category=${rootCategory.slug}&minPrice=14000&maxPrice=20000&option=renk%3Akirmizi`
  );
  await expect(productHeading(page, productDiscounted.title)).toBeVisible();
  await expect(productHeading(page, productInChild.title)).toHaveCount(0);

  await page.locator("aside").getByRole("button", { name: "Filtreleri Temizle" }).click();

  await expect(page).not.toHaveURL(/category=/);
  await expect(page).not.toHaveURL(/minPrice=/);
  await expect(page).not.toHaveURL(/option=/);
  // Filtreler sıfırlanınca kardeş kategorinin ürünü de yeniden görünür olmalı.
  await expect(productHeading(page, productInOther.title)).toBeVisible();
});
