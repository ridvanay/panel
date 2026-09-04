import { test, expect } from "@playwright/test";
import { getCachedAdminSession, getFixtureUserToken, getSiteModules, patchSiteModule } from "./support/api";
import { adminGetUserByEmail, adminUpdateRole, resetFixtureUserToBaseline } from "./support/admin-users-fixtures";
import { getDemoTemplatesRaw, importDemoTemplateRaw, listAuditLogsRaw } from "./support/demo-templates-fixtures";
import {
  ECOMMERCE_TEMPLATE_KEY,
  EXPECTED_COMMERCE_COUNTS,
  HOME_PAGE_SLUG,
  KNOWN_EXTRA_PAGE_SLUGS,
  countAdminOrders,
  getEcommerceProSliderId,
  getPublicPage,
  purgeKnownEcommerceProContent,
} from "./support/ecommerce-pro-fixtures";
import { getSlider } from "./support/sliders-fixtures";

/**
 * qa-agent — `.claude/architect-scope-ecommerce-pro-template.md` §9.9 madde 7/8/9 (bağlayıcı E2E
 * kapsam listesi). Madde 9 ([DTI] §12 mirası — RBAC/idempotency/confirm/force/hız sınırı) BURADA
 * YENİDEN YAZILMAZ: `admin-demo-template-import.spec.ts`teki (modern-architecture için yazılmış)
 * AYNI sözleşme, yalnızca `ECOMMERCE_TEMPLATE_KEY` ile parametrize edilerek doğrulanır — kod
 * KOPYALANMADI, generic yardımcılar (`importDemoTemplateRaw`/`getDemoTemplatesRaw`/
 * `listAuditLogsRaw`) o dosyanın da kullandığı `support/demo-templates-fixtures.ts`'ten aynen
 * import edilir.
 *
 * BUGFIX DOĞRULAMASI (üst koordinatörün talebi, backend-agent fix'i) — eskiden `force:true` ile
 * İKİNCİ bir `ecommerce-pro` içe aktarımı, `Product.sku`/`ProductVariant.sku` GLOBAL `@unique`
 * kısıtına (otomatik benzersizleştirme YOK) çarparak 409/500 ile SONUÇLANIYORDU. `importer.ts`
 * `resolveSlugPlan` artık `findAvailableSku` ile SKU'ları da slug'lar GİBİ `-2`/`-3` son ekiyle
 * otomatik benzersizleştiriyor (satır ~187-211) — bu dosya YENİ (düzeltilmiş) davranışı, yani
 * ikinci import'un `201` DÖNDÜĞÜNÜ ve SKU'ların benzersizleştirildiğini assert eder — bkz.
 * "SKU-benzersizleştirme" testi.
 *
 * ============================================================================================
 * HIZ SINIRI İZOLASYONU — `admin-demo-template-import.spec.ts` başlığındaki AYNI bulgu/gerekçe:
 * `POST /admin/demo-templates/{key}/import` route-seviyesinde `{max:5, timeWindow:"1 minute"}`
 * ile TÜM templateKey'ler için ORTAK bir sayaca (aynı route, `request.ip` anahtarlı) yazar.
 * Bu dosyanın çağrıları 3 pencereye BÖLÜNÜR: (1) hız sınırı testi — kimlik doğrulamasız 6 istek,
 * İZOLE; (2) "iş mantığı" penceresi — TAM 5 gerçek çağrı (happy-path, idempotency-409,
 * missing-confirm-422, force-SKU-benzersizleştirme, module-off-import); (3) RBAC penceresi — 3 çağrı.
 * ============================================================================================
 */
test.describe.configure({ mode: "serial" });

const FRONTEND_URL = process.env.E2E_FRONTEND_URL ?? "http://localhost:3100";

const RUN_SUFFIX = Date.now().toString(36);
const MANAGER_EMAIL = `qa-e2e-ecom-manager-${RUN_SUFFIX}@example.com`;
const EDITOR_EMAIL = `qa-e2e-ecom-editor-${RUN_SUFFIX}@example.com`;
const LOW_PRIV_EMAIL = `qa-e2e-ecom-user-${RUN_SUFFIX}@example.com`;
const FIXTURE_PASSWORD = "QaE2eEcomTpl12345!";

const RATE_LIMIT_WINDOW_RESET_MS = 65_000;

let adminToken: string;
let managerToken: string;
let editorToken: string;
let lowPrivToken: string;

let initialProductsModuleEnabled: boolean;

let firstImportPageId: string;

test.beforeAll(async ({}, testInfo) => {
  testInfo.setTimeout(180_000);
  const session = await getCachedAdminSession();
  adminToken = session.accessToken;

  // Temiz zemin — önceki (muhtemelen yarım kalmış) bir koşumdan kalan TÜM ecommerce-pro içeriğini
  // (ürün/kategori/sayfa/slider) + idempotency işaretini siler (bkz. dosya başlığı).
  await purgeKnownEcommerceProContent(adminToken);

  const modules = await getSiteModules(adminToken);
  initialProductsModuleEnabled = (modules.find((m) => m.key === "products")?.enabled as boolean | undefined) ?? true;
  if (!initialProductsModuleEnabled) await patchSiteModule(adminToken, "products", true);

  managerToken = await getFixtureUserToken(MANAGER_EMAIL, FIXTURE_PASSWORD, "QA E2E Ecom Manager");
  const managerUser = await adminGetUserByEmail(adminToken, MANAGER_EMAIL);
  if (!managerUser) throw new Error("Fixture MANAGER kullanıcısı oluşturulamadı.");
  await adminUpdateRole(adminToken, managerUser.id, "MANAGER");

  editorToken = await getFixtureUserToken(EDITOR_EMAIL, FIXTURE_PASSWORD, "QA E2E Ecom Editor");
  const editorUser = await adminGetUserByEmail(adminToken, EDITOR_EMAIL);
  if (!editorUser) throw new Error("Fixture EDITOR kullanıcısı oluşturulamadı.");
  await adminUpdateRole(adminToken, editorUser.id, "EDITOR");

  lowPrivToken = await getFixtureUserToken(LOW_PRIV_EMAIL, FIXTURE_PASSWORD, "QA E2E Ecom User");
});

test.afterAll(async () => {
  await purgeKnownEcommerceProContent(adminToken).catch(() => undefined);
  await patchSiteModule(adminToken, "products", initialProductsModuleEnabled).catch(() => undefined);
  await resetFixtureUserToBaseline(adminToken, MANAGER_EMAIL).catch(() => undefined);
  await resetFixtureUserToBaseline(adminToken, EDITOR_EMAIL).catch(() => undefined);
  await resetFixtureUserToBaseline(adminToken, LOW_PRIV_EMAIL).catch(() => undefined);
});

test("hız sınırı — 6. istek 429 döner (izole, kimlik doğrulamasız)", async () => {
  test.setTimeout(90_000);
  const statuses: number[] = [];
  for (let i = 0; i < 6; i++) {
    const res = await importDemoTemplateRaw(null, ECOMMERCE_TEMPLATE_KEY, undefined);
    statuses.push(res.status);
  }
  expect(statuses.slice(0, 5)).not.toContain(429);
  expect(statuses[5]).toBe(429);

  await new Promise((resolve) => setTimeout(resolve, RATE_LIMIT_WINDOW_RESET_MS));
});

test("madde 7: ADMIN olarak ecommerce-pro uygula → 201, 8 ürün+4 kategori+14 varyasyon+4 döküman, 4 yasal sayfa, Order YOK", async () => {
  test.setTimeout(60_000);

  const ordersBefore = await countAdminOrders(adminToken);

  const listBefore = await getDemoTemplatesRaw(adminToken);
  expect(listBefore.data?.find((t) => t.key === ECOMMERCE_TEMPLATE_KEY)?.appliedAt).toBeNull();

  const res = await importDemoTemplateRaw(adminToken, ECOMMERCE_TEMPLATE_KEY, { confirm: true, force: false });
  expect(res.status).toBe(201);
  const result = res.data as {
    pageId: string;
    pageSlug: string;
    counts: { media: number };
    warnings: string[];
  };
  firstImportPageId = result.pageId;

  // §4.3 — yasal yer tutucu uyarı HER zaman döner (legalPageCount=4>0); modül uyarısı YOK
  // (products modülü bu noktada açık).
  expect(result.warnings).toContain("4 yasal sayfa YER TUTUCU olarak oluşturuldu; yayına almadan önce içeriklerini doldurun.");
  expect(result.warnings.some((w) => w.includes("Ürünler modülü kapalı"))).toBe(false);

  // commerceCounts YALNIZCA audit log metadata'sında (§4.6 — response şemasının parçası DEĞİL).
  const logs = await listAuditLogsRaw(adminToken, { action: "demo_template.import", limit: 20 });
  const entry = logs.find((l) => l.targetId === firstImportPageId && l.status === "SUCCESS");
  expect(entry).toBeTruthy();
  const metadata = entry!.metadata as Record<string, unknown>;
  expect(metadata.templateKey).toBe(ECOMMERCE_TEMPLATE_KEY);
  expect(metadata.commerceCounts).toEqual(EXPECTED_COMMERCE_COUNTS);
  expect(Object.prototype.hasOwnProperty.call(metadata, "previousShipping")).toBe(true);

  // 4 yasal sayfa — `isLegalDocument: true` ile PUBLİC olarak erişilebilir + yer tutucu notice içerir.
  for (const slug of KNOWN_EXTRA_PAGE_SLUGS) {
    const page = await getPublicPage(slug);
    expect(page.status, `beklenen 200: ${slug}`).toBe(200);
    expect(page.data?.isLegalDocument).toBe(true);
    expect(JSON.stringify(page.data?.blocks)).toContain("yer tutucudur");
  }

  // §4.5 kabul kriteri — hiçbir Order satırı YARATILMADI (DELTA karşılaştırması, bkz. dosya başlığı).
  const ordersAfter = await countAdminOrders(adminToken);
  expect(ordersAfter).toBe(ordersBefore);
});

/**
 * qa-agent — Fix 1 + Fix 2 + Fix 3 doğrulaması (üst koordinatörün görev talimatı). "madde 7"nin
 * ürettiği içerik `madde 8`teki `purgeKnownEcommerceProContent` çağrısına KADAR ayaktadır — bu
 * yüzden bu test BİLEREK o testten HEMEN SONRA, `madde 9a/9b/SKU-çakışma` testlerinin (hiçbiri
 * içeriği SİLMEZ, yalnızca 409/422/500 döner — bkz. kendi yorumları) ARASINA eklendi.
 */
test("Fix 1/2/3: hero slaytları bgType:image + geçerli bgMedia.url taşıyor; anasayfada (kök VE kendi slug'ı) arka plan <img> GERÇEKTEN yükleniyor, 'Ana Sayfa' H1 sızıntısı YOK, okunabilirlik gradyanı DOM'da", async ({
  page,
}) => {
  test.setTimeout(150_000);

  // Fix 1 — backend: 3 hero slaydı `bgType: "image"` + geçerli `bgMedia.url` taşıyor (admin API).
  const sliderId = await getEcommerceProSliderId(adminToken);
  const slider = await getSlider(adminToken, sliderId);
  const heroSlides = [...slider.slides].sort((a, b) => a.order - b.order);
  expect(heroSlides.length).toBe(3);

  for (const slide of heroSlides) {
    expect(slide.bgType).toBe("image");
    const bgMedia = slide.bgMedia as { url?: string } | null | undefined;
    expect(bgMedia?.url, `slayt "${slide.label}" bgMedia.url taşımalı`).toBeTruthy();

    // Backend'in servis ettiği gerçek dosya HTTP 200 + `image/*` content-type ile dönüyor mu —
    // eski `bgType: "gradient"` regresyonunda bu URL hiç YOKTU (bgMedia null idi).
    const mediaRes = await fetch(bgMedia!.url as string);
    expect(mediaRes.status, `bgMedia.url beklenen 200: ${bgMedia!.url}`).toBe(200);
    expect(mediaRes.headers.get("content-type") ?? "").toMatch(/^image\//);
  }

  // Fix 2 — kök `/` VE kendi slug'ı (`/anasayfa`) ÜZERİNDEN ziyaret: page-header/H1 "Ana Sayfa"
  // İKİSİNDE DE render EDİLMİYOR (kök route'la tutarlı), slider doğrudan üstte + arka plan görsel
  // tarayıcıda GERÇEKTEN yükleniyor (naturalWidth > 0) + Fix 3 okunabilirlik gradyanı DOM'da.
  //
  // qa-agent BULGUSU (frontend-agent'a raporlanmalı, bkz. final özet) — `[slug]/page.tsx`teki
  // `isHomePage = page.id === settings.homePageId` hesaplaması `fetchPageBySlugServer` VE
  // `fetchSiteSettingsServer`in (ikisi de BAĞIMSIZ `next:{revalidate:60}` önbellekli, `Promise.all`
  // ile PARALEL) İKİ AYRI fetch'ine dayanır. Bir sayfa YENİ ana sayfa yapıldıktan SONRA o sayfanın
  // KENDİ slug route'una gelen tarayıcı-soğuk (bu Next.js instance'ında o route'a İLK KEZ gelen)
  // istekte GÖZLEMLENEN (yeniden üretilebilir ama DETERMİNİSTİK DEĞİL — bazı soğuk denemelerde
  // OLUŞMUYOR) bir yarış durumu var: `PageHeader` ("Ana Sayfa" H1) bir SONRAKİ (aynı route'a
  // gelen) istekte HER ZAMAN kendiliğinden düzeliyor/kayboluyor — kalıcı bir REGRESYON değil, geçici
  // bir tutarlılık penceresi. Bu yüzden (proje hafızası "60s staleness — eventual consistency, poll
  // +reload ile ele alınır, reaktif FIX YAPILMAZ" ile AYNI felsefe) her iki assertion da (H1
  // YOKLUĞU DAHİL) `toPass` içine, HER denemede `reload` ile alınır — tek seferlik `goto` bu
  // geçici pencereyi YANLIŞLIKLA bir test hatası olarak raporlayabilir.
  for (const homePath of ["/", `/${HOME_PAGE_SLUG}`]) {
    await expect(async () => {
      await page.goto(`${FRONTEND_URL}${homePath}`, { waitUntil: "domcontentloaded" });
      await expect(page.getByRole("heading", { name: "Evinize Yeni Bir Karakter Katın" })).toBeVisible({ timeout: 5_000 });
      await expect(page.getByRole("heading", { name: "Ana Sayfa", exact: true })).not.toBeVisible();
    }).toPass({ timeout: 70_000, intervals: [2_000, 5_000, 10_000] });

    const heroImg = page.locator(".advanced-slider img").first();
    await expect(heroImg).toBeVisible();
    await expect
      .poll(async () => heroImg.evaluate((el: HTMLImageElement) => el.naturalWidth), {
        message: `${homePath} — hero <img> naturalWidth > 0 olmalı (görsel GERÇEKTEN yüklenmeli)`,
        timeout: 15_000,
      })
      .toBeGreaterThan(0);

    // Fix 3 — `bgType: "image"` iken HER ZAMAN render edilen okunabilirlik gradyanı.
    await expect(page.locator(".advanced-slider .bg-gradient-to-r")).toHaveCount(heroSlides.length);
  }

  // Regresyon kontrolü — normal (ana sayfa OLMAYAN) bir sayfanın slug route'unda page-header HÂLÂ
  // NORMAL ŞEKİLDE render ediliyor (Fix 2 SADECE ana sayfayı etkilemeli). Aynı importun ürettiği
  // yasal yer tutucu sayfalardan biri (`kvkk-aydinlatma-metni`) kullanılır.
  await page.goto(`${FRONTEND_URL}/kvkk-aydinlatma-metni`);
  await expect(page.getByRole("heading", { name: "KVKK Aydınlatma Metni", level: 1 })).toBeVisible({ timeout: 15_000 });
});

test("madde 9a: aynı şablonu tekrar uygula (force olmadan) → 409 (idempotency)", async () => {
  const res = await importDemoTemplateRaw(adminToken, ECOMMERCE_TEMPLATE_KEY, { confirm: true, force: false });
  expect(res.status).toBe(409);
  expect(res.error?.code).toBe("CONFLICT");
});

test("madde 9b: confirm gönderilmeden POST → 422", async () => {
  const res = await importDemoTemplateRaw(adminToken, ECOMMERCE_TEMPLATE_KEY, { force: false });
  expect(res.status).toBe(422);
  expect(res.error?.code).toBe("VALIDATION_ERROR");
});

test("SKU-benzersizleştirme: force:true ile İKİNCİ import → 201, ürün/varyant SKU'ları '-2' son ekiyle otomatik benzersizleştirilir (bugfix doğrulaması)", async () => {
  test.setTimeout(60_000);
  // DELTA karşılaştırılır (mutlak sayı DEĞİL) — paylaşımlı `saas_e2e` DB'nin `audit_logs` tablosu
  // önceki koşumlardan kalan SUCCESS satırları barındırabilir; bu test yalnızca BU çağrının YENİ
  // bir başarılı satır ÜRETTİĞİNİ doğrular (fix ÖNCESİ: P2002 → transaction geri alınıyor, YENİ
  // bir SUCCESS satırı HİÇ üretilmiyordu).
  const logsBefore = await listAuditLogsRaw(adminToken, { action: "demo_template.import", limit: 20 });
  const successCountBefore = logsBefore.filter(
    (l) => l.status === "SUCCESS" && (l.metadata as Record<string, unknown> | null)?.templateKey === ECOMMERCE_TEMPLATE_KEY
  ).length;

  const res = await importDemoTemplateRaw(adminToken, ECOMMERCE_TEMPLATE_KEY, { confirm: true, force: true });

  // Bugfix doğrulaması — `importer.ts::resolveSlugPlan` artık `Product.sku`/`ProductVariant.sku`'yu
  // `findAvailableSku` ile slug'lar İLE AYNI desende (`-2`/`-3` son eki) otomatik benzersizleştiriyor;
  // P2002 artık FIRLATILMIYOR, transaction BAŞARIYLA commit ediliyor (201, ham 500/409 YOK).
  expect(res.status).toBe(201);
  const result = res.data as { pageId: string; pageSlug: string; warnings: string[] };
  expect(result.pageId).not.toBe(firstImportPageId);

  expect(result.warnings).toContain(
    "Şablon daha önce uygulanmıştı; `force` ile ikinci bir kopya oluşturuldu. Önceki içerik SİLİNMEDİ."
  );

  // Ürün SKU'ları — şablonun 8 ürününün TAMAMI `sku` taşır (bkz. `templates/ecommerce-pro.ts`) ve
  // ilk import'ta zaten kullanılmış durumdadır; bu yüzden TAMAMI "-2" son ekiyle benzersizleştirilir.
  // Tek bir örnek TAM METİN olarak, kalanı desen + sayı ile doğrulanır (23 ayrı literal SKU'yu
  // tek tek yazmak kırılgan/gereksiz tekrar olurdu).
  expect(result.warnings).toContain('"DEMO-AYD-001" SKU\'su zaten kullanılıyordu, ürün "DEMO-AYD-001-2" SKU\'suyla oluşturuldu.');
  const productSkuWarnings = result.warnings.filter((w) => w.includes("SKU'su zaten kullanılıyordu, ürün "));
  expect(productSkuWarnings).toHaveLength(8);
  expect(productSkuWarnings.every((w) => /^"[^"]+" SKU'su zaten kullanılıyordu, ürün "[^"]+-2" SKU'suyla oluşturuldu\.$/.test(w))).toBe(
    true
  );

  // Varyant SKU'ları — 14 varyantın (EXPECTED_COMMERCE_COUNTS.productVariants) TAMAMI `sku` taşır,
  // AYNI şekilde "-2" son ekiyle benzersizleştirilir.
  expect(result.warnings).toContain(
    '"DEMO-AYD-001-SIY" SKU\'su zaten kullanılıyordu, varyant "DEMO-AYD-001-SIY-2" SKU\'suyla oluşturuldu.'
  );
  const variantSkuWarnings = result.warnings.filter((w) => w.includes("SKU'su zaten kullanılıyordu, varyant "));
  expect(variantSkuWarnings).toHaveLength(14);
  expect(
    variantSkuWarnings.every((w) => /^"[^"]+" SKU'su zaten kullanılıyordu, varyant "[^"]+-2" SKU'suyla oluşturuldu\.$/.test(w))
  ).toBe(true);

  // Audit log — bu çağrı YENİ (ikinci) bir SUCCESS satırı üretti (yeni `pageId` hedefli);
  // `commerceCounts` ilk import İLE AYNI şekle sahip (ikinci kopya da 8 ürün+4 kategori+14
  // varyasyon+4 döküman üretti — hiçbir satır SKU çakışması yüzünden "kayıp" gitmedi).
  const logsAfter = await listAuditLogsRaw(adminToken, { action: "demo_template.import", limit: 20 });
  const successEntriesAfter = logsAfter.filter(
    (l) => l.status === "SUCCESS" && (l.metadata as Record<string, unknown> | null)?.templateKey === ECOMMERCE_TEMPLATE_KEY
  );
  expect(successEntriesAfter.length).toBe(successCountBefore + 1);
  const entry = successEntriesAfter.find((l) => l.targetId === result.pageId);
  expect(entry).toBeTruthy();
  expect((entry!.metadata as Record<string, unknown>).commerceCounts).toEqual(EXPECTED_COMMERCE_COUNTS);
});

test("madde 8: products modülü kapalıyken (temiz zeminde) import → 201 + 'Ürünler modülü kapalı' + yasal sayfa uyarıları", async () => {
  test.setTimeout(60_000);
  // Önceki testlerin (madde 7 + Fix 1/2/3 + SKU-benzersizleştirme testinin ürettiği İKİNCİ kopya)
  // bıraktığı TÜM içerik TEMİZLENİR — aksi halde bu çağrı da (force:false, bu kez BİLEREK) idempotency
  // 409'una düşer; `purgeKnownEcommerceProContent` hem içeriği hem idempotency işaretini sıfırlar.
  // `matchesKnownSlug`/`deleteKnownProductsSql` regex'leri "-N" son ekli (force ile üretilmiş) satırları
  // da kapsadığı için SKU-benzersizleştirme testinin ürettiği "-2" kopyası da burada temizlenir.
  await purgeKnownEcommerceProContent(adminToken);
  await patchSiteModule(adminToken, "products", false);
  try {
    const res = await importDemoTemplateRaw(adminToken, ECOMMERCE_TEMPLATE_KEY, { confirm: true, force: false });
    expect(res.status).toBe(201);
    const result = res.data as { pageId: string; warnings: string[] };
    expect(result.warnings).toContain(
      "Ürünler modülü kapalı olduğu için içe aktarılan ürünler sitede görünmeyecek. /admin/modules üzerinden açabilirsiniz."
    );
    expect(result.warnings).toContain("4 yasal sayfa YER TUTUCU olarak oluşturuldu; yayına almadan önce içeriklerini doldurun.");

    const logs = await listAuditLogsRaw(adminToken, { action: "demo_template.import", limit: 20 });
    const entry = logs.find((l) => l.targetId === result.pageId && l.status === "SUCCESS");
    expect((entry?.metadata as Record<string, unknown> | undefined)?.commerceCounts).toEqual(EXPECTED_COMMERCE_COUNTS);
  } finally {
    await patchSiteModule(adminToken, "products", true);
  }
});

test("madde 9c: RBAC — MANAGER/EDITOR GET görür ama POST 403; USER POST 403", async () => {
  test.setTimeout(90_000);
  await new Promise((resolve) => setTimeout(resolve, RATE_LIMIT_WINDOW_RESET_MS));

  const managerGet = await getDemoTemplatesRaw(managerToken);
  expect(managerGet.status).toBe(200);
  expect(managerGet.data?.find((t) => t.key === ECOMMERCE_TEMPLATE_KEY)).toBeTruthy();

  const managerPost = await importDemoTemplateRaw(managerToken, ECOMMERCE_TEMPLATE_KEY, { confirm: true, force: true });
  expect(managerPost.status).toBe(403);

  const editorGet = await getDemoTemplatesRaw(editorToken);
  expect(editorGet.status).toBe(200);
  const editorPost = await importDemoTemplateRaw(editorToken, ECOMMERCE_TEMPLATE_KEY, { confirm: true, force: true });
  expect(editorPost.status).toBe(403);

  const userGet = await getDemoTemplatesRaw(lowPrivToken);
  expect(userGet.status).toBe(403);
  const userPost = await importDemoTemplateRaw(lowPrivToken, ECOMMERCE_TEMPLATE_KEY, { confirm: true, force: true });
  expect(userPost.status).toBe(403);
});
