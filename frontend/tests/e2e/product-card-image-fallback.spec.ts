import { test, expect, type Page } from "@playwright/test";
import { getCachedAdminSession } from "./support/api";
import {
  adminCreateProductFull,
  adminDeleteProductPermanently,
  deleteTestMedia,
  uploadTestImageMedia,
  type FixtureProduct,
  type TestMediaFixture,
} from "./support/product-variants-fixtures";

/**
 * qa-agent — Fix 2 (kırık ürün görseli yer tutucusu, frontend-agent fix'i) regresyon testi.
 * `product-card-media.tsx` artık bir kapak görseli 404 döndüğünde tarayıcının yerel "kırık görsel"
 * ikonu yerine `<SafeImage>`'i DOM'dan kaldırıp `ImageOff` (lucide) ikonlu bir yer tutucu `<div>`
 * render ediyor (`onError` → `failedUrls` state'i → `renderImagePlaceholder("error")`). Rozet/
 * favori butonu gibi mutlak konumlu KARDEŞ katmanlar bu koşuldan ETKİLENMEMELİ (regresyon
 * kontrolü, görev tanımı madde 3).
 *
 * `product-pdp-variants.spec.ts`/`product-catalog-add-to-cart.spec.ts` İLE AYNI desen: kendi
 * İZOLE fixture ürünleriyle (gerçek `POST /admin/products` + `POST /admin/media`), paylaşımlı
 * `saas_e2e` DB'deki başka ürünlerle KARIŞMAYAN, `?search=` ile TEK sonuca daraltılabilen bir
 * ortak başlık ön eki. Gerçek 404 üretmek için PRODUCTION medyasına DOKUNULMAZ — `page.route` ile
 * yalnızca BİR ürünün kapak görseli ağ seviyesinde 404'e ZORLANIR (sağlayıcı/gerçek dosya
 * DEĞİŞTİRİLMEZ), diğer ürünün görseli gerçek backend'den NORMAL şekilde yüklenir (sağlık
 * kontrolü — hiçbir şey REGRESE olmamış).
 */
test.describe.configure({ mode: "serial" });

const RUN_SUFFIX = Date.now().toString(36);
const TITLE_PREFIX = `QA PCM Fallback ${RUN_SUFFIX}`;

let adminToken: string;
let brokenMedia: TestMediaFixture;
let okMedia: TestMediaFixture;
let brokenProduct: FixtureProduct;
let okProduct: FixtureProduct;

const createdProductIds: string[] = [];
const createdMediaIds: string[] = [];

/**
 * `SafeImage` (`safe-image.tsx`) host'a göre ya `next/image`'e (`/_next/image?url=<encodeURIComponent(rawUrl)>&...`)
 * ya da ham `<img src="rawUrl">`'e düşer (bkz. `product-pdp-variants.spec.ts` başlığındaki AYNI
 * bulgu) — bu yüzden ağ seviyesinde eşleşme HER İKİ biçimi de kapsamalı: doğrudan href eşitliği
 * (ham `<img>` dalı) VEYA `next/image` proxy'sinin `url` sorgu parametresi (otomatik
 * yüzde-çözümlenmiş) hedef medya URL'ine eşit olması (optimize dal).
 */
function matchesMediaUrl(url: URL, target: string): boolean {
  if (url.href === target) return true;
  return url.searchParams.get("url") === target;
}

/** Izgara kartının kök sarmalayıcısı (`product-card.tsx` grid dalı) — başlık metniyle daraltılır. */
function productCard(page: Page, title: string) {
  return page.locator("div.group.relative.overflow-hidden.rounded-lg.border.border-border").filter({ hasText: title });
}

test.beforeAll(async () => {
  const session = await getCachedAdminSession();
  adminToken = session.accessToken;

  brokenMedia = await uploadTestImageMedia(adminToken, `qa-pcm-broken-${RUN_SUFFIX}.png`);
  okMedia = await uploadTestImageMedia(adminToken, `qa-pcm-ok-${RUN_SUFFIX}.png`);
  createdMediaIds.push(brokenMedia.id, okMedia.id);

  brokenProduct = await adminCreateProductFull(adminToken, {
    title: `${TITLE_PREFIX} Kirik`,
    priceCents: 4200,
    stockQuantity: 10,
    coverMediaId: brokenMedia.id,
  });
  createdProductIds.push(brokenProduct.id);

  okProduct = await adminCreateProductFull(adminToken, {
    title: `${TITLE_PREFIX} Saglam`,
    priceCents: 4200,
    stockQuantity: 10,
    coverMediaId: okMedia.id,
  });
  createdProductIds.push(okProduct.id);
});

test.afterAll(async () => {
  for (const id of createdProductIds) await adminDeleteProductPermanently(adminToken, id).catch(() => undefined);
  for (const id of createdMediaIds) await deleteTestMedia(adminToken, id).catch(() => undefined);
});

test("Fix 2 regresyon: kapak görseli 404 dönen ürün kartı ImageOff yer tutucusu gösterir, rozet/favori KARDEŞLERİ hâlâ görünür, kırık <img> DOM'da KALMAZ; müdahale edilmeyen kart normal yükleniyor", async ({
  page,
}) => {
  test.setTimeout(60_000);

  // Yalnızca `brokenProduct`ın kapak görseli ağ seviyesinde 404'e zorlanır — `okProduct`ın
  // görseli GERÇEK backend'den (saas_e2e) normal şekilde servis edilmeye devam eder.
  await page.route(
    (url) => matchesMediaUrl(url, brokenMedia.url),
    (route) => route.fulfill({ status: 404, contentType: "text/plain", body: "not found" })
  );
  // `okMedia`nın GERÇEKTEN 200 ile servis edildiğini (route tarafından YANLIŞLIKLA da engellenmediğini)
  // ağ seviyesinde doğrulamak için `goto`'DAN ÖNCE kurulur (istek sayfa yüklenirken atılır).
  const okImageResponsePromise = page.waitForResponse(
    (res) => matchesMediaUrl(new URL(res.url()), okMedia.url),
    { timeout: 15_000 }
  );

  await page.goto(`/products?search=${encodeURIComponent(TITLE_PREFIX)}`);
  await expect(page.getByRole("heading", { level: 3, name: `${TITLE_PREFIX} Kirik`, exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { level: 3, name: `${TITLE_PREFIX} Saglam`, exact: true })).toBeVisible();

  const brokenCard = productCard(page, `${TITLE_PREFIX} Kirik`);
  const okCard = productCard(page, `${TITLE_PREFIX} Saglam`);

  // Asıl regresyon kontrolü — `onError` state güncellemesi ASENKRON (bir istemci re-render'ı
  // gerektirir), bu yüzden `expect(...).toBeVisible()`'ın kendi otomatik yeniden deneme mekanizması
  // KULLANILIR, sabit bir `waitForTimeout` YAZILMAZ.
  await expect(brokenCard.locator("svg.lucide-image-off")).toBeVisible();
  // Yer tutucu render edildikten SONRA `<SafeImage>` DOM'dan TAMAMEN kaldırılmış olmalı — tarayıcının
  // yerel "kırık görsel" ikonuyla kalan bir `<img>` DOM'da KALMAMALI.
  await expect(brokenCard.locator("img")).toHaveCount(0);

  // Regresyon kontrolü (görev tanımı madde 3) — rozet/favori butonu gibi mutlak konumlu KARDEŞ
  // katmanlar yer tutucu koşulundan ETKİLENMEDEN görünür kalmaya devam ediyor.
  await expect(brokenCard.getByRole("button", { name: "Favorilere ekle" })).toBeVisible();

  // Sağlık kontrolü — müdahale EDİLMEYEN kart hâlâ normal bir `<img>` (next/image ya da ham
  // `<img>`, ikisi de gerçek DOM `<img>` elemanı üretir) render ediyor, yer tutucu YOK.
  //
  // qa-agent NOTU — `naturalWidth > 0` (görev tanımının önerdiği kontrol) BİLEREK kullanılmadı:
  // bu proje `uploadTestImageMedia`nın sabit 1×1 piksel PNG fixture'ını kullanıyor (bkz.
  // `support/product-variants-fixtures.ts::TEST_PNG_BASE64`) ve next/image bu boyuttaki bir
  // kaynağı `srcset`teki HİÇBİR `w` tanımlayıcısı için BÜYÜTMÜYOR (`images.dangerouslyAllowLocalIP`
  // ile İLGİSİZ, next/image'in kendi "enlargement yok" davranışı) — tarayıcı, gerçek 1×1 piksel
  // veriyi `w=256..3840` tanımlayıcılarına göre yoğunluk-düzeltmesi yaparak yorumluyor ve
  // `naturalWidth`i GERÇEK DIŞI (genelde 0'a yuvarlanan) bir değere indiriyor — bu next/image'in
  // responsive `srcset` (w-tanımlayıcı) davranışıyla ölçüsüz küçük bir test fixture'ının
  // ETKİLEŞİMİDİR, `product-card-media.tsx`teki Fix 2 koduyla (veya başka bir regresyonla) İLGİSİZ
  // (bkz. bu dosyanın harici bir Playwright betiğiyle izole doğrulanmış hata ayıklaması — aynı
  // 1×1 kaynak `srcset` OLMADAN tek bir `<img>`e verildiğinde `naturalWidth` doğru şekilde `1`
  // dönüyor). Bu yüzden "görsel GERÇEKTEN yüklendi mi" sorusu burada DAHA GÜVENİLİR bir sinyalle,
  // ağ seviyesinde (`okMedia.url` isteğinin GERÇEKTEN 200 döndüğü, bizim route'umuzun YANLIŞLIKLA
  // onu da engellemediği) + DOM seviyesinde (yer tutucu YOK, `<img>` VAR) doğrulanır.
  const okImageResponse = await okImageResponsePromise;
  expect(okImageResponse.status(), "müdahale edilmeyen ürünün görsel isteği 200 dönmeli").toBe(200);

  await expect(okCard.locator("svg.lucide-image-off")).toHaveCount(0);
  const okImg = okCard.locator("img").first();
  await expect(okImg).toBeVisible();
  await expect(okCard.getByRole("button", { name: "Favorilere ekle" })).toBeVisible();
});
