import { test, expect, type Page, type Browser } from "@playwright/test";
import { getCachedAdminSession, getSiteModules, patchSiteModule } from "./support/api";
import { createAuthenticatedPage } from "./support/admin-session";

/**
 * qa-agent — Ayarlar sayfasındaki "Vergi Sınıfları" sekmesinin "products" modülüne bağlı olduğunu
 * doğrular (`app/admin/settings/page.tsx`::`AdminSettingsPageContent` — `useModules().
 * isModuleEnabled("products")` `false` iken hem `TabsTrigger value="tax"` hem `TabsContent
 * value="tax"` DOM'dan kaldırılıyor; `?tab=tax` deep-link'i modül kapalıyken "Genel Ayarlar"a
 * düşüyor).
 *
 * Modül açma/kapama GERÇEK admin UI'sinden (`/admin/modules` — `Switch` `onCheckedChange`'te
 * anında `PATCH /admin/modules/{key}` atar, ayrı bir "kaydet" adımı YOK) yapılır — API'den
 * doğrudan `patchSiteModule()` çağırmak yerine bilerek gerçek tıklama → gerçek istek → gerçek
 * DOM zincirini test eder. `createAuthenticatedPage()`: dosya başına TEK context (`admin-
 * session.ts` başlığındaki refresh-token rotasyonu riskini azaltma disiplini,
 * `tax-management.spec.ts` İLE AYNI desen).
 *
 * Test izolasyonu: `products` modülünün test ÖNCESİ durumu `beforeAll`'da okunur, `afterAll`'da
 * AYNEN geri yazılır — diğer onlarca e2e spec dosyasının paylaştığı `saas_e2e` veritabanında bu
 * modülü kalıcı olarak kapalı BIRAKMAMAK için (`customer-portal-module-toggle.spec.ts` İLE AYNI
 * ilke).
 */
test.describe.configure({ mode: "serial" });

let adminToken: string;
let adminPage: Page;
let closeAdminSession: () => Promise<void>;
let initialProductsModuleEnabled: boolean;

test.beforeAll(async ({ browser }: { browser: Browser }) => {
  const session = await getCachedAdminSession();
  adminToken = session.accessToken;
  const modules = await getSiteModules(adminToken);
  initialProductsModuleEnabled = modules.find((m) => m.key === "products")?.enabled ?? true;

  ({ page: adminPage, close: closeAdminSession } = await createAuthenticatedPage(browser));

  // Testin BAŞLANGIÇ zemini deterministik olsun diye — modül zaten AÇIK olarak başlar (ilk test
  // bunu KAPATIR). Ambient durum zaten kapalıysa burada açılır (asıl teardown `afterAll`'da).
  if (!initialProductsModuleEnabled) await patchSiteModule(adminToken, "products", true);
});

test.afterAll(async () => {
  await patchSiteModule(adminToken, "products", initialProductsModuleEnabled);
  await closeAdminSession();
});

function productsSwitch(page: Page) {
  return page.getByRole("switch", { name: /^Ürünler modülünü/ });
}

test("products modülü KAPATILINCA Ayarlar'da Vergi Sınıfları sekmesi DOM'dan kalkar; ?tab=tax deep-link Genel Ayarlar'a düşer", async () => {
  await adminPage.goto("/admin/modules");
  await expect(adminPage.getByRole("heading", { name: "Modüller" })).toBeVisible();

  const toggle = productsSwitch(adminPage);
  await expect(toggle).toHaveAttribute("aria-checked", "true");

  await toggle.click();
  await expect(adminPage.getByText('"Ürünler" modülü devre dışı bırakıldı.')).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-checked", "false");

  await adminPage.goto("/admin/settings");
  await expect(adminPage.getByRole("heading", { name: "Ayarlar", exact: true })).toBeVisible();
  await expect(adminPage.getByRole("tab", { name: "Vergi Sınıfları", exact: true })).toHaveCount(0);
  await expect(adminPage.getByRole("heading", { name: "Vergi Sınıfları", exact: true })).toHaveCount(0);

  // Deep-link: `?tab=tax` ile doğrudan girilse bile modül kapalıyken "Genel Ayarlar"a düşer.
  await adminPage.goto("/admin/settings?tab=tax");
  await expect(adminPage.getByRole("heading", { name: "Ayarlar", exact: true })).toBeVisible();
  await expect(adminPage.getByRole("tab", { name: "Genel Ayarlar", exact: true, selected: true })).toBeVisible();
  await expect(adminPage.getByRole("tab", { name: "Vergi Sınıfları", exact: true })).toHaveCount(0);
  await expect(adminPage.getByRole("heading", { name: "Vergi Sınıfları", exact: true })).toHaveCount(0);
});

test("products modülü TEKRAR AÇILINCA Vergi Sınıfları sekmesi Ayarlar'a geri döner", async () => {
  await adminPage.goto("/admin/modules");
  const toggle = productsSwitch(adminPage);
  await expect(toggle).toHaveAttribute("aria-checked", "false");

  await toggle.click();
  await expect(adminPage.getByText('"Ürünler" modülü etkinleştirildi.')).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-checked", "true");

  // Modül durumu `modules-context.tsx`'in kendi (anlık) `GET /admin/modules` fetch'inden gelir —
  // ürün/blog/portfolyo listelerindeki 60sn'lik ISR önbelleğiyle KARIŞTIRILMAMALI (bu farklı bir
  // mekanizma). Yine de tam sayfa navigasyonu + olası bir render sırası varyansına karşı idempotent
  // bir `toPass()` ile bekleniyor, sabit bir `waitForTimeout` yerine.
  await expect(async () => {
    await adminPage.goto("/admin/settings");
    await expect(adminPage.getByRole("tab", { name: "Vergi Sınıfları", exact: true })).toBeVisible();
  }).toPass({ timeout: 15_000, intervals: [500, 1_000, 2_000] });

  await adminPage.getByRole("tab", { name: "Vergi Sınıfları", exact: true }).click();
  await expect(adminPage.getByRole("heading", { name: "Vergi Sınıfları", exact: true })).toBeVisible();
});
