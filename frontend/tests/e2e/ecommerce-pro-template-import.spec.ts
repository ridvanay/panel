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

/** İki kutunun 2 BOYUTLU (x VE y) olarak kesişip kesişmediğini kontrol eder — `expectNoVerticalOverlap`
 *  (yalnızca dikey/aynı-sütun istifleme varsayar) İLE KARIŞTIRILMAZ: koordinatörün istediği "CTA
 *  butonu alt kontrol çubuğuna (ilerleme çubuğu/bültenler/oynat-duraklat) BİNİYOR mu" kontrolü, bu
 *  öğeler AYNI sütunda DEĞİL (buton `xPercent:8` ile SOLA yaslı, kontroller ORTA/SAĞA yaslı) —
 *  gerçek bir görsel çakışma yalnızca HEM x HEM y aralıkları kesişirse oluşur. */
function expectNoBoxOverlap(
  boxA: { x: number; y: number; width: number; height: number },
  boxB: { x: number; y: number; width: number; height: number },
  label: string
) {
  const xOverlap = boxA.x < boxB.x + boxB.width && boxB.x < boxA.x + boxA.width;
  const yOverlap = boxA.y < boxB.y + boxB.height && boxB.y < boxA.y + boxA.height;
  expect(xOverlap && yOverlap, label).toBe(false);
}

/** Bir katmanın diğerinin ALTINDA olduğunu (dikey olarak) doğrular — hangisinin üstte olduğu
 *  ÖNCEDEN VARSAYILMAZ (iki kutu da argüman sırasından BAĞIMSIZ karşılaştırılır), yalnızca üstteki
 *  kutunun alt kenarının alttaki kutunun üst kenarını AŞMADIĞI (birkaç px toleransla) kontrol edilir. */
function expectNoVerticalOverlap(
  boxA: { y: number; height: number },
  boxB: { y: number; height: number },
  label: string
) {
  const OVERLAP_TOLERANCE_PX = 2;
  const [upper, lower] = boxA.y <= boxB.y ? [boxA, boxB] : [boxB, boxA];
  expect(upper.y + upper.height, label).toBeLessThanOrEqual(lower.y + OVERLAP_TOLERANCE_PX);
}

/**
 * qa-agent — Fix 1 (hero katmanı rozet/başlık üst üste binmesi, backend-agent fix'i) regresyon
 * testi. `buildHeroLayers` (`templates/ecommerce-pro.ts` ~satır 34-122) artık tablet/mobilde
 * (`resolve-responsive.ts::TABLET_QUERY`/`MOBILE_QUERY` İLE AYNI eşikler, ≤1023px/≤767px) rozet/
 * başlık/metin/buton için `responsive.tablet`/`responsive.mobile` override'ları (küçük fontSize,
 * geniş widthPercent, kademeli yPercent boşluğu) taşıyor — fix ÖNCESİ sarmalanan (2-3 satırlı)
 * başlık kutusu üstteki rozete BİNİYORDU (her katman bağımsız `origin: "bottom-left"` ile
 * konumlandığı için). Bu test "Fix 1/2/3" testinin ÜRETTİĞİ import'un HÂLÂ ayakta olduğu
 * PENCEREDE (madde 8'in purge'ına KADAR) çalışır — YENİ bir import ÇAĞRISI YAPMAZ (rate-limit
 * bütçesi zaten dolu, bkz. dosya başlığı).
 *
 * Katman animasyonlarının ölçümü NASIL deterministik hale getirildiği için (framer-motion +
 * `prefers-reduced-motion` etkileşimindeki iki AYRI bulgu dahil) test gövdesindeki YORUMLARA bkz.
 */
test("Fix 1 regresyon: hero katmanları (rozet/başlık/metin/buton) desktop/tablet/mobilde DİKEY ÇAKIŞMIYOR", async ({
  page,
}) => {
  test.setTimeout(90_000);

  // qa-agent BULGUSU #1 (frontend-agent'a raporlanmalı, bkz. final qa-agent özeti) —
  // `page.emulateMedia({ reducedMotion: "reduce" })` (framer-motion animasyonlarını sıfır süreye
  // indirmenin "doğru" yolu) BİLEREK KULLANILMIYOR: bu bayrak SSR (her zaman `reducedMotion=false`
  // varsayar) İLE istemcinin (`emulateMedia` sayesinde ANINDA `true` okuyan) hydration
  // ANLAŞMAZLIĞINA yol açıyor — React bu stil çakışmasını "won't be patched up" diye loglayıp
  // VAZGEÇİYOR, framer-motion'ın kendi imperatif motion-value sistemi de yalnızca `animate`
  // nesnesinde AÇIKÇA listelenen alanları (`slide-layer.tsx`teki `reducedMotion ? {opacity:1} : ...`
  // dalında SADECE `opacity`) hedef değere getiriyor — `y`/`x`/`scale`/`rotateX` GİBİ giriş-efekti
  // offset'leri (`lib/sliders/layer-render.ts::IN_EFFECT_VARIANTS`teki `y:28` vb.) HİÇBİR ZAMAN
  // sıfırlanmıyor, katman KALICI olarak `translateY(28px)` gibi bir hizalama hatasıyla KALIYOR.
  // Yani `prefers-reduced-motion: reduce` ayarlı GERÇEK bir kullanıcı, hero katmanlarını HER SAYFA
  // yüklemesinde bu kalıcı ofsetle görür — bu ayrı, gerçek bir a11y regresyonu (BU görevin
  // kapsamındaki Fix 1/Fix 2 İLE İLGİSİZ, doğrulama sırasında rastlanmıştır).
  //
  // qa-agent BULGUSU #2 — sabit bir `waitForTimeout` (animasyon süre sabitlerine dayalı, "en geç
  // katman oturur" varsayımıyla) DA yeterli DEĞİL: Next dev sunucusunda React'in geliştirme-modu
  // çift-effect-çalıştırması (StrictMode) framer-motion'ın imperatif animasyon zamanlayıcılarını
  // ARA SIRA yeniden tetikleyip katmanın GEÇİCİ ofsetli konumda "asılı" kalmasına yol açabiliyor —
  // bu YALNIZCA dev sunucusunda (bu e2e paketinin ÇALIŞTIĞI mod, bkz. `playwright.config.ts`
  // `webServer.command`) gözlemlenen, KARARSIZ (aynı kod/viewport'ta bazen geçen bazen `~90px`lik
  // sahte bir çakışma ölçen) bir davranış — proje kuralı "flaky testi tolere etme, kaynağını
  // düzelt" gereği sabit bekleme YERİNE aşağıdaki DETERMİNİSTİK yol seçildi.
  //
  // Çözüm — `page.addInitScript` ile HER navigasyondan ÖNCE enjekte edilen bir `<style>` katmanın
  // KENDİ animasyon durumundan (framer-motion'ın `style` özniteliğine yazdığı `opacity`/`transform`)
  // BAĞIMSIZ olarak nihai (`animate` hedefindeki) görsel durumu `!important` ile ZORLAR — CSS
  // cascade'de yazar sayfasındaki `!important` kural satır-içi (`style=`) özniteliği YENER. Bu,
  // "animasyonun bitmesini beklemek" yerine "animasyon HİÇ olmamış gibi nihai duruma anında geç"
  // anlamına gelir — ölçülen, backend-agent'ın Fix 1'inde tanımladığı STATİK `yPercent`/`widthPercent`
  // yerleşimidir, framer-motion'ın (bu görevin kapsamı DIŞINDAki) zamanlama/StrictMode
  // davranışından TAMAMEN izole.
  await page.addInitScript(() => {
    const style = document.createElement("style");
    // qa-agent DÜZELTMESİ — İLK sürüm `.advanced-slider .absolute > div` kullanıyordu, ama bu
    // hem HEDEFLENEN iç `motion.div`i (animasyon: opacity/transform) HEM DE `slide-layer.tsx`teki
    // DIŞ katman konumlandırma sarmalayıcısını (`<div className="absolute" style={{left,top,
    // transform: translate(-origin%) translate(offset)}}>`) EŞLEŞTİRİYORDU — ikisi de sadece "absolute"
    // sınıfını taşıyan bir `div`in DOĞRUDAN ÇOCUĞU (dış sarmalayıcı `SlideStage`teki
    // `motion.div className="absolute inset-0"`nin çocuğu, iç sarmalayıcı YİNE bu dış katman
    // konumlandırma div'inin çocuğu). Sonuç: `transform:none!important` YANLIŞLIKLA katmanın
    // KENDİ statik `origin`-tabanlı konumlandırma transform'unu da SİLİYOR, ölçümleri BOZUYORDU
    // (masaüstünde tesadüfen makul görünen ama aslında yanlış/kaydırılmış sayılar üretti — bkz.
    // final qa-agent özeti). Düzeltme: yalnızca DIŞ katman sarmalayıcısını (`div.absolute`, AMA
    // Tailwind `inset-0` sınıfı OLMAYAN — o yalnızca `SlideStage`in paylaşılan `motion.div`
    // sarmalayıcısında/arka plan/gradyan katmanlarında bulunur) HEDEFLEYİP onun ÇOCUĞUNU
    // (framer-motion'ın animasyonlu `motion.div`i) etkile.
    style.textContent = `
      .advanced-slider div.absolute:not(.inset-0) > div {
        transition: none !important;
        animation: none !important;
        opacity: 1 !important;
        transform: none !important;
      }
    `;
    (document.head ?? document.documentElement).appendChild(style);
  });

  const VIEWPORTS = [
    { name: "desktop", width: 1280, height: 800 },
    { name: "tablet", width: 820, height: 1180 },
    { name: "mobile", width: 390, height: 844 },
  ] as const;

  for (const viewport of VIEWPORTS) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });

    // Aynı 60s eventual-consistency uyarısı ("Fix 1/2/3" testindeki YORUM ile AYNI gerekçe) —
    // `toPass` + `reload` ile alınır, tek seferlik `goto` geçici bir tutarlılık penceresini
    // YANLIŞLIKLA test hatası olarak raporlayabilir.
    await expect(async () => {
      await page.goto(`${FRONTEND_URL}/`, { waitUntil: "domcontentloaded" });
      await expect(page.getByRole("heading", { name: "Evinize Yeni Bir Karakter Katın" })).toBeVisible({ timeout: 5_000 });
    }).toPass({ timeout: 70_000, intervals: [2_000, 5_000, 10_000] });

    // İlk (aktif) hero slaydının dört katmanı — yalnızca AKTİF slaydın katmanları DOM'a yazılır
    // (`SlideStage`teki `AnimatePresence` + `isActive` koşulu), bu yüzden tekil eşleşme garantidir.
    const slider = page.locator(".advanced-slider");
    const badge = slider.getByText("Yeni Sezon", { exact: true });
    const heading = slider.getByRole("heading", { name: "Evinize Yeni Bir Karakter Katın" });
    const text = slider.locator("p", { hasText: "Aydınlatmadan" });
    const button = slider.getByRole("link", { name: "Koleksiyonu Keşfedin" });

    await expect(badge, `[${viewport.name}] rozet görünür olmalı`).toBeVisible();
    await expect(heading, `[${viewport.name}] başlık görünür olmalı`).toBeVisible();
    await expect(text, `[${viewport.name}] metin görünür olmalı`).toBeVisible();
    await expect(button, `[${viewport.name}] buton görünür olmalı`).toBeVisible();

    const [badgeBox, headingBox, textBox, buttonBox] = await Promise.all([
      badge.boundingBox(),
      heading.boundingBox(),
      text.boundingBox(),
      button.boundingBox(),
    ]);
    if (!badgeBox || !headingBox || !textBox || !buttonBox) {
      throw new Error(`[${viewport.name}] hero katmanlarından biri boundingBox() döndürmedi (görünmez/layout dışı olabilir).`);
    }

    // Asıl regresyon kontrolü — fix ÖNCESİ tablet/mobilde sarmalanan başlık kutusu rozete BİNERDİ.
    expectNoVerticalOverlap(badgeBox, headingBox, `[${viewport.name}] rozet/başlık dikey olarak çakışıyor`);
    expectNoVerticalOverlap(headingBox, textBox, `[${viewport.name}] başlık/metin dikey olarak çakışıyor`);
    expectNoVerticalOverlap(textBox, buttonBox, `[${viewport.name}] metin/buton dikey olarak çakışıyor`);

    // Koordinatörün istediği EK kontrol — backend-agent'ın masaüstü düzeltmesi (`button` `yPercent`
    // 91→95) CTA butonunu slider'ın ALT kontrol çubuğuna (bültenler/oynat-duraklat; `showProgressBar:
    // false` olduğu için ilerleme çubuğu YOK) İTMİŞ Mİ — bu, `expectNoVerticalOverlap`İLE
    // YAKALANMAZ (buton `xPercent:8` SOLA yaslı, kontroller ORTA/SAĞA yaslı, aynı sütunda DEĞİLLER),
    // bu yüzden TAM 2 boyutlu kutu kesişimi (`expectNoBoxOverlap`) kullanılır.
    const playPause = slider.getByRole("button", { name: /Otomatik oynatmayı/ });
    const firstBullet = slider.getByRole("button", { name: "1. slayta git" });
    const [playPauseBox, bulletBox] = await Promise.all([playPause.boundingBox(), firstBullet.boundingBox()]);
    if (!playPauseBox || !bulletBox) {
      throw new Error(`[${viewport.name}] alt kontrol çubuğu (oynat-duraklat/bültenler) boundingBox() döndürmedi.`);
    }
    expectNoBoxOverlap(buttonBox, playPauseBox, `[${viewport.name}] CTA butonu oynat/duraklat düğmesine BİNİYOR`);
    expectNoBoxOverlap(buttonBox, bulletBox, `[${viewport.name}] CTA butonu slayt bültenlerine (bullets) BİNİYOR`);
  }
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
  // qa-agent DÜZELTMESİ — `limit:20` DAR sabiti, koordinatörle bu turdaki çok-turlu e2e doğrulama
  // koşumları BİRİKTİKÇE (paylaşımlı `saas_e2e` DB'nin `audit_logs` geçmişi 20'nin ÇOK ÜSTÜNE
  // çıkınca, bkz. final qa-agent özeti) bu DELTA karşılaştırmasını YANLIŞLIKLA kırdı — pencerenin
  // EN ESKİ ucundaki bir satır YENİ satırla birlikte pencereden DÜŞTÜĞÜNDE `successCountBefore`/
  // `successCountAfter` her ikisi de PENCERE BOYUTUYLA sınırlanıp gerçek delta'yı YANSITMAZ.
  // `limit` cömertçe artırılır (uygulama kodu DEĞİL, yalnızca test sorgusu) — asıl doğrulama zaten
  // aşağıdaki `entry`/`commerceCounts` kontrolleridir, bu sayı yalnızca EK bir sağlık kontrolü.
  const logsBefore = await listAuditLogsRaw(adminToken, { action: "demo_template.import", limit: 100 });
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
  const logsAfter = await listAuditLogsRaw(adminToken, { action: "demo_template.import", limit: 100 });
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
