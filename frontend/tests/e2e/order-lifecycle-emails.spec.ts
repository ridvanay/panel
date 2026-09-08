import { test, expect, type Page } from "@playwright/test";
import {
  getCachedAdminSession,
  adminCreateProduct,
  adminDeleteProductPermanently,
  createPendingOrderDirect,
  postStripeCheckoutSessionCompleted,
  adminUpdateOrderStatus,
  adminGetOrderActivity,
  getAdminSettings,
  patchSiteSettings,
} from "./support/api";
import { createAuthenticatedPage } from "./support/admin-session";

/**
 * qa-agent — `.claude/architect-scope-search-and-order-emails.md` §2.7 qa-agent görev listesi:
 * sipariş yaşam döngüsü e-postalarının (kargoya verildi / yeni sipariş bildirimi) admin panel
 * üzerinden GERÇEK kullanıcı akışıyla doğrulanması. Backend'in kendi birim/entegrasyon testleri
 * (`backend/tests/integration/{orders,settings,webhook-order}.test.ts` — `app.inject`, gerçek
 * tarayıcı/SMTP YOK) zaten her SUCCESS/FAILURE/422 kombinasyonunu kapsıyor; bu dosya o tabanın
 * ÜSTÜNE gerçek buton tıklaması → gerçek HTTP → gerçek Postgres → aktivite akışına yansıma
 * zincirini ekler. `admin-order-management-pro.spec.ts`'in test "2"siyle AYNI gerekçe: e2e
 * ortamında SMTP yapılandırılmamış (`backend/.env.e2e`), backend dev-fallback Ethereal hesabına
 * düşer (ağ bağımlı) — bu yüzden e-posta GÖNDERİM SONUCU (SUCCESS/FAILURE) DEĞİL, best-effort
 * audit KAYDININ oluşup oluşmadığı doğrulanır.
 *
 * NOT (UI sınırı): `[orderId]/page.tsx`'teki "Kargoya ver" diyaloğu `sendCustomerEmail` alanını
 * HİÇ göndermez (backend `?? true` varsayılanına düşer, §2.5) — dolayısıyla
 * "sendCustomerEmail: false" senaryosu UI'da HİÇ TEMSİL EDİLMEZ, yalnızca doğrudan API ile test
 * edilebilir (bu dosyanın test "2"si).
 */
test.describe.configure({ mode: "serial" });

const RUN_SUFFIX = Date.now().toString(36);
const UNIT_PRICE_CENTS = 9_900;

let adminToken: string;
let adminUserId: string;
let productId: string;

let adminPage: Page;
let closeAdminSession: () => Promise<void>;

/** Ayarlar formunun teardown'da geri yazacağı ORİJİNAL değer (test "3" başında okunur). */
let originalOrderNotificationEmail: string | null = null;

function uniqueOrderEmail(prefix: string): string {
  return `qa-order-emails-${prefix}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1_000_000).toString(36)}@example.com`;
}

function createFixtureOrder() {
  return createPendingOrderDirect({
    siteUserId: adminUserId,
    customerEmail: uniqueOrderEmail("order"),
    productId,
    productTitle: `QA E2E Sipariş E-postaları Ürünü ${RUN_SUFFIX}`,
    unitPriceCents: UNIT_PRICE_CENTS,
  });
}

async function payOrder(orderId: string): Promise<void> {
  const res = await postStripeCheckoutSessionCompleted(orderId);
  expect(res.status).toBe(200);
}

test.beforeAll(async ({ browser }, testInfo) => {
  testInfo.setTimeout(90_000);
  const session = await getCachedAdminSession();
  adminToken = session.accessToken;
  adminUserId = session.userId;

  const product = await adminCreateProduct(adminToken, {
    title: `QA E2E Sipariş E-postaları Ürünü ${RUN_SUFFIX}`,
    priceCents: UNIT_PRICE_CENTS,
    stockQuantity: 50,
  });
  productId = product.id as string;

  ({ page: adminPage, close: closeAdminSession } = await createAuthenticatedPage(browser));
});

test.afterAll(async () => {
  if (closeAdminSession) await closeAdminSession();
  if (productId) await adminDeleteProductPermanently(adminToken, productId);
  // Ayarlar formunu ORİJİNAL değerine geri yaz (test "3" veya "4" atlanmış/başarısız olsa bile).
  if (originalOrderNotificationEmail !== null || originalOrderNotificationEmail === null) {
    await patchSiteSettings(adminToken, { orderNotificationEmail: originalOrderNotificationEmail });
  }
});

test("1) PAID → SHIPPED (admin panel, Kargoya Ver diyaloğu) — activity akışında order.shipped_email görünür", async () => {
  const { orderId } = createFixtureOrder();
  await payOrder(orderId);

  await adminPage.goto(`/admin/orders/${orderId}`);
  await expect(adminPage.locator("main span.text-sm.font-semibold").first()).toHaveText("Hazırlanıyor");

  await adminPage.getByRole("button", { name: "Kargoya Ver" }).click();
  const dialog = adminPage.getByRole("dialog", { name: "Siparişi kargoya ver" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Kargo Takip Numarası").fill("TR" + RUN_SUFFIX.toUpperCase());
  await dialog.getByLabel("Kargo Firması").fill("Yurtiçi Kargo");
  await dialog.getByRole("button", { name: "Kargoya Ver" }).click();

  await expect(adminPage.getByText("Sipariş kargoya verildi.").last()).toBeVisible({ timeout: 5_000 });
  await expect(adminPage.locator("main span.text-sm.font-semibold").first()).toHaveText("Kargoda");

  const activity = await adminGetOrderActivity(adminToken, orderId);
  expect(activity.status).toBe(200);
  const shippedEmailEntry = activity.entries.find((e) => e.action === "order.shipped_email");
  expect(shippedEmailEntry).toBeTruthy();

  const statusChangeEntry = activity.entries.find(
    (e) => e.action === "order.status_change" && (e.metadata as Record<string, unknown> | null)?.to === "SHIPPED"
  );
  expect(statusChangeEntry).toBeTruthy();
  // §2.4B — `customerEmailRequested` artık CANCELLED VEYA SHIPPED'te yazılır; UI hiç alan
  // göndermediği için backend'in `?? true` varsayılanı (§2.5) devrede olmalı.
  expect((statusChangeEntry!.metadata as Record<string, unknown>).customerEmailRequested).toBe(true);
});

test("2) sendCustomerEmail:false ile SHIPPED (doğrudan API) — order.shipped_email HİÇ OLUŞMAZ", async () => {
  const { orderId } = createFixtureOrder();
  await payOrder(orderId);

  const res = await adminUpdateOrderStatus(adminToken, orderId, {
    status: "SHIPPED",
    trackingNumber: "TR" + RUN_SUFFIX.toUpperCase() + "N",
    shippingCarrier: "Aras Kargo",
    sendCustomerEmail: false,
  });
  expect(res.status).toBe(200);

  const activity = await adminGetOrderActivity(adminToken, orderId);
  expect(activity.status).toBe(200);
  const shippedEmailEntry = activity.entries.find((e) => e.action === "order.shipped_email");
  expect(shippedEmailEntry).toBeUndefined();

  const statusChangeEntry = activity.entries.find(
    (e) => e.action === "order.status_change" && (e.metadata as Record<string, unknown> | null)?.to === "SHIPPED"
  );
  expect(statusChangeEntry).toBeTruthy();
  expect((statusChangeEntry!.metadata as Record<string, unknown>).customerEmailRequested).toBe(false);
});

test("3) Admin ayarlar: 'Yeni sipariş bildirim e-postası' kaydedilir ve sayfa yenilemesinde geri okunur", async () => {
  const before = await getAdminSettings(adminToken);
  originalOrderNotificationEmail = (before.orderNotificationEmail as string | null) ?? null;

  const testEmail = `qa-order-notify-${RUN_SUFFIX}@example.com`;

  await adminPage.goto("/admin/settings");
  const field = adminPage.getByLabel("Yeni sipariş bildirim e-postası");
  await expect(field).toBeVisible();
  await field.fill(testEmail);
  await adminPage.getByRole("button", { name: "Kaydet" }).click();
  await expect(adminPage.getByText("Ayarlar kaydedildi.").last()).toBeVisible({ timeout: 5_000 });

  await adminPage.reload();
  await expect(adminPage.getByLabel("Yeni sipariş bildirim e-postası")).toHaveValue(testEmail);

  // Sunucu tarafı çapraz kontrol — UI'nin GERÇEKTEN kaydettiği API üzerinden de doğrulanır.
  const after = await getAdminSettings(adminToken);
  expect(after.orderNotificationEmail).toBe(testEmail);

  // §2.3 — public `GET /settings` bu alanı ASLA döndürmemeli (sızıntı koruması). Bu depoda ayrı
  // bir public settings fixture yardımcısı yok; doğrudan uç çağrılır (yalnızca bu tek doğrulama
  // için, backend-agent'ın unit testiyle ÇAKIŞMAZ — burada gerçek HTTP + gerçek DB üzerinden).
  const publicRes = await fetch(`${process.env.E2E_API_URL ?? "http://localhost:4001/api/v1"}/settings`);
  expect(publicRes.ok).toBe(true);
  const publicBody = (await publicRes.json()) as { data: Record<string, unknown> };
  expect(publicBody.data).not.toHaveProperty("orderNotificationEmail");
});

test("4) Yeni ödenmiş sipariş (PENDING→PAID) — bildirim adresi ayarlıyken activity'de order.admin_notify_email görünür", async () => {
  // Test "3"ün bıraktığı bildirim adresi hâlâ ayarlı (aynı dosya, serial mod) — burada AYRICA
  // API üzerinden garanti altına alınır (test sırası/izolasyon varsayımına bağlı kalınmaz).
  const testEmail = `qa-order-notify-2-${RUN_SUFFIX}@example.com`;
  await patchSiteSettings(adminToken, { orderNotificationEmail: testEmail });

  const { orderId } = createFixtureOrder();
  await payOrder(orderId);

  const activity = await adminGetOrderActivity(adminToken, orderId);
  expect(activity.status).toBe(200);
  const adminNotifyEntry = activity.entries.find((e) => e.action === "order.admin_notify_email");
  expect(adminNotifyEntry).toBeTruthy();
  // §2.6 — alıcı adresi audit metadata'ya YAZILMAZ (veri minimizasyonu); yalnızca teslim
  // durumunu taşıyan `emailDelivered` alanı bulunur.
  expect((adminNotifyEntry!.metadata as Record<string, unknown> | null)?.emailDelivered).toBeDefined();
});
