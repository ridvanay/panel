import { test, expect, type Page } from "@playwright/test";
import {
  getCachedAdminSession,
  getFixtureUserToken,
  createPage as createPageFixture,
  deletePagePermanently,
  getPage,
  getAdminSettings,
  getSiteModules,
  patchSiteModule,
} from "./support/api";
import { createAuthenticatedPage } from "./support/admin-session";
import { adminGetUserByEmail, adminUpdateRole, resetFixtureUserToBaseline } from "./support/admin-users-fixtures";
import { permanentDeleteSlider } from "./support/sliders-fixtures";
import {
  DEMO_TEMPLATE_KEY,
  KNOWN_ASSET_FILENAMES,
  getDemoTemplatesRaw,
  importDemoTemplateRaw,
  listAllAdminMediaIds,
  listAuditLogsRaw,
  resetDemoTemplateImportRow,
  purgeKnownDemoTemplateContent,
} from "./support/demo-templates-fixtures";

/**
 * qa-agent — `.claude/architect-scope-demo-template-import.md` §12 "QA kapsamı" madde 6-14
 * (bağlayıcı karar dokümanı, özellikle §6 API sözleşmesi, §6.1 yıkıcılık matrisi, §6.4
 * idempotency/force). Backend'in kendi birim testleri (`backend/tests/unit/demo-templates-
 * importer.test.ts`, `demo-templates-schema.test.ts`) şablonun Zod doğrulamasını ve Faz 2 telafi
 * (rollback) davranışını ZATEN kapsıyor — BURADA TEKRARLANMAZ. Bu dosya gerçek tarayıcı + gerçek
 * backend + gerçek Postgres (`saas_e2e`) üzerinden "ADMIN düğmeye basar → gerçek POST → gerçek
 * transaction → tabloya/DOM'a/public siteye yansıma" zincirini kapatır — mock YOK.
 *
 * ============================================================================================
 * HIZ SINIRI İZOLASYONU (KRİTİK — bu dosyanın test SIRASI bilinçli olarak bu yüzden budur):
 * `POST /admin/demo-templates/{key}/import` route-seviyesinde `{ max: 5, timeWindow: "1 minute" }`
 * ile sınırlıdır (`demo-templates.routes.ts::DEMO_TEMPLATE_IMPORT_RATE_LIMIT`) ve `@fastify/
 * rate-limit`'in route-level `config.rateLimit`'i VARSAYILAN olarak `onRequest` aşamasında çalışır
 * (bkz. `node_modules/@fastify/rate-limit/index.js` `defaultHook = 'onRequest'`) — yani
 * `authenticate`/RBAC/body-doğrulama preHandler/preValidation aşamalarından ÖNCE devreye girer VE
 * varsayılan `keyGenerator` (`request.ip`) İLE, bu dosyadaki TÜM isteklerin (hangi kullanıcı/token
 * olursa olsun, hatta tokensız istekler DAHİL) AYNI sayaca yazdığı anlamına gelir. Bu suite'in bu
 * rotaya yaptığı TOPLAM gerçek çağrı sayısı (6/7/8/9/10/12 senaryoları) 5'i AŞAR — bu yüzden:
 *  1) Madde 13 (hız sınırı) EN BAŞTA, tamamen izole (kimlik doğrulaması OLMAYAN, içerik ÜRETMEYEN
 *     6 istekle) çalıştırılır — diğer senaryoların gerçek import çağrılarıyla ASLA karışmaz.
 *  2) O 6 istek sonrası pencerenin TAMAMEN sıfırlanmasını beklemek için açık bir bekleme vardır.
 *  3) 6/7/8/9 senaryoları (4 gerçek çağrı) TEK pencerede gruplanır; 10/12 (3 gerçek çağrı) başka
 *     bir bekleme sonrası İKİNCİ bir pencerede gruplanır — hiçbir grup 5'i aşmaz.
 * (`.claude/CLAUDE.md` madde 3 — flaky testleri tolere etme, kaynağını bul ve düzelt/izole et.)
 * ============================================================================================
 */
test.describe.configure({ mode: "serial" });

const RUN_SUFFIX = Date.now().toString(36);
const MANAGER_EMAIL = `qa-e2e-demo-tpl-manager-${RUN_SUFFIX}@example.com`;
const EDITOR_EMAIL = `qa-e2e-demo-tpl-editor-${RUN_SUFFIX}@example.com`;
const LOW_PRIV_EMAIL = `qa-e2e-demo-tpl-user-${RUN_SUFFIX}@example.com`;
const FIXTURE_PASSWORD = "QaE2eDemoTpl12345!";

// Rate-limit penceresinin (1 dakika) TAM olarak sıfırlanmasını garanti etmek için küçük bir pay
// bırakılır — `site-home-layout-parity.spec.ts`teki `revalidate:60` toleransıyla AYNI felsefe.
const RATE_LIMIT_WINDOW_RESET_MS = 65_000;

let adminToken: string;
let adminEmail: string;
let adminPage: Page;
let closeAdminSession: () => Promise<void>;

let managerToken: string;
let editorToken: string;
let lowPrivToken: string;

let initialPortfolioModuleEnabled: boolean;

// madde 6 sonuçları — sonraki senaryolar (7/8/11/14) bunlara göreli olarak doğrular.
let firstImportPageId: string;
let firstImportPageSlug: string;
let firstImportSliderId: string | null = null;
let firstImportedAt: string;
let firstImportMediaIds: string[] = [];
let beforeFirstImportHomePageId: string | null = null;

// madde 8 (force) sonuçları.
let forcedImportPageId: string;
let forcedImportSliderId: string | null = null;

// madde 12 (portfolio modülü kapalı, force) sonuçları.
let moduleOffImportPageId: string;
let moduleOffImportSliderId: string | null = null;

function importUrlMatcher(res: { url: () => string; request: () => { method: () => string } }): boolean {
  return res.url().includes(`/admin/demo-templates/${DEMO_TEMPLATE_KEY}/import`) && res.request().method() === "POST";
}

/**
 * qa-agent BULGUSU (bu turda düzeltildi, kendi test-dosyası bakım sorumluluğu — bkz.
 * `.claude/CLAUDE.md` qa-agent alanı) — `ecommerce-pro` demo şablonu registry'ye EKLENDİKTEN
 * SONRA `/admin/demo-templates` sayfasında artık BİRDEN FAZLA şablon kartı var; kart içi
 * "Uygula"/"Yeniden Uygula" düğmesi ve "Uygulandı" rozeti sayfa GENELİNDE (`adminPage.getByRole(...)`
 * / `adminPage.getByText(...)`) aranırsa, `ecommerce-pro` da AYNI durumda (uygulanmamış/uygulanmış)
 * olduğunda `strict mode violation` (2 eşleşme) ile İKİ template'in state'i birbirine KARIŞIR —
 * paylaşımlı `saas_e2e` DB'de hangi şablonun hangi sırada/durumda olduğu bu dosyanın KONTROLÜ
 * DIŞINDA (ör. `ecommerce-pro-template-import.spec.ts`'in kendi `afterAll`'ı `ecommerce-pro`'yu
 * HER ZAMAN "uygulanmamış" durumuna sıfırlar). Bu yüzden kart-içi doğrulamalar `.claude/CLAUDE.md`
 * madde 3 (flaky kaynağını bul, düzelt) gereği `demo-templates-view.tsx`teki `Card` bileşeninin
 * (`className="flex h-full flex-col overflow-hidden p-0"`) `hasText` ile "Modern Mimarlık & İnşaat"a
 * DARALTILMIŞ örneğine (bu dosyanın TEK ilgilendiği şablon) SCOPE edilir.
 */
function modernArchitectureCard(page: Page) {
  return page.locator(".flex.h-full.flex-col.overflow-hidden.p-0").filter({ hasText: "Modern Mimarlık & İnşaat" });
}

test.beforeAll(async ({ browser }, testInfo) => {
  testInfo.setTimeout(120_000);
  const session = await getCachedAdminSession();
  adminToken = session.accessToken;
  adminEmail = session.email;

  // Temiz zemin — önceki (muhtemelen yarım kalmış) bir koşumdan kalan idempotency işaretini
  // sıfırlar (§6.4 — `demo_template_imports.templateKey` @unique). İçerik satırları (sayfa/
  // slider/portföy/medya) BURADA silinmez: `afterAll` bu koşumun ÜRETTİĞİ id'lerle hedefe yönelik
  // temizler; slug/sayı iddiaları da HER ZAMAN madde 6'nın DÖNDÜRDÜĞÜ göreli slug'a göre yapılır
  // (mutlak "anasayfa" DEĞİL) — bu yüzden olası eski bir çöp bile doğruluğu bozmaz.
  resetDemoTemplateImportRow(DEMO_TEMPLATE_KEY);

  const modules = await getSiteModules(adminToken);
  initialPortfolioModuleEnabled = (modules.find((m) => m.key === "portfolio")?.enabled as boolean | undefined) ?? true;
  if (!initialPortfolioModuleEnabled) await patchSiteModule(adminToken, "portfolio", true);

  ({ page: adminPage, close: closeAdminSession } = await createAuthenticatedPage(browser));

  // §7.1 — her biri ÇALIŞTIRMA-BAŞINA-BENZERSİZ e-postayla, `getFixtureUserToken()`'ın kendi
  // `/auth/register`'ı DOĞRUDAN 201 döner (409→login fallback'i TETİKLENMEZ) — `AUTH_RATE_LIMIT`
  // (5/dk) bütçesini `admin-page-editor-roles.spec.ts`teki AYNI gerekçeyle en aza indirir.
  managerToken = await getFixtureUserToken(MANAGER_EMAIL, FIXTURE_PASSWORD, "QA E2E Demo Template Manager");
  const managerUser = await adminGetUserByEmail(adminToken, MANAGER_EMAIL);
  if (!managerUser) throw new Error("Fixture MANAGER kullanıcısı oluşturulamadı.");
  await adminUpdateRole(adminToken, managerUser.id, "MANAGER");

  editorToken = await getFixtureUserToken(EDITOR_EMAIL, FIXTURE_PASSWORD, "QA E2E Demo Template Editor");
  const editorUser = await adminGetUserByEmail(adminToken, EDITOR_EMAIL);
  if (!editorUser) throw new Error("Fixture EDITOR kullanıcısı oluşturulamadı.");
  await adminUpdateRole(adminToken, editorUser.id, "EDITOR");

  // Kayıt sonrası varsayılan zaten USER'dır (§7.1) — bu kullanıcı madde 10'da hem USER hem
  // CUSTOMER kontrolü için YENİDEN KULLANILIR (`adminUpdateRole` ile rol arası geçiş yapılır;
  // `authenticate.ts` rolü HER İSTEKTE DB'den TAZE okur, token'a gömmez — bkz. o dosya, bu yüzden
  // aynı token her iki rol altında da geçerlidir, ekstra bir kayıt/login GEREKMEZ).
  lowPrivToken = await getFixtureUserToken(LOW_PRIV_EMAIL, FIXTURE_PASSWORD, "QA E2E Demo Template User");
});

test.afterAll(async () => {
  if (closeAdminSession) await closeAdminSession();

  for (const pageId of [firstImportPageId, forcedImportPageId, moduleOffImportPageId]) {
    if (pageId) await deletePagePermanently(adminToken, pageId);
  }
  for (const sliderId of [firstImportSliderId, forcedImportSliderId, moduleOffImportSliderId]) {
    if (sliderId) await permanentDeleteSlider(adminToken, sliderId);
  }
  await purgeKnownDemoTemplateContent(adminToken).catch(() => undefined);
  await patchSiteModule(adminToken, "portfolio", initialPortfolioModuleEnabled).catch(() => undefined);

  await resetFixtureUserToBaseline(adminToken, MANAGER_EMAIL).catch(() => undefined);
  await resetFixtureUserToBaseline(adminToken, EDITOR_EMAIL).catch(() => undefined);
  await resetFixtureUserToBaseline(adminToken, LOW_PRIV_EMAIL).catch(() => undefined);
});

test("madde 13: hız sınırı — 6. istek 429 döner", async () => {
  test.setTimeout(90_000);
  // Bkz. dosya başlığı — kimlik doğrulaması/gövde BİLİNÇLİ OLARAK verilmiyor: rate-limit onRequest
  // aşamasında, auth/RBAC/body-doğrulamadan ÖNCE çalışır; bu test yalnızca İSTEK SAYISINI test eder.
  const statuses: number[] = [];
  for (let i = 0; i < 6; i++) {
    const res = await importDemoTemplateRaw(null, DEMO_TEMPLATE_KEY, undefined);
    statuses.push(res.status);
  }
  expect(statuses.slice(0, 5)).not.toContain(429);
  expect(statuses[5]).toBe(429);

  // Sonraki senaryolar (6/7/8/9) AYNI rotaya GERÇEK istek gönderecek — pencere sıfırlanmadan
  // devam edilirse YANLIŞLIKLA 429 alırlar (bkz. dosya başlığı).
  await new Promise((resolve) => setTimeout(resolve, RATE_LIMIT_WINDOW_RESET_MS));
});

test("madde 6: ADMIN olarak uygula → 201, ana sayfa şablonun sayfası olur, public '/' yeni içeriği gösterir", async ({ page }) => {
  test.setTimeout(120_000);

  const beforeSettings = await getAdminSettings(adminToken);
  beforeFirstImportHomePageId = (beforeSettings.homePageId as string | null) ?? null;
  const mediaBefore = await listAllAdminMediaIds(adminToken);

  await adminPage.goto("/admin/demo-templates");
  await expect(adminPage.getByRole("heading", { name: "Modern Mimarlık & İnşaat" })).toBeVisible({ timeout: 15_000 });
  // Temiz zemin (`beforeAll` idempotency satırını sıfırladı) → kart "Uygula" gösterir, henüz
  // "Uygulandı" rozeti/"Yeniden Uygula" YOK. Kart-scope'lu (bkz. `modernArchitectureCard` başlığı) —
  // `ecommerce-pro` kartının KENDİ (bu dosyanın kontrolü DIŞINDaki) durumundan ETKİLENMEZ.
  const card = modernArchitectureCard(adminPage);
  await expect(card.getByText("Uygulandı", { exact: true })).toHaveCount(0);
  await card.getByRole("button", { name: "Uygula", exact: true }).click();

  const confirmDialog = adminPage.getByRole("dialog", { name: /şablonunu uygula/ });
  await expect(confirmDialog).toBeVisible();
  // §6.1 yıkıcılık matrisi — bağlayıcı UI kuralı, madde madde gösterilir.
  await expect(confirmDialog.getByText(/Navigasyon menünüz.*renkleriniz SİLİNİP/)).toBeVisible();

  const [response] = await Promise.all([
    adminPage.waitForResponse(importUrlMatcher),
    confirmDialog.getByRole("button", { name: "Uygula" }).click(),
  ]);
  expect(response.status()).toBe(201);
  const body = (await response.json()) as { data: Record<string, unknown> };
  const result = body.data as {
    pageId: string;
    pageSlug: string;
    sliderId: string | null;
    importedAt: string;
    counts: { media: number };
    warnings: string[];
    setAsHomePage?: boolean;
  };

  firstImportPageId = result.pageId;
  firstImportPageSlug = result.pageSlug;
  firstImportSliderId = result.sliderId;
  firstImportedAt = result.importedAt;

  expect(result.counts.media).toBe(12);
  // Portföy modülü açık + ilk uygulama → beklenmeyen bir uyarı ÜRETİLMEMELİ (madde 12'nin negatif kontrolü).
  expect(result.warnings).toEqual([]);

  await expect(adminPage.getByRole("dialog", { name: "Şablon uygulandı" })).toBeVisible();
  await adminPage.getByRole("dialog", { name: "Şablon uygulandı" }).getByRole("button", { name: "Tamam" }).click();

  // §4.2 kabul kriteri — Faz 1/2'de yaratılan medya GERÇEK `Media` satırlarıdır (madde 11'in
  // temel verisi burada yakalanır).
  const mediaAfter = await listAllAdminMediaIds(adminToken);
  firstImportMediaIds = [...mediaAfter.keys()].filter((id) => !mediaBefore.has(id));
  expect(firstImportMediaIds.length).toBe(12);
  const newFilenames = firstImportMediaIds.map((id) => mediaAfter.get(id)).sort();
  expect(newFilenames).toEqual([...KNOWN_ASSET_FILENAMES].sort());

  // Ana sayfa ataması (§6.3 varsayılan `setAsHomePage: true`).
  const afterSettings = await getAdminSettings(adminToken);
  expect(afterSettings.homePageId).toBe(firstImportPageId);

  // Public `/` yeni içeriği gösteriyor — `REVALIDATE_SECRET` yapılandırılıysa (bkz. `.env.e2e`)
  // on-demand revalidation neredeyse anında olmalı; ağ/zamanlama varyansına karşı kısa bir poll
  // penceresi bırakılır (`site-home-layout-parity.spec.ts`teki AYNI tolerans felsefesi).
  await expect(async () => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    // Site adı (header) — hangi slayt aktif olursa olsun HER ZAMAN görünür, birincil kanıt.
    await expect(page.getByText("Kütle Yapı", { exact: true }).first()).toBeVisible();
    // İlk slayt (order 0) başlığı — sayfa yeni yüklendiğinde autoplay henüz döndürmemiş olmalı.
    await expect(page.getByRole("heading", { name: "Mekanı Anlamlı Yapıya Dönüştürüyoruz" })).toBeVisible();
  }).toPass({ timeout: 20_000, intervals: [1_000, 2_000, 4_000] });
});

test("madde 14: /admin/logs'ta demo_template.import satırı ve metadata.previousHomePageId mevcut", async () => {
  const logs = await listAuditLogsRaw(adminToken, { action: "demo_template.import", limit: 20 });
  const entry = logs.find((l) => l.targetId === firstImportPageId && l.status === "SUCCESS");
  expect(entry).toBeTruthy();
  expect(entry!.actorEmail).toBe(adminEmail);

  const metadata = entry!.metadata as Record<string, unknown>;
  expect(metadata.templateKey).toBe(DEMO_TEMPLATE_KEY);
  expect(metadata.createdPageId).toBe(firstImportPageId);
  expect(metadata.createdSliderId).toBe(firstImportSliderId);
  // Alan İSTER `null` OLSUN İSTER dolu — asıl kanıt anahtarın MEVCUT olması VE geri alınacak
  // önceki değerle BİREBİR eşleşmesidir (§6.7 — "kullanıcının ana sayfasını geri alabilmesinin
  // tek kaydı").
  expect(Object.prototype.hasOwnProperty.call(metadata, "previousHomePageId")).toBe(true);
  expect(metadata.previousHomePageId).toBe(beforeFirstImportHomePageId);

  // UI kanıtı — `/admin/logs` ekranında satır GÖRÜNÜR (en yeni-önce sıralı, testin kendi isteği
  // son dakikalarda olduğu için ilk sayfada olmalı).
  await adminPage.goto("/admin/logs");
  await expect(adminPage.getByText("demo_template.import").first()).toBeVisible({ timeout: 15_000 });
});

test("madde 7: aynı şablonu tekrar uygula (force olmadan) → 409, importedAt diyalogda görünür", async () => {
  await adminPage.goto("/admin/demo-templates");
  // Kart-scope'lu (bkz. `modernArchitectureCard` başlığı) — `ecommerce-pro` kartı da AYNI anda
  // "uygulanmış" durumda olabilir, sayfa-geneli arama İKİ eşleşmeyle strict-mode ihlaline düşer.
  const card = modernArchitectureCard(adminPage);
  await expect(card.getByRole("button", { name: "Yeniden Uygula" })).toBeVisible({ timeout: 15_000 });
  await expect(card.getByText("Uygulandı", { exact: true })).toBeVisible();
  await card.getByRole("button", { name: "Yeniden Uygula" }).click();

  const confirmDialog = adminPage.getByRole("dialog", { name: /şablonunu uygula/ });
  await expect(confirmDialog).toBeVisible();

  const [response] = await Promise.all([
    adminPage.waitForResponse(importUrlMatcher),
    confirmDialog.getByRole("button", { name: "Uygula" }).click(),
  ]);
  expect(response.status()).toBe(409);
  const body = (await response.json()) as { error: { code: string; details: Record<string, unknown> } };
  expect(body.error.code).toBe("CONFLICT");
  expect(body.error.details.templateKey).toBe(DEMO_TEMPLATE_KEY);
  expect(body.error.details.pageId).toBe(firstImportPageId);
  // Tam ISO eşitliği ARANMAZ (DB `now()` ile istemcinin `new Date().toISOString()`'ı arasında
  // milisaniye farkı olabilir, bkz. `importer.ts` — SUCCESS yanıtı taze `new Date()`, DB satırı
  // KENDİ `now()`'ıdır) — geçerli, madde 6'nınkiyle YAKIN ZAMANLI bir tarih olduğu doğrulanır.
  const conflictImportedAt = new Date(body.error.details.importedAt as string).getTime();
  expect(Number.isNaN(conflictImportedAt)).toBe(false);
  expect(Math.abs(conflictImportedAt - new Date(firstImportedAt).getTime())).toBeLessThan(60_000);

  // §6.4 diyalog kuralı — konflikt diyaloğu `importedAt` içerir.
  const conflictDialog = adminPage.getByRole("dialog", { name: "Şablon zaten uygulanmış" });
  await expect(conflictDialog).toBeVisible();
  await expect(conflictDialog).toContainText("tarihinde");
  await expect(conflictDialog).toContainText("Yine de yeniden uygulansın mı?");
});

test("madde 8: force:true → 201, sayfa slug'ı '-2' ile oluşur, önceki sayfa hâlâ var", async () => {
  const conflictDialog = adminPage.getByRole("dialog", { name: "Şablon zaten uygulanmış" });
  await expect(conflictDialog).toBeVisible();

  const [response] = await Promise.all([
    adminPage.waitForResponse(importUrlMatcher),
    conflictDialog.getByRole("button", { name: "Yine de Yeniden Uygula" }).click(),
  ]);
  expect(response.status()).toBe(201);
  const body = (await response.json()) as { data: Record<string, unknown> };
  const result = body.data as { pageId: string; pageSlug: string; sliderId: string | null; warnings: string[] };

  forcedImportPageId = result.pageId;
  forcedImportSliderId = result.sliderId;

  expect(result.pageId).not.toBe(firstImportPageId);
  expect(result.pageSlug).toBe(`${firstImportPageSlug}-2`);
  expect(result.warnings).toContain(
    "Şablon daha önce uygulanmıştı; `force` ile ikinci bir kopya oluşturuldu. Önceki içerik SİLİNMEDİ."
  );

  await expect(adminPage.getByRole("dialog", { name: "Şablon uygulandı" })).toBeVisible();
  await adminPage.getByRole("dialog", { name: "Şablon uygulandı" }).getByRole("button", { name: "Tamam" }).click();

  // §6.4 bağlayıcı kural — önceki import'un ürettiği sayfa SİLİNMEDİ.
  const previousPage = await getPage(adminToken, firstImportPageId);
  expect(previousPage.deletedAt ?? null).toBeNull();
  expect(previousPage.slug).toBe(firstImportPageSlug);
});

test("madde 9: confirm gönderilmeden POST → 422", async () => {
  const res = await importDemoTemplateRaw(adminToken, DEMO_TEMPLATE_KEY, { force: false });
  expect(res.status).toBe(422);
  expect(res.error?.code).toBe("VALIDATION_ERROR");
});

test("madde 11: import sonrası medya kütüphanesinde 12 yeni görsel var ve medya seçiciyle değiştirilebiliyor", async () => {
  test.setTimeout(60_000);
  // Sayaç zaten madde 6'da doğrulandı — burada AYRICA altText/dosya adı bütünlüğü (§3.2
  // `DemoTemplateAsset.altText` a11y için ZORUNLU) teyit edilir.
  expect(firstImportMediaIds.length).toBe(12);
  const mediaNow = await listAllAdminMediaIds(adminToken);
  for (const id of firstImportMediaIds) {
    expect(mediaNow.has(id)).toBe(true);
  }

  // §4.2 kabul kriteri — kullanıcının İLK işi bu görselleri MediaPicker ile değiştirmektir. Bunu
  // geçici bir sayfa üzerinde bir "Görsel" bloğu ekleyip picker'da arayıp seçerek DOĞRULARIZ
  // (`admin-page-builder-gallery.spec.ts`teki "boş sayfa → konteyner → blok ekle" deseninin AYNISI).
  const tempPage = await createPageFixture(adminToken, {
    title: `QA E2E Demo Template Media Picker ${Date.now()}`,
    slug: `qa-demo-tpl-media-picker-${Date.now()}`,
    html: "<p>gecici</p>",
    status: "DRAFT",
  });

  try {
    await adminPage.goto(`/admin/pages/${tempPage.id}`);
    await expect(adminPage.getByRole("heading", { name: "İçerik blokları" })).toBeVisible({ timeout: 15_000 });
    await adminPage.waitForTimeout(500); // bkz. gallery spec başlığındaki AYNI güvenlik payı notu

    // Fixture'ın çıplak kök `text` bloğu editör yüklenirken kendi konteynerine sarılır — o
    // konteyneri silip TAMAMEN boş bir sayfa bırakılır.
    await expect(adminPage.locator('button[aria-label^="Sürükle: "]')).toHaveCount(2);
    await adminPage.locator('button[aria-label="Konteyneri sil"]').first().click();
    await expect(adminPage.locator('button[aria-label^="Sürükle: "]')).toHaveCount(0);

    await adminPage.getByRole("button", { name: "Yeni Konteyner Ekle" }).click();
    await adminPage.getByRole("button", { name: "Tek Sütun" }).click();
    await adminPage.getByRole("button", { name: "Konteynere blok ekle" }).click();
    await adminPage.getByRole("tab", { name: "Medya & İnteraktif" }).click();
    await adminPage.getByRole("menuitem", { name: "Görsel", exact: true }).click();

    await adminPage.getByRole("button", { name: "Kütüphaneden Seç" }).click();
    await expect(adminPage.getByRole("heading", { name: "Görsel Seç" })).toBeVisible();

    await adminPage.getByLabel("Dosya adına göre ara").fill("cta-banner.jpg");
    // Bu noktada kütüphanede İKİ "cta-banner.jpg" olabilir (madde 6 + madde 8'in `force` kopyası,
    // §6.4 additive kural — ikisi de GEÇERLİ, ayırt etmemiz GEREKMEZ) — `.first()` yeterli.
    const result = adminPage.getByRole("button", { name: /^cta-banner\.jpg/ }).first();
    await expect(result).toBeVisible();
    await result.click();

    await expect(adminPage.getByRole("heading", { name: "Görsel Seç" })).not.toBeVisible();
    // `Media.filename` ("cta-banner.jpg") arama/seçim İÇİN kullanılır (yukarıda doğrulandı — kart
    // GÖRÜNÜR ve TIKLANABİLİR OLDU), ama diskteki depolanmış `url` `storage.save()`'in çakışma-
    // önleyici BENZERSİZ adıdır (`lib/local-storage.ts`) — dosya adını KORUMAZ. Bu yüzden burada
    // yalnızca alanın DOLDUĞU (boştan gerçek bir `/uploads/...` URL'ine geçtiği) doğrulanır.
    const urlField = adminPage.locator('input[placeholder="https://…"]');
    await expect(urlField).not.toHaveValue("");
    await expect(urlField).toHaveValue(/^https?:\/\/.+\/uploads\//);

    await adminPage.getByRole("button", { name: "Kaydet", exact: true }).click();
    await expect(adminPage.getByText("Sayfa kaydedildi.").last()).toBeVisible({ timeout: 10_000 });
  } finally {
    await deletePagePermanently(adminToken, tempPage.id as string);
  }
});

test("madde 10: RBAC — MANAGER/EDITOR GET görür ama POST 403; USER/CUSTOMER GET 403", async () => {
  test.setTimeout(90_000);
  // Bkz. dosya başlığı — bu grup madde 6-9'un pencereyle AYNI dakikada olmaması için önce bekler.
  await new Promise((resolve) => setTimeout(resolve, RATE_LIMIT_WINDOW_RESET_MS));

  const managerGet = await getDemoTemplatesRaw(managerToken);
  expect(managerGet.status).toBe(200);
  expect(managerGet.data?.find((t) => t.key === DEMO_TEMPLATE_KEY)?.appliedAt).not.toBeNull();

  const managerPost = await importDemoTemplateRaw(managerToken, DEMO_TEMPLATE_KEY, { confirm: true, force: true });
  expect(managerPost.status).toBe(403);

  const editorGet = await getDemoTemplatesRaw(editorToken);
  expect(editorGet.status).toBe(200);

  const editorPost = await importDemoTemplateRaw(editorToken, DEMO_TEMPLATE_KEY, { confirm: true, force: true });
  expect(editorPost.status).toBe(403);

  // USER (kayıt sonrası varsayılan rol, §7.1).
  const userGet = await getDemoTemplatesRaw(lowPrivToken);
  expect(userGet.status).toBe(403);

  // Aynı token, rol CUSTOMER'a çevrilir (`authenticate.ts` rolü DB'den taze okur — §7.1).
  const lowPrivUser = await adminGetUserByEmail(adminToken, LOW_PRIV_EMAIL);
  if (!lowPrivUser) throw new Error("Fixture USER kullanıcısı bulunamadı.");
  await adminUpdateRole(adminToken, lowPrivUser.id, "CUSTOMER");
  const customerGet = await getDemoTemplatesRaw(lowPrivToken);
  expect(customerGet.status).toBe(403);
});

test("madde 12: portfolio modülü kapalıyken import → 201 + ilgili warnings[] girdisi", async () => {
  await patchSiteModule(adminToken, "portfolio", false);
  try {
    const res = await importDemoTemplateRaw(adminToken, DEMO_TEMPLATE_KEY, {
      confirm: true,
      force: true,
      setAsHomePage: false,
    });
    expect(res.status).toBe(201);
    const result = res.data as { pageId: string; sliderId: string | null; warnings: string[] };
    moduleOffImportPageId = result.pageId;
    moduleOffImportSliderId = result.sliderId;
    expect(result.warnings).toContain(
      "Portföy modülü kapalı olduğu için içe aktarılan projeler sitede görünmeyecek. /admin/modules üzerinden açabilirsiniz."
    );
  } finally {
    await patchSiteModule(adminToken, "portfolio", true);
  }
});
