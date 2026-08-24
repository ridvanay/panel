import { test, expect, type Page } from "@playwright/test";
import { API_BASE_URL, getCachedAdminSession, getFixtureUserToken, adminUpdateOrderStatus, patchSiteModule, getSiteModules, createPendingOrderDirect, adminCreateProduct, adminDeleteProductPermanently, postStripeCheckoutSessionCompleted } from "./support/api";
import { createAuthenticatedPageAs } from "./support/admin-session";
import { adminGetUserByEmail, registerFixtureUser, resetFixtureUserToBaseline } from "./support/admin-users-fixtures";

/**
 * qa-agent — `.claude/architect-scope-customer-portal.md` §9 (bağlayıcı test matrisi, satır
 * 14-22) doğrulaması: gerçek tarayıcı + gerçek backend + gerçek Postgres (`saas_e2e`) üzerinden
 * `/hesabim/*` sekmeli kabuğunun modül açık/kapalı davranışı, adres/favori/sipariş akışları ve
 * rol/redirect guard'ları. Backend'in `tests/integration/customer-portal.test.ts`'i (Fastify
 * `app.inject`, HTTP katmanı/tarayıcı YOK) ve frontend'in component-seviyesi unit testlerinin
 * (ör. `favorite-button.test.tsx`, mock API'li) KAPSAMADIĞI katman: gerçek sekme tıklaması →
 * gerçek `fetch` → gerçek route handler → tabloya/DOM'a yansıma zinciri.
 *
 * NOT (auth): `admin-user-management.spec.ts` ile AYNI desen — `support/admin-session.ts`'teki
 * `createAuthenticatedPageAs()` refresh-token rotasyonu riskini azaltmak için dosya başına TEK
 * bir gerçek UI login'i yapar.
 */

const CUSTOMER_EMAIL = "qa-e2e-customer-portal@example.com";
const CUSTOMER_PASSWORD = "QaE2eCustomer12345!";

let adminToken: string;
let customerPage: Page;
let closeCustomerSession: () => Promise<void>;
let customerToken: string;
let customerUserId: string;
let productId: string;
let productSlug: string;
let orderId: string;
let orderNumber: string;
let initialProductsModuleEnabled: boolean;

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ browser }, testInfo) => {
  testInfo.setTimeout(60_000);
  const adminSession = await getCachedAdminSession();
  adminToken = adminSession.accessToken;

  // Temiz zemin — önceki başarısız bir koşumdan kalmış fixture kullanıcıyı temel duruma sıfırlar.
  await resetFixtureUserToBaseline(adminToken, CUSTOMER_EMAIL);
  await registerFixtureUser(CUSTOMER_EMAIL, CUSTOMER_PASSWORD, "QA E2E Customer Portal");
  const fixtureUser = await adminGetUserByEmail(adminToken, CUSTOMER_EMAIL);
  if (!fixtureUser) throw new Error("Fixture müşteri kullanıcısı oluşturulamadı.");
  customerUserId = fixtureUser.id;
  customerToken = await getFixtureUserToken(CUSTOMER_EMAIL, CUSTOMER_PASSWORD, "QA E2E Customer Portal");

  // `products` modülünün ÖNCEKİ durumunu oku — testler sonunda AYNEN geri yazılır (diğer e2e
  // spec dosyalarının kullandığı `getAdminAppearance()`/`patchAppearance()` teardown deseniyle
  // AYNI ilke).
  const modules = await getSiteModules(adminToken);
  initialProductsModuleEnabled = modules.find((m) => m.key === "products")?.enabled ?? true;
  if (!initialProductsModuleEnabled) await patchSiteModule(adminToken, "products", true);

  // Gerçek bir ürün + `checkout.session.completed` webhook'uyla TAMAMLANMIŞ (PAID) bir sipariş —
  // `createPendingOrderDirect`/`postStripeCheckoutSessionCompleted` `admin-rbac-5tier-critical-
  // flows.spec.ts` ile AYNI desen. Bu, aynı zamanda `USER -> CUSTOMER` terfisini de tetikler
  // (`stripe.routes.ts::promoteUserToCustomerIfNeeded`) — §7.1/§10.21.7 guard testleri (madde 20)
  // GERÇEK bir CUSTOMER rolüyle çalışsın diye.
  const product = await adminCreateProduct(adminToken, {
    title: `QA E2E Müşteri Portalı Ürünü ${Date.now()}`,
    priceCents: 12_900,
    stockQuantity: 25,
  });
  productId = product.id as string;
  productSlug = product.slug as string;

  const pending = createPendingOrderDirect({
    siteUserId: customerUserId,
    customerEmail: CUSTOMER_EMAIL,
    productId,
    productTitle: product.title as string,
    unitPriceCents: 12_900,
  });
  orderId = pending.orderId;
  orderNumber = pending.orderNumber;
  const webhookRes = await postStripeCheckoutSessionCompleted(orderId);
  expect(webhookRes.status).toBe(200);

  ({ page: customerPage, close: closeCustomerSession } = await createAuthenticatedPageAs(
    browser,
    CUSTOMER_EMAIL,
    CUSTOMER_PASSWORD
  ));
});

test.afterAll(async () => {
  if (closeCustomerSession) await closeCustomerSession();
  await adminDeleteProductPermanently(adminToken, productId);
  await patchSiteModule(adminToken, "products", initialProductsModuleEnabled);
  await resetFixtureUserToBaseline(adminToken, CUSTOMER_EMAIL);
});

test("madde 14/22: products AÇIK — /hesabim 4 sekmeye yönlenir, sipariş kargoya verilince takip no detayda görünür", async () => {
  await customerPage.goto("/hesabim");
  await expect(customerPage).toHaveURL(/\/hesabim\/profil$/);

  const nav = customerPage.getByRole("navigation", { name: "Hesap bölümleri" }).first();
  await expect(nav.getByRole("link", { name: "Profilim & Güvenlik" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Adreslerim" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Siparişlerim" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Favori Ürünlerim" })).toBeVisible();

  // Sipariş listede görünür — `PAID` durumunda kargo bloğu YOK.
  await customerPage.goto("/hesabim/siparislerim");
  await expect(customerPage.getByRole("link", { name: orderNumber })).toBeVisible();
  await customerPage.getByRole("link", { name: orderNumber }).click();
  await expect(customerPage).toHaveURL(new RegExp(`/hesabim/siparislerim/${orderId}$`));
  await expect(customerPage.getByText("Kargo Takip Numarası")).not.toBeVisible();

  // Admin siparişi kargoya verir (§2.4 — `trackingNumber` zorunlu) — `admin-order-detail-ship.
  // test.tsx` ile AYNI kontrat, burada GERÇEK bir HTTP isteğiyle.
  const shipRes = await adminUpdateOrderStatus(adminToken, orderId, {
    status: "SHIPPED",
    trackingNumber: "QA-E2E-TRACK-001",
    shippingCarrier: "Yurtiçi Kargo",
  });
  expect(shipRes.status).toBe(200);

  await customerPage.reload();
  await expect(customerPage.getByText("Kargo Takip Numarası")).toBeVisible();
  await expect(customerPage.getByText("QA-E2E-TRACK-001")).toBeVisible();
  await expect(customerPage.getByText("Taşıyıcı: Yurtiçi Kargo")).toBeVisible();
  await expect(customerPage.getByText("Kargoda")).toBeVisible();
});

test("madde 1: products AÇIK — /hesabim/adreslerim tam CRUD turu (ekle/düzenle/sil)", async () => {
  await customerPage.goto("/hesabim/adreslerim");
  await expect(customerPage.getByRole("heading", { name: "Adreslerim" })).toBeVisible();

  // İki "Yeni Adres Ekle" butonu vardır (başlık yanı + boş durum CTA'sı, design-notes §3) —
  // `.first()` başlık yanındakini hedefler.
  await customerPage.getByRole("button", { name: "Yeni Adres Ekle" }).first().click();
  const createDialog = customerPage.getByRole("dialog", { name: "Yeni Adres Ekle" });
  await expect(createDialog).toBeVisible();
  await createDialog.getByLabel("Başlık").fill("Ev");
  await createDialog.getByLabel("Ad Soyad").fill("Ada Lovelace");
  await createDialog.getByLabel("Telefon").fill("+90 555 123 45 67");
  // `getByLabel("İl")` "İlçe" ile substring çakışıyor (`exact: true` de aynı hang'e yol açtı —
  // Base UI'nin label/input eşleşmesiyle ilgili bir Playwright tuhaflığı); `id` bazlı, KESİN
  // locator'lar kullanılır (`Field id="city"`/`id="district"`, `adreslerim/page.tsx`).
  await createDialog.locator("#city").fill("İstanbul");
  await createDialog.locator("#district").fill("Kadıköy");
  await createDialog.getByLabel("Adres Satırı 1").fill("Bahariye Cd. No:1");
  await createDialog.getByRole("button", { name: "Adresi Ekle" }).click();
  await expect(customerPage.getByText("Adres eklendi.")).toBeVisible();

  await expect(customerPage.getByText("Ev", { exact: true })).toBeVisible();
  await expect(customerPage.getByText("Ada Lovelace · +90 555 123 45 67")).toBeVisible();
  await expect(customerPage.getByText("Varsayılan", { exact: true })).toBeVisible(); // ilk adres otomatik varsayılan

  await customerPage.getByRole("button", { name: "Düzenle" }).click();
  const editDialog = customerPage.getByRole("dialog", { name: "Adresi Düzenle" });
  await editDialog.getByLabel("Başlık").fill("İş");
  await editDialog.getByRole("button", { name: "Kaydet" }).click();
  await expect(customerPage.getByText("Adres güncellendi.")).toBeVisible();
  await expect(customerPage.getByText("İş", { exact: true })).toBeVisible();

  await customerPage.getByRole("button", { name: "Sil" }).click();
  await customerPage.getByRole("dialog", { name: "Adresi sil" }).getByRole("button", { name: "Sil" }).click();
  await expect(customerPage.getByText("Adres silindi.")).toBeVisible();
  await expect(customerPage.getByText("Henüz kayıtlı adresiniz yok")).toBeVisible();
});

test("madde 21: products AÇIK — ürün kartından favoriye ekle, /hesabim/favorilerim'de görünür, sepete eklenir", async () => {
  // `/products` listesi diğer e2e dosyalarının bıraktığı fixture ürünleri de içerebilir —
  // `.first()` YANLIŞ ürünü hedefleyebilir, bu yüzden KENDİ ürünümüzün detay sayfasına DOĞRUDAN
  // gidilir (`FavoriteButton` `/products/[slug]/page.tsx`'te de AYNI bileşen).
  await customerPage.goto(`/products/${productSlug}`);
  const favoriteButton = customerPage.getByRole("button", { name: "Favorilere ekle" });
  await expect(favoriteButton).toBeVisible();
  await favoriteButton.click();
  // `wishlist.toggle()` OPTIMISTIC günceller (buton state'i istek TAMAMLANMADAN değişir) —
  // butonun etiketi yerine GERÇEK POST'un bittiğini doğrulayan başarı toast'ını bekliyoruz,
  // aksi halde bir sonraki `goto()` (tam sayfa navigasyonu) isteği İPTAL EDEBİLİR (qa-agent
  // bulgusu — bu satır olmadan test flaky'di, `/hesabim/favorilerim` boş listeyle karşılaşıyordu).
  await expect(customerPage.getByText("Ürün favorilere eklendi.")).toBeVisible();

  await customerPage.goto("/hesabim/favorilerim");
  await expect(customerPage.getByRole("button", { name: "Sepete Ekle" }).first()).toBeVisible();

  await customerPage.getByRole("button", { name: "Sepete Ekle" }).first().click();
  await expect(customerPage.getByText("Ürün sepete eklendi.")).toBeVisible();
  await expect(customerPage.locator("header").getByLabel(/^Sepet, 1 ürün$/)).toBeVisible();

  // Favori listede kalır — "sepete ekle" favoriden ÇIKARMAZ (§design-notes §5).
  await expect(customerPage.getByRole("button", { name: "Favorilerden çıkar" }).first()).toBeVisible();

  await customerPage.getByRole("button", { name: "Favorilerden çıkar" }).first().click();
  await expect(customerPage.getByText("Ürün favorilerden çıkarıldı.")).toBeVisible();
  await expect(customerPage.getByText("Henüz favori ürününüz yok")).toBeVisible();
});

test("madde 20: CUSTOMER /admin'e giderse admin kabuğu render EDİLMEDEN /hesabim/profil'e yönlenir", async () => {
  await customerPage.goto("/admin");
  await expect(customerPage).toHaveURL(/\/hesabim\/profil$/);
  await expect(customerPage.getByText("Bu alana erişim yetkiniz yok, hesap sayfanıza yönlendirildiniz.")).toBeVisible();
  // Admin kabuğunun HİÇ mount edilmediğini doğrula — sidebar'a özgü bir öğe DOM'da olmamalı.
  await expect(customerPage.locator("[data-sidebar]")).toHaveCount(0);
});

test("madde 19: eski /siparislerim kalıcı yönlendirmeyle /hesabim/siparislerim'e gider", async () => {
  await customerPage.goto("/siparislerim");
  await expect(customerPage).toHaveURL(/\/hesabim\/siparislerim$/);
});

test("madde 18: oturumsuz kullanıcı /hesabim/adreslerim'e giderse /login?next=... yönlendirilir", async ({ browser }) => {
  const context = await browser.newContext({ baseURL: process.env.E2E_FRONTEND_URL ?? "http://localhost:3100" });
  const page = await context.newPage();
  await page.goto("/hesabim/adreslerim");
  await expect(page).toHaveURL(/\/login\?next=%2Fhesabim%2Fadreslerim/);
  await context.close();
});

test("security-agent open-redirect fix — /login?next=//evil.com harici bir adrese YÖNLENDİRMEZ", async ({ browser }) => {
  const context = await browser.newContext({ baseURL: process.env.E2E_FRONTEND_URL ?? "http://localhost:3100" });
  const page = await context.newPage();
  await page.goto("/login?next=%2F%2Fevil.com");
  await page.getByLabel("E-posta").fill(CUSTOMER_EMAIL);
  await page.getByLabel("Şifre").fill(CUSTOMER_PASSWORD);
  await page.getByRole("button", { name: "Giriş yap" }).click();
  // `isSafeInternalPath` reddeder -> güvenli varsayılan `/dashboard`'a düşer, `evil.com`'a HİÇ
  // gitmez (harici bir navigasyon olsaydı `page.url()` origin'i değişirdi).
  await page.waitForURL(/\/dashboard$/, { timeout: 15_000 });
  expect(new URL(page.url()).hostname).not.toContain("evil.com");
  await context.close();
});

test.describe("products KAPALI", () => {
  test.beforeAll(async () => {
    await patchSiteModule(adminToken, "products", false);
  });

  test.afterAll(async () => {
    await patchSiteModule(adminToken, "products", true);
  });

  // qa-agent BULGUSU (backend-agent/frontend-agent'a yönlendirilmeli, bu dosyada DÜZELTİLMEDİ —
  // bkz. görev raporu): `fetchPublicModulesServer()` (`lib/api/server-modules.ts`) `GET /modules`
  // yanıtını `next: { revalidate: 60 }` ile ÖNBELLEKLER. `PATCH /admin/modules/{key}` (site-
  // modules.routes.ts) sayfa yayınlamanın aksine (`documentation-agent`/backend'in `POST
  // /api/revalidate` webhook çağrısı, bkz. `app/api/revalidate/route.ts` başlığı) BU önbelleği
  // TETİKLEMEZ — yani bir admin modülü kapattığında storefront (header ikonları, `/hesabim/*`
  // guard'ları) en fazla 60 saniye ESKİ durumu göstermeye devam edebilir. Bu satırlar bu GERÇEK
  // gecikmeyi `expect(...).toPass()` ile TOLERE eder (test'i YAVAŞ ama DOĞRU tutar) — kök neden
  // KOD DEĞİŞİKLİĞİ gerektirir (qa-agent kendi kod tabanı dışında değişiklik YAPMAZ, CLAUDE.md).
  test.setTimeout(90_000);

  test("madde 15: header'da sepet/favori ikonu YOK, /hesabim'de yalnızca 2 sekme kalır", async () => {
    await expect(async () => {
      await customerPage.goto("/", { waitUntil: "domcontentloaded" });
      await expect(customerPage.locator("header").getByLabel("Favorilerim")).toHaveCount(0);
      await expect(customerPage.locator("header").getByLabel(/^Sepet,/)).toHaveCount(0);
    }).toPass({ timeout: 75_000, intervals: [2_000, 5_000] });

    await customerPage.goto("/hesabim");
    await expect(customerPage).toHaveURL(/\/hesabim\/profil$/);
    const nav = customerPage.getByRole("navigation", { name: "Hesap bölümleri" }).first();
    await expect(nav.getByRole("link", { name: "Profilim & Güvenlik" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Adreslerim" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Siparişlerim" })).toHaveCount(0);
    await expect(nav.getByRole("link", { name: "Favori Ürünlerim" })).toHaveCount(0);
  });

  test("madde 16/17: /hesabim/siparislerim ve /hesabim/favorilerim doğrudan girilirse /hesabim/profil'e yönlenir", async () => {
    await customerPage.goto("/hesabim/siparislerim");
    await expect(customerPage).toHaveURL(/\/hesabim\/profil$/);

    await customerPage.goto("/hesabim/favorilerim");
    await expect(customerPage).toHaveURL(/\/hesabim\/profil$/);
  });

  test("§3 mimari kararının regresyon bekçisi: GET /users/me/orders(/{id}) 200, wishlist* 404 döner", async () => {
    const ordersRes = await customerPage.request.get(`${API_BASE_URL}/users/me/orders`, {
      headers: { Authorization: `Bearer ${customerToken}` },
    });
    expect(ordersRes.status()).toBe(200);

    const orderDetailRes = await customerPage.request.get(`${API_BASE_URL}/users/me/orders/${orderId}`, {
      headers: { Authorization: `Bearer ${customerToken}` },
    });
    expect(orderDetailRes.status()).toBe(200);

    const wishlistRes = await customerPage.request.get(`${API_BASE_URL}/users/me/wishlist`, {
      headers: { Authorization: `Bearer ${customerToken}` },
    });
    expect(wishlistRes.status()).toBe(404);

    const wishlistPostRes = await customerPage.request.post(`${API_BASE_URL}/users/me/wishlist`, {
      headers: { Authorization: `Bearer ${customerToken}`, "Content-Type": "application/json" },
      data: { productId },
    });
    expect(wishlistPostRes.status()).toBe(404);
  });
});
