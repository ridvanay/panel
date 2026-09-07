import { test, expect, type Page } from "@playwright/test";
import {
  API_BASE_URL,
  getCachedAdminSession,
  getFixtureUserToken,
  adminCreateProduct,
  adminDeleteProductPermanently,
  createPendingOrderDirect,
  postStripeCheckoutSessionCompleted,
  adminUpdateOrderStatus,
  adminUpdateOrderDirect,
  adminGetOrder,
  adminGetOrderActivity,
} from "./support/api";
import { createAuthenticatedPage, createAuthenticatedPageAs } from "./support/admin-session";
import { registerFixtureUser, resetFixtureUserToBaseline, adminGetUserByEmail, adminUpdateRole } from "./support/admin-users-fixtures";

/**
 * qa-agent — `.claude/architect-scope-order-management-pro.md` §9 (bağlayıcı, 6 madde)
 * doğrulaması. Gerçek tarayıcı + gerçek backend + gerçek Postgres (`saas_e2e`) üzerinden
 * `/admin/orders/[orderId]` üst eylem çubuğu (Onayla/Askıya Al/İptal Et/Kargoya Ver/Tamamlandı/
 * İade Et), iptal modalı (para koruması dahil), düzenleme modu, rol kapısı (ADMIN vs MANAGER) ve
 * aktivite günlüğü (`ipAddress` sızdırmaması dahil). Backend'in kendi `tests/integration/
 * orders.test.ts`'i (`app.inject`, gerçek HTTP/tarayıcı katmanı YOK) geçiş tablosunun HER
 * kombinasyonunu zaten kapsıyor — bu dosya o tabanın ÜSTÜNE gerçek buton tıklaması → gerçek ağ
 * isteği → gerçek DB → UI'a yansıma zincirini ekler.
 *
 * Fixture altyapısı ZATEN VAR (§9 — bağlayıcı, YENİ bir mekanizma İCAT EDİLMEDİ): `support/
 * api.ts::createPendingOrderDirect` (ham SQL ile PENDING sipariş) + `postStripeCheckoutSession
 * Completed` (gerçek imzalı Stripe webhook'uyla PAID'e çekme) + `admin-users-fixtures.ts` (rol
 * atama) + `support/admin-session.ts::createAuthenticatedPageAs` (rol ile gerçek UI login'i).
 * `adminUpdateOrderStatus()` bu turda `cancellationReason`/`sendCustomerEmail`/
 * `confirmWithoutRefund` alanlarıyla GENİŞLETİLDİ; `adminUpdateOrderDirect`/`adminGetOrder`/
 * `adminGetOrderActivity` bu turda EKLENDİ (`support/api.ts`, `.claude/architect-scope-order-
 * management-pro.md` §10 — bu destek dosyası da qa-agent'ın kendi test altyapısının parçasıdır).
 *
 * §5.4 (`ORDER_ACTIVITY_RATE_LIMIT` — 120/dk) bu dosyanın çağrı hacmiyle (dosya başına ~10-15
 * aktivite isteği) hiç yaklaşılmayan bir sınırdır, ek bir önlem GEREKMEZ.
 *
 * NOT (auth) — `admin-page-editor-roles.spec.ts` ile AYNI desen: dosya başına TEK context/
 * `beforeAll`'da gerçek UI login'i (`support/admin-session.ts` başlığındaki refresh-token
 * rotasyonu riskini azaltma disiplini). ADMIN oturumu `createAuthenticatedPage()` (qa-e2e-admin,
 * mevcut sabit kullanıcı) — bu dosya rol TERFİ/DÜŞÜRME yapmadığı için "son admin" kısıtına
 * ÇARPMAZ, ikinci bir ADMIN fixture'ı GEREKMEZ (bkz. `admin-page-editor-roles.spec.ts`'in
 * SECOND_ADMIN'i tam tersi bir ihtiyaç içindi).
 */
test.describe.configure({ mode: "serial" });

const RUN_SUFFIX = Date.now().toString(36);
const MANAGER_EMAIL = `qa-e2e-order-mgmt-manager-${RUN_SUFFIX}@example.com`;
const MANAGER_PASSWORD = "QaE2eOrderMgrRole12345!";
const UNIT_PRICE_CENTS = 15_000;

let adminToken: string;
let adminUserId: string;
let managerToken: string;
let productId: string;
let productTitle: string;

let adminPage: Page;
let closeAdminSession: () => Promise<void>;
let managerPage: Page;
let closeManagerSession: () => Promise<void>;

function uniqueOrderEmail(prefix: string): string {
  return `qa-order-mgmt-${prefix}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1_000_000).toString(36)}@example.com`;
}

/** Her çağrıda TAZE bir `PENDING` sipariş — `siteUserId` olarak qa-e2e-admin'in KENDİ id'si
 *  kullanılır (yalnızca bir FK hedefi olarak; `promoteUserToCustomerIfNeeded` yalnızca `role ===
 *  "USER"` iken tetiklenir, ADMIN için no-op — bkz. `stripe.routes.ts`). Bu, her test dosyası
 *  başına ayrı bir "sahte müşteri" fixture kullanıcısı açıp `/auth/register`'ın sabit 5 istek/dk
 *  kotasını gereksiz tüketmekten kaçınır (`admin-page-editor-roles.spec.ts` başlığındaki AYNI
 *  gerekçe). */
function createFixtureOrder(): { orderId: string; orderNumber: string } {
  return createPendingOrderDirect({
    siteUserId: adminUserId,
    customerEmail: uniqueOrderEmail("order"),
    productId,
    productTitle,
    unitPriceCents: UNIT_PRICE_CENTS,
  });
}

async function payOrder(orderId: string): Promise<void> {
  const res = await postStripeCheckoutSessionCompleted(orderId);
  expect(res.status).toBe(200);
}

/** react-hook-form alan id'leri nokta içerir (`shippingAddress.phone` gibi); `getByLabel` bu
 *  sayfada İKİ eşleşme (teslimat + fatura adresi, AYNI etiketler) bulacağı için
 *  `checkout-address-billing.spec.ts::byId` İLE BİREBİR AYNI desen kullanılır. */
function byId(page: Page, id: string) {
  return page.locator(`[id="${id}"]`);
}

/** Durum rozeti (`Badge size="lg"`) — `<main>` içeriğindeki (admin kenar çubuğu HARİÇ — o da
 *  "Yönetim Paneli" başlığında AYNI `text-sm font-semibold` sınıf ikilisini taşıyor, bkz.
 *  `admin/layout.tsx`) TEK `text-sm font-semibold` `<span>` (diğer TÜM rozetler `size="sm"`,
 *  bkz. `badge.tsx`). Aktivite akışındaki "X → Y" metadata satırının AYNI durum etiketini de
 *  basabilmesi nedeniyle serbest `getByText` yerine bu yapısal seçici kullanılır — flaky bir
 *  çoklu-eşleşme riskini BAŞTAN eler. */
function statusBadge(page: Page) {
  return page.locator("main span.text-sm.font-semibold").first();
}

// `checkout.schemas.ts::CheckoutAddressInputSchema` — `neighborhood`/`addressLine2` `.optional()`
// ama `.nullable()` DEĞİL (`min(1)` ile); bu yüzden burada `null` DEĞİL, TAMAMEN OMİT edilir
// (`undefined`) — aksi halde 422 (zod "expected string, received null").
const BASELINE_ADDRESS = {
  fullName: "Ayşe Yılmaz",
  phone: "05551112233",
  country: "TR",
  city: "İstanbul",
  district: "Kadıköy",
  addressLine1: "Bağdat Cd. No:10",
  postalCode: "34710",
};

// Geçerli (checksum'dan geçen) bir T.C. Kimlik No test sabiti — `isValidTcKimlikNo` algoritmasını
// GEÇER (yaygın bilinen bir test numarası deseni). Test "5"in temel/başlangıç faturasına
// KASITLI OLARAK DOLU yazılır — BOŞ bırakılırsa `[orderId]/page.tsx::onEditSubmit()`'in bilinen
// bug'ına (bkz. test "5b" — frontend-agent'a raporlandı) çarpar; test "5" bu bug'dan BAĞIMSIZ
// olarak asıl kapsam maddesini (telefon + adres satırı kalıcılığı) doğrulamalıdır.
const BASELINE_NATIONAL_ID = "10000000146";

/** Test "5" (düzenleme paneli) için önkoşul — sipariş oluşturulduğunda `shippingAddress`/
 *  `billing` `null`'dur (`createPendingOrderDirect` bunları hiç yazmıyor); admin API'siyle
 *  DOĞRUDAN bir temel/başlangıç değeri yazılır ki UI testi yalnızca İKİ alanı (telefon + adres
 *  satırı) değiştirdiğini, GERİ KALANIN bozulmadığını doğrulayabilsin. */
async function setBaselineContactInfo(orderId: string): Promise<void> {
  const res = await adminUpdateOrderDirect(adminToken, orderId, {
    shippingAddress: BASELINE_ADDRESS,
    billing: { billingType: "INDIVIDUAL", nationalId: BASELINE_NATIONAL_ID, address: BASELINE_ADDRESS },
  });
  expect(res.status).toBe(200);
}

test.beforeAll(async ({ browser }, testInfo) => {
  testInfo.setTimeout(90_000);
  const session = await getCachedAdminSession();
  adminToken = session.accessToken;
  adminUserId = session.userId;

  await resetFixtureUserToBaseline(adminToken, MANAGER_EMAIL);
  await registerFixtureUser(MANAGER_EMAIL, MANAGER_PASSWORD, "QA E2E Order Mgmt Manager");
  const managerUser = await adminGetUserByEmail(adminToken, MANAGER_EMAIL);
  if (!managerUser) throw new Error("MANAGER fixture kullanıcısı oluşturulamadı.");
  await adminUpdateRole(adminToken, managerUser.id, "MANAGER");
  managerToken = await getFixtureUserToken(MANAGER_EMAIL, MANAGER_PASSWORD, "QA E2E Order Mgmt Manager");

  const product = await adminCreateProduct(adminToken, {
    title: `QA E2E Sipariş Yönetimi Ürünü ${RUN_SUFFIX}`,
    priceCents: UNIT_PRICE_CENTS,
    stockQuantity: 100,
  });
  productId = product.id as string;
  productTitle = product.title as string;

  ({ page: adminPage, close: closeAdminSession } = await createAuthenticatedPage(browser));
  ({ page: managerPage, close: closeManagerSession } = await createAuthenticatedPageAs(browser, MANAGER_EMAIL, MANAGER_PASSWORD));
});

test.afterAll(async () => {
  if (closeAdminSession) await closeAdminSession();
  if (closeManagerSession) await closeManagerSession();
  await adminDeleteProductPermanently(adminToken, productId);
  await resetFixtureUserToBaseline(adminToken, MANAGER_EMAIL);
});

test("1) ADMIN: ON_HOLD → PAID — 'Askıya Al' rozeti 'Askıya Alındı' yapar, 'Siparişi Onayla' 'Hazırlanıyor'a döner", async () => {
  const { orderId } = createFixtureOrder();
  await payOrder(orderId);

  await adminPage.goto(`/admin/orders/${orderId}`);
  await expect(statusBadge(adminPage)).toHaveText("Hazırlanıyor");

  await adminPage.getByRole("button", { name: "Askıya Al" }).click();
  await expect(adminPage.getByText("Sipariş durumu güncellendi.").last()).toBeVisible({ timeout: 5_000 });
  await expect(statusBadge(adminPage)).toHaveText("Askıya Alındı");

  await adminPage.getByRole("button", { name: "Siparişi Onayla" }).click();
  await expect(adminPage.getByText("Sipariş durumu güncellendi.").last()).toBeVisible({ timeout: 5_000 });
  await expect(statusBadge(adminPage)).toHaveText("Hazırlanıyor");
});

test("2) PENDING sipariş iptali — e-posta kutusu işaretli bırakılır, activity'de order.cancel_email + customerEmailRequested:true", async () => {
  const { orderId } = createFixtureOrder();

  await adminPage.goto(`/admin/orders/${orderId}`);
  await expect(statusBadge(adminPage)).toHaveText("Ödeme Bekleniyor");

  await adminPage.getByRole("button", { name: "İptal Et" }).click();
  const dialog = adminPage.getByRole("dialog", { name: "Siparişi iptal et" });
  await expect(dialog).toBeVisible();

  await dialog.getByLabel("İptal Nedeni").fill("Stok tükendi, tedarikçi teslimatı iptal etti.");
  // Varsayılan işaretli bırakılır (§9 madde 2 — "e-posta kutusu işaretli bırakılır") — DOKUNULMAZ.
  await expect(dialog.getByRole("checkbox", { name: "Müşteriye e-posta gönderilsin" })).toBeChecked();
  // Sipariş HENÜZ ödenmemiş (`PENDING`) — para-koruması uyarı kutusu/ikinci onay GÖRÜNMEMELİ.
  await expect(dialog.getByText("Bu siparişin ödemesi alınmış.")).not.toBeVisible();

  await dialog.getByRole("button", { name: "İptal Et" }).click();
  await expect(adminPage.getByText("Sipariş iptal edildi.").last()).toBeVisible({ timeout: 5_000 });
  await expect(statusBadge(adminPage)).toHaveText("İptal Edildi");

  // Doğrulama e-posta kutusundan DEĞİL — backend'de gerçek SMTP yok (§8 madde 5) — `GET
  // /admin/orders/{id}/activity` yanıtındaki `order.cancel_email` kaydından yapılır.
  const activity = await adminGetOrderActivity(adminToken, orderId);
  expect(activity.status).toBe(200);

  // `status` (SUCCESS/FAILURE) test edilmez — e2e ortamında gerçek SMTP yoktur, backend'in
  // dev-fallback Ethereal hesabına düşer (ağ bağımlı, §8 madde 5). Doğrulanan tek şey: e-posta
  // kutusu işaretliyken bu kayıt HER ZAMAN oluşur (gönderim SONUCUNDAN bağımsız, best-effort).
  const cancelEmailEntry = activity.entries.find((e) => e.action === "order.cancel_email");
  expect(cancelEmailEntry).toBeTruthy();

  const statusChangeEntry = activity.entries.find(
    (e) => e.action === "order.status_change" && (e.metadata as Record<string, unknown> | null)?.to === "CANCELLED"
  );
  expect(statusChangeEntry).toBeTruthy();
  expect((statusChangeEntry!.metadata as Record<string, unknown>).customerEmailRequested).toBe(true);
});

test("3) Ödenmiş sipariş iptalinde para koruması — onay kutusu işaretlenmeden API 409 (durum ON_HOLD kalır), işaretlenince başarılı", async () => {
  const { orderId } = createFixtureOrder();
  await payOrder(orderId);

  await adminPage.goto(`/admin/orders/${orderId}`);
  await expect(statusBadge(adminPage)).toHaveText("Hazırlanıyor");
  await adminPage.getByRole("button", { name: "Askıya Al" }).click();
  await expect(statusBadge(adminPage)).toHaveText("Askıya Alındı");

  await adminPage.getByRole("button", { name: "İptal Et" }).click();
  const dialog = adminPage.getByRole("dialog", { name: "Siparişi iptal et" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("İptal Nedeni").fill("Müşteri vazgeçti.");
  await expect(dialog.getByText("Bu siparişin ödemesi alınmış.")).toBeVisible();

  const submitButton = dialog.getByRole("button", { name: "İptal Et" });
  // İkinci onay kutusu İŞARETLENMEDEN — istemci tarafı guard da submit'i engeller (§7.2 bağlayıcı).
  await expect(submitButton).toBeDisabled();

  // Backend'in KENDİSİ de reddediyor mu — istemci tarafı guard'dan BAĞIMSIZ, doğrudan API (§3.5/§8
  // madde: "istemci tarafı kontrol tek savunma değildir").
  const directAttempt = await adminUpdateOrderStatus(adminToken, orderId, {
    status: "CANCELLED",
    cancellationReason: "Müşteri vazgeçti.",
  });
  expect(directAttempt.status).toBe(409);
  const stillOnHold = await adminGetOrder(adminToken, orderId);
  expect(stillOnHold.status).toBe("ON_HOLD");

  // İkinci onay kutusu İŞARETLENİNCE — başarılı.
  await dialog.getByRole("checkbox", { name: "Parayı kendim/başka bir yolla iade edeceğimi onaylıyorum" }).click();
  await expect(submitButton).toBeEnabled();
  await submitButton.click();

  await expect(adminPage.getByText("Sipariş iptal edildi.").last()).toBeVisible({ timeout: 5_000 });
  await expect(statusBadge(adminPage)).toHaveText("İptal Edildi");
});

test("4) MANAGER yetkisizliği — UI'da Askıya Al/İptal Et/Düzenle görünmez (Kargoya Ver görünür), doğrudan API 403", async () => {
  const { orderId } = createFixtureOrder();
  await payOrder(orderId);

  await managerPage.goto(`/admin/orders/${orderId}`);
  await expect(statusBadge(managerPage)).toHaveText("Hazırlanıyor");

  await expect(managerPage.getByRole("button", { name: "Askıya Al" })).toHaveCount(0);
  await expect(managerPage.getByRole("button", { name: "İptal Et" })).toHaveCount(0);
  await expect(managerPage.getByRole("button", { name: "Düzenle" })).toHaveCount(0);
  await expect(managerPage.getByRole("button", { name: "Kargoya Ver" })).toBeVisible();

  const statusRes = await fetch(`${API_BASE_URL}/admin/orders/${orderId}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${managerToken}` },
    body: JSON.stringify({ status: "CANCELLED", cancellationReason: "x" }),
  });
  expect(statusRes.status).toBe(403);

  const updateRes = await fetch(`${API_BASE_URL}/admin/orders/${orderId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${managerToken}` },
    body: JSON.stringify({ adminNotes: "manager denemesi" }),
  });
  expect(updateRes.status).toBe(403);

  // Kontrol — sipariş bu iki reddedilen denemeden ETKİLENMEDİ, hâlâ PAID.
  const unchanged = await adminGetOrder(adminToken, orderId);
  expect(unchanged.status).toBe("PAID");
});

test("5) ADMIN düzenleme — telefon + adres satırı değişikliği kalıcı, ekrana yansır, activity'de order.update görünür", async () => {
  const { orderId } = createFixtureOrder();
  await setBaselineContactInfo(orderId);

  const newPhone = "05339998877";
  const newAddressLine1 = "Yeni Mahalle Sk. No:99";
  // NOT (bkz. test "5b") — gerçek "Düzenle" formunun KENDİ submit akışı, ŞU AN frontend-agent'a
  // ait KRİTİK bir bug nedeniyle (aşağıda belgelenir) HER durumda 422 ile başarısız oluyor; bu
  // yüzden mutasyonun KENDİSİ burada `adminUpdateOrderDirect` (gerçek `PATCH /admin/orders/{id}`
  // isteği, backend'in KENDİSİNE karşı — mock DEĞİL) ile tetiklenir. Bu senaryonun asıl doğruladığı
  // §9 madde 5 iddiaları — kalıcılık, TAM nesne semantiği (kısmi yama yok), aktivite kaydı, EKRANA
  // doğru yansıma — GERÇEK tarayıcıyla aşağıda doğrulanır; yalnızca "kaydet butonuna tıklama"
  // adımı atlanır (o adım ayrı, `test.fail()` ile işaretli bir regresyon testinde, bkz. "5b").
  const updated = await adminUpdateOrderDirect(adminToken, orderId, {
    shippingAddress: { ...BASELINE_ADDRESS, phone: newPhone, addressLine1: newAddressLine1 },
    billing: { billingType: "INDIVIDUAL", nationalId: BASELINE_NATIONAL_ID, address: BASELINE_ADDRESS },
  });
  expect(updated.status).toBe(200);

  await adminPage.goto(`/admin/orders/${orderId}`);
  await expect(adminPage.getByText(newPhone)).toBeVisible();
  await expect(adminPage.getByText(newAddressLine1, { exact: false })).toBeVisible();
  // Değişmeyen diğer alanlar (Ad Soyad, İl) da KORUNMUŞ olmalı — kısmi yama yok, TAM nesne
  // gönderildi (§5.3).
  await expect(adminPage.getByText(BASELINE_ADDRESS.fullName).first()).toBeVisible();
  // `city` HEM teslimat HEM fatura adresinde aynı (`BASELINE_ADDRESS` ikisinde de kullanıldı) —
  // `.first()` yeterli, tekil bir DOM eşleşmesi ARANMIYOR.
  await expect(adminPage.getByText(BASELINE_ADDRESS.city, { exact: false }).first()).toBeVisible();
  // İKİ `order.update` kaydı olabilir (`setBaselineContactInfo()` + bu testin kendi PATCH'i) —
  // `.first()` yeterli, tekliği ARANMIYOR.
  await expect(adminPage.getByText("Sipariş güncellendi", { exact: true }).first()).toBeVisible();

  // Sayfa yenilendiğinde YİNE kalıcı (§9 madde 5 — "sayfa yenilendiğinde yeni değer kalıcıdır").
  await adminPage.reload();
  await expect(adminPage.getByText(newPhone)).toBeVisible();
  await expect(adminPage.getByText(newAddressLine1, { exact: false })).toBeVisible();

  const activity = await adminGetOrderActivity(adminToken, orderId);
  const updateEntry = activity.entries.find((e) => e.action === "order.update");
  expect(updateEntry).toBeTruthy();
  expect((updateEntry!.metadata as { fields?: string[] } | null)?.fields).toContain("shippingAddress");
});

test("5b) BUG (frontend-agent) — 'Düzenle' formunun KENDİ 'Kaydet' düğmesi, fatura tipinden BAĞIMSIZ HER durumda 422 ile başarısız oluyor", async () => {
  // Kural gereği (proje kökü CLAUDE.md madde 6): qa-agent bug'ı KENDİ DÜZELTMEZ — burada
  // BEKLENEN davranış (başarılı kayıt) yazılır; `test.fail()` bunun ŞU AN başarısız olduğunu
  // bilinçli olarak işaretler (bkz. TEST_COVERAGE.md "bulunan ve raporlanan bug'lar").
  //
  // KÖK NEDEN (doğrudan `curl` ile backend'e karşı da doğrulandı — UI'a özgü bir yanlış
  // kullanım DEĞİL): `[orderId]/page.tsx::onEditSubmit()` gönderdiği `billing` nesnesinde
  // uygulanmayan alt-alanlara `value?.trim() || null` deseniyle AÇIKÇA `null` yazıyor:
  //   - `billingType: "INDIVIDUAL"` iken → `companyName`/`taxOffice`/`taxNumber` HER ZAMAN `null`.
  //   - `billingType: "CORPORATE"` iken → `nationalId` HER ZAMAN `null`.
  // Backend'in `OrderBillingInputSchema`'sı (`checkout.schemas.ts::CheckoutBillingInputSchema`
  // İLE AYNI desen) bu alanları YALNIZCA `z.string().optional()` — yani `undefined` (OMİT
  // edilmiş) kabul eder, `null` DEĞİL → INDIVIDUAL'da temel zod tip hatası ("Expected string,
  // received null"), CORPORATE'te ise `superRefine`'ın "`nationalId !== undefined` ise
  // reddedilir" kuralı (`null !== undefined` TRUE olduğu için) — HER İKİ fatura tipinde de 422.
  // Checkout'un KENDİ formu bu tuzağa DÜŞMEZ (bkz. `checkout-address-billing.spec.ts` madde 1 —
  // "TCKN boş bırakılınca `body.billing` HİÇ `nationalId` anahtarı TAŞIMAZ") çünkü anahtarı
  // TAMAMEN OMİT eder; sipariş düzenleme formu bu convention'dan SAPMIŞTIR.
  //
  // ETKİ (KRİTİK): "Düzenle" → "Kaydet" akışı, fatura tipi/dolu-alan durumu FARK ETMEKSİZİN,
  // her siparişte, kullanıcı yalnızca TEK bir alanı (ör. teslimat telefonu) değiştirse BİLE
  // SESSİZCE 422 ile başarısız olur — özellik gerçek tarayıcıda FİİLEN KULLANILAMAZ durumdadır
  // (curl ile backend'e karşı bağımsızca doğrulandı, bkz. yorum).
  // DÜZELTİLDİ (frontend-agent) — `onEditSubmit()` artık uygulanmayan billing alt-alanları için
  // `null` DEĞİL, anahtarı TAMAMEN OMİT ediyor (checkout'un `buildCheckoutRequest`'iyle AYNI
  // desen, bkz. `[orderId]/page.tsx::onEditSubmit()`). `test.fail()` işareti bu yüzden
  // KALDIRILDI — test artık GERÇEKTEN (beklenen şekilde) yeşil geçer.

  const { orderId } = createFixtureOrder();
  await setBaselineContactInfo(orderId);

  await adminPage.goto(`/admin/orders/${orderId}`);
  await adminPage.getByRole("button", { name: "Düzenle" }).click();
  // Fatura alanlarına HİÇ DOKUNULMAZ — yalnızca teslimat telefonu değiştirilir (kullanıcının
  // asıl niyeti bu, fatura ile hiç ilgisi yok).
  await byId(adminPage, "shippingAddress.phone").fill("05330000000");
  await adminPage.locator("div.flex.justify-end.gap-2").getByRole("button", { name: "Kaydet" }).click();

  await expect(adminPage.getByText("Sipariş güncellendi.").last()).toBeVisible({ timeout: 5_000 });
});

test("6) Aktivite günlüğü ipAddress sızdırmaz", async () => {
  const { orderId } = createFixtureOrder();
  const cancelRes = await adminUpdateOrderStatus(adminToken, orderId, {
    status: "CANCELLED",
    // NOT: buraya kasıtlı olarak "ipAddress" METNİ YAZILMAZ — aşağıdaki `not.toContain("ipAddress")`
    // iddiasını, bu serbest metin alanının KENDİSİ üzerinden yanlış-pozitife düşürmemek için.
    cancellationReason: "IP adresi sızıntı kontrolü için iptal.",
    sendCustomerEmail: false,
  });
  expect(cancelRes.status).toBe(200);

  const activity = await adminGetOrderActivity(adminToken, orderId);
  expect(activity.status).toBe(200);
  expect(activity.entries.length).toBeGreaterThan(0);
  expect(activity.rawText).not.toContain("ipAddress");
});
