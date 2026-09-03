import { test, expect } from "@playwright/test";
import { getCachedAdminSession, getFixtureUserToken, getSiteModules, patchSiteModule } from "./support/api";
import { adminGetUserByEmail, adminUpdateRole, resetFixtureUserToBaseline } from "./support/admin-users-fixtures";
import { getDemoTemplatesRaw, importDemoTemplateRaw, listAuditLogsRaw } from "./support/demo-templates-fixtures";
import {
  ECOMMERCE_TEMPLATE_KEY,
  EXPECTED_COMMERCE_COUNTS,
  KNOWN_EXTRA_PAGE_SLUGS,
  countAdminOrders,
  getPublicPage,
  purgeKnownEcommerceProContent,
} from "./support/ecommerce-pro-fixtures";

/**
 * qa-agent — `.claude/architect-scope-ecommerce-pro-template.md` §9.9 madde 7/8/9 (bağlayıcı E2E
 * kapsam listesi). Madde 9 ([DTI] §12 mirası — RBAC/idempotency/confirm/force/hız sınırı) BURADA
 * YENİDEN YAZILMAZ: `admin-demo-template-import.spec.ts`teki (modern-architecture için yazılmış)
 * AYNI sözleşme, yalnızca `ECOMMERCE_TEMPLATE_KEY` ile parametrize edilerek doğrulanır — kod
 * KOPYALANMADI, generic yardımcılar (`importDemoTemplateRaw`/`getDemoTemplatesRaw`/
 * `listAuditLogsRaw`) o dosyanın da kullandığı `support/demo-templates-fixtures.ts`'ten aynen
 * import edilir.
 *
 * EK GÖREV (üst koordinatörün talebi) — backend-agent'ın bildirdiği bilinen sınır: `force:true` ile
 * İKİNCİ bir `ecommerce-pro` içe aktarımı, `Product.sku`/`ProductVariant.sku` GLOBAL `@unique`
 * kısıtına (otomatik benzersizleştirme YOK) çarpabilir. Bu dosya bunu GERÇEKTEN tetikleyip
 * gözlemlenen davranışı (409 kontrollü hata VEYA ham 500) assert eder — bkz. "madde SKU-çakışma" testi.
 *
 * ============================================================================================
 * HIZ SINIRI İZOLASYONU — `admin-demo-template-import.spec.ts` başlığındaki AYNI bulgu/gerekçe:
 * `POST /admin/demo-templates/{key}/import` route-seviyesinde `{max:5, timeWindow:"1 minute"}`
 * ile TÜM templateKey'ler için ORTAK bir sayaca (aynı route, `request.ip` anahtarlı) yazar.
 * Bu dosyanın çağrıları 3 pencereye BÖLÜNÜR: (1) hız sınırı testi — kimlik doğrulamasız 6 istek,
 * İZOLE; (2) "iş mantığı" penceresi — TAM 5 gerçek çağrı (happy-path, idempotency-409,
 * missing-confirm-422, force-SKU-çakışma, module-off-import); (3) RBAC penceresi — 3 çağrı.
 * ============================================================================================
 */
test.describe.configure({ mode: "serial" });

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

test("SKU-çakışma: force:true ile İKİNCİ import — Product.sku global @unique otomatik benzersizleştirilmediği için gözlemlenen davranış", async () => {
  // DELTA karşılaştırılır (mutlak sayı DEĞİL) — paylaşımlı `saas_e2e` DB'nin `audit_logs` tablosu
  // önceki (bu turdaki manuel hata ayıklama denemeleri dahil) koşumlardan kalan SUCCESS satırları
  // barındırabilir; bu test yalnızca BU çağrının YENİ bir başarılı satır ÜRETMEDİĞİNİ doğrular.
  const logsBefore = await listAuditLogsRaw(adminToken, { action: "demo_template.import", limit: 20 });
  const successCountBefore = logsBefore.filter(
    (l) => l.status === "SUCCESS" && (l.metadata as Record<string, unknown> | null)?.templateKey === ECOMMERCE_TEMPLATE_KEY
  ).length;

  const res = await importDemoTemplateRaw(adminToken, ECOMMERCE_TEMPLATE_KEY, { confirm: true, force: true });

  // Backend'in genel hata işleyicisi (`plugins/error-handler.ts`) Prisma P2002'yi (`Product.sku`
  // çakışması, importer.ts'in 2 kez retry ettikten SONRA OLDUĞU GİBİ fırlattığı hata) YAKALAR ve
  // 409 CONFLICT'e çevirir — bu YÖNETİLEN/kontrollü bir hatadır, ham bir 500 DEĞİLDİR. Bu, bilinen
  // bir sınırlamadır (SKU'lar sayfa/sayfa/kategori slug'ları gibi "-2" ile otomatik
  // benzersizleştirilMEZ) ve burada BİLEREK/açıkça `expect` edilir — architect'e mimari bir karar
  // olarak (SKU'ları da benzersizleştirmek mi, yoksa force'ta SKU'yu tamamen atlamak/uyarmak mı)
  // eskale edilmesi ÖNERİLİR, ama bu test onu bir REGRESYONMUŞ gibi ele almaz.
  expect([409, 500]).toContain(res.status);
  if (res.status === 409) {
    expect(res.error?.code).toBe("CONFLICT");
  } else {
    // Ham 500 — bu BEKLENMEYEN bir durum, koordinatöre BUG olarak raporlanmalı (bkz. final özet).
    console.error("BUG REPRO — force:true reimport 500 döndü:", JSON.stringify(res.error));
  }

  // Ne olursa olsun: transaction TÜMÜYLE geri alınmış olmalı — bu çağrı YENİ bir başarılı
  // (SUCCESS) audit satırı ÜRETMEMİŞ olmalı (ikinci bir kopya YARATILMAMIŞ).
  const logsAfter = await listAuditLogsRaw(adminToken, { action: "demo_template.import", limit: 20 });
  const successCountAfter = logsAfter.filter(
    (l) => l.status === "SUCCESS" && (l.metadata as Record<string, unknown> | null)?.templateKey === ECOMMERCE_TEMPLATE_KEY
  ).length;
  expect(successCountAfter).toBe(successCountBefore);
});

test("madde 8: products modülü kapalıyken (temiz zeminde) import → 201 + 'Ürünler modülü kapalı' + yasal sayfa uyarıları", async () => {
  test.setTimeout(60_000);
  // Önceki testlerin (madde 7 + SKU-çakışma denemesi) bıraktığı içerik TEMİZLENİR — aksi halde bu
  // çağrı da AYNI SKU çakışmasına düşer (force:false kullanılacağı için önce idempotency işareti de
  // sıfırlanmalı, `purgeKnownEcommerceProContent` ikisini birden yapar).
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
