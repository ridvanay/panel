import { test, expect, type Page } from "@playwright/test";
import { getCachedAdminSession, API_BASE_URL } from "./support/api";
import {
  adminCreateProductFull,
  adminDeleteProductPermanently,
  getShippingSettings,
  patchShippingSettings,
  type FixtureProduct,
  type ShippingSettingsFixture,
} from "./support/product-variants-fixtures";
import { createAuthenticatedPageAs } from "./support/admin-session";
import { registerFixtureUser, resetFixtureUserToBaseline } from "./support/admin-users-fixtures";

/**
 * qa-agent — `.claude/architect-scope-checkout-redesign.md` §9 "qa-agent kapsamı (kritik
 * senaryolar)" (bağlayıcı, 10 madde) doğrulaması. Gerçek tarayıcı + gerçek backend + gerçek
 * Postgres (`saas_e2e`) üzerinden yeni 2 sütunlu `/checkout` akışı. Form doğrulama KURALLARININ
 * KENDİSİ (`frontend/tests/unit/checkout-form.test.tsx`, RTL + mock API) ZATEN kapsanıyor —
 * burada TEKRARLANMAZ; bu dosyanın kattığı katman: gerçek `CartProvider` + gerçek `/checkout/
 * session` ağ isteği şekli + gerçek yönlendirme + gerçek backend 409/boş-sepet regresyonları +
 * gerçek viewport'ta yapısal yerleşim.
 *
 * KRİTİK — Stripe: `POST /checkout/session` GERÇEK bir `stripe.checkout.sessions.create` ağ
 * çağrısı yapar (bkz. `backend/src/modules/checkout/checkout.routes.ts`); e2e ortamının
 * `STRIPE_SECRET_KEY=sk_test_e2e` (bkz. `backend/.env.e2e`) SAHTE olduğu için bu çağrı gerçek
 * Stripe'a ULAŞMAMALI (görev talimatı: "gerçek Stripe'a asla gitme"). Başarılı submit senaryoları
 * (madde 1/2) bu yüzden `page.route("**\/checkout/session", ...)` ile TARAYICI seviyesinde
 * intercept edilir — backend HİÇ ÇAĞRILMAZ, yalnızca frontend'in ürettiği istek GÖVDESİ ve
 * `window.location.assign(checkoutUrl)` yönlendirmesi doğrulanır. Bu, `Order` snapshot
 * kolonlarının DB'de doğru yazıldığını KANITLAMAZ (backend `tests/integration/checkout.test.ts`
 * bunu `vi.mock("../../src/lib/stripe")` ile zaten doğruluyor, bkz. qa-agent raporu) — yalnızca
 * frontend'in backend'e gönderdiği gövdenin kontrata (§5.2/§6.2) uyduğunu ve UI'ın dönen
 * `checkoutUrl`'e gerçekten yönlendiğini doğrular. Stok/boş-sepet regresyonları (madde 7/8) ise
 * Stripe adımına HİÇ ULAŞMADAN (409/erken dönüş) başarısız olduğu için GERÇEK backend'e karşı
 * çalıştırılır (mock GEREKMEZ).
 */
test.describe.configure({ mode: "serial" });

const RUN_SUFFIX = Date.now().toString(36);

let adminToken: string;
let originalShipping: ShippingSettingsFixture;
let product: FixtureProduct; // stok bol — 1/2/3/4/5/6/9/10. maddeler için yeniden kullanılır
let stockProduct: FixtureProduct; // madde 8 — stoğu sıfıra çekilir

const createdProductIds: string[] = [];

test.beforeAll(async () => {
  const session = await getCachedAdminSession();
  adminToken = session.accessToken;
  originalShipping = await getShippingSettings(adminToken);

  product = await adminCreateProductFull(adminToken, {
    title: `QA Checkout Adres Ürünü ${RUN_SUFFIX}`,
    priceCents: 5000,
    stockQuantity: 50,
  });
  createdProductIds.push(product.id);

  stockProduct = await adminCreateProductFull(adminToken, {
    title: `QA Checkout Stok Ürünü ${RUN_SUFFIX}`,
    priceCents: 3000,
    stockQuantity: 3,
  });
  createdProductIds.push(stockProduct.id);
});

test.afterAll(async () => {
  await patchShippingSettings(adminToken, originalShipping);
  for (const id of createdProductIds) await adminDeleteProductPermanently(adminToken, id);
});

async function adminSetProductStock(token: string, productId: string, stockQuantity: number): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/admin/products/${productId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ stockQuantity }),
  });
  if (!res.ok) throw new Error(`adminSetProductStock ${res.status}: ${await res.text()}`);
}

/** PDP'den sepete ekler, çekmeceyi kapatır — diğer e2e dosyalarındaki AYNI desen
 *  (`cart-dedupe-drawer-shipping.spec.ts::addToCartFromPdp`). */
async function addToCartFromPdp(page: Page, slug: string): Promise<void> {
  await page.goto(`/products/${slug}`);
  await page.getByRole("button", { name: "Sepete ekle" }).click();
  const drawer = page.getByRole("dialog", { name: "Sepetiniz" });
  await expect(drawer).toBeVisible();
  await drawer.getByRole("button", { name: "Sepeti kapat" }).click();
  await expect(drawer).not.toBeVisible();
}

/** Form alanlarının `id`'leri react-hook-form yollarıyla BİREBİR aynı (nokta içerir) — `#a.b`
 *  CSS'te geçersiz (nokta = class seçici), bu yüzden nitelik seçici kullanılır. */
function byId(page: Page, id: string) {
  return page.locator(`[id="${id}"]`);
}

/**
 * qa-agent BULGUSU (testin KENDİ hatası, ürün kusuru DEĞİL — burada düzeltildi): Bireysel/Kurumsal
 * segmented control'ün gerçek `<input type="radio">`'su `className="peer sr-only"` ile GÖRSEL
 * OLARAK gizli (standart "screen-reader-only" deseni, `billing-section.tsx`) — gerçek bir
 * kullanıcı her zaman SARAN `<label>`'a (görünür metne) tıklar, tarayıcı bunu otomatik olarak
 * içindeki input'a yönlendirir. `getByRole("radio", ...).click()` Playwright'ın actionability
 * kontrolünün doğrudan (1x1'e küçültülmüş) input'un koordinatlarına tıklamaya ÇALIŞMASINA yol
 * açıyor — bu koordinatlar üstteki `<label>` tarafından "intercept" ediliyor ve tıklama SONSUZ
 * RETRY'a girip 30sn timeout'a çarpıyor. Çözüm: görünür `<label>` metnine DOĞRUDAN tıklamak
 * (gerçek kullanıcı etkileşiminin birebir aynısı).
 */
async function selectBillingType(page: Page, label: "Bireysel" | "Kurumsal"): Promise<void> {
  await page.getByText(label, { exact: true }).click();
}

const DEFAULT_SHIPPING = {
  fullName: "Ada Yılmaz",
  phone: "05551234567",
  city: "İstanbul",
  district: "Kadıköy",
  addressLine1: "Bahariye Cd. No:10",
};

async function fillShippingAddress(page: Page, overrides: Partial<typeof DEFAULT_SHIPPING> = {}): Promise<void> {
  const v = { ...DEFAULT_SHIPPING, ...overrides };
  await byId(page, "shippingAddress.fullName").fill(v.fullName);
  await byId(page, "shippingAddress.phone").fill(v.phone);
  await byId(page, "shippingAddress.city").fill(v.city);
  await byId(page, "shippingAddress.district").fill(v.district);
  await byId(page, "shippingAddress.addressLine1").fill(v.addressLine1);
}

async function checkConsents(page: Page): Promise<void> {
  await page.getByRole("checkbox", { name: /Mesafeli Satış Sözleşmesi/ }).click();
  await page.getByRole("checkbox", { name: /Ön Bilgilendirme Formu/ }).click();
}

interface CapturedCheckoutBody {
  customerEmail: string;
  customerName?: string;
  shippingAddress: {
    fullName: string;
    phone: string;
    city: string;
    district: string;
    neighborhood?: string;
    addressLine1: string;
    addressLine2?: string;
    postalCode?: string;
  };
  billing: {
    billingType: "INDIVIDUAL" | "CORPORATE";
    sameAsShipping: boolean;
    companyName?: string;
    taxOffice?: string;
    taxNumber?: string;
    nationalId?: string;
    address?: {
      fullName: string;
      phone: string;
      city: string;
      district: string;
      neighborhood?: string;
      addressLine1: string;
      addressLine2?: string;
      postalCode?: string;
    };
  };
  distanceSalesApproved: boolean;
  preliminaryInfoApproved: boolean;
}

/** Bkz. dosya başlığı — `/checkout/session`'ı TARAYICI seviyesinde intercept eder, backend'e
 *  (ve gerçek Stripe'a) hiç ULAŞTIRMADAN sahte bir `checkoutUrl` döner. Frontend'in ürettiği
 *  istek gövdesini `bodyPromise` ile dışarı verir. */
function interceptCheckoutSession(page: Page, checkoutUrl: string): { bodyPromise: Promise<CapturedCheckoutBody>; install: () => Promise<void> } {
  let resolveBody!: (value: CapturedCheckoutBody) => void;
  const bodyPromise = new Promise<CapturedCheckoutBody>((resolve) => {
    resolveBody = resolve;
  });
  return {
    bodyPromise,
    install: async () => {
      await page.route("**/checkout/session", async (route) => {
        resolveBody(route.request().postDataJSON() as CapturedCheckoutBody);
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ data: { checkoutUrl } }),
        });
      });
    },
  };
}

test("madde 1: misafir + bireysel (TCKN'siz) + sameAsShipping true — checkout/session doğru gövdeyle çağrılır, dönen checkoutUrl'e yönlenir", async ({
  page,
}) => {
  await addToCartFromPdp(page, product.slug);
  await page.goto("/checkout");
  await expect(page.getByRole("heading", { name: "Ödeme" })).toBeVisible();

  await byId(page, "customerEmail").fill("misafir-bireysel@example.com");
  await fillShippingAddress(page);
  // Bireysel zaten varsayılan seçim, `sameAsShipping` zaten varsayılan `true` — hiçbiri
  // değiştirilmiyor. TCKN alanı BİLİNÇLİ olarak BOŞ bırakılıyor (madde başlığı: "TCKN'siz").
  await checkConsents(page);

  const mockCheckoutUrl = `${new URL(page.url()).origin}/qa-e2e-mock-stripe-checkout-1`;
  const interceptor = interceptCheckoutSession(page, mockCheckoutUrl);
  await interceptor.install();

  await page.getByRole("button", { name: "Güvenli Ödemeye Geç" }).click();

  const body = await interceptor.bodyPromise;
  expect(body.customerEmail).toBe("misafir-bireysel@example.com");
  expect(body.shippingAddress).toMatchObject(DEFAULT_SHIPPING);
  // §6.2 kuralı — `sameAsShipping !== false` iken `billing.address` HİÇ GÖNDERİLMEZ; TCKN boş
  // bırakıldığı için `nationalId` de gönderilmez. Tam olarak bu iki alan.
  expect(body.billing).toEqual({ billingType: "INDIVIDUAL", sameAsShipping: true });
  expect(body.distanceSalesApproved).toBe(true);
  expect(body.preliminaryInfoApproved).toBe(true);

  await page.waitForURL(/qa-e2e-mock-stripe-checkout-1/, { timeout: 10_000 });
});

test("madde 2: misafir + kurumsal + ayrı fatura adresi (sameAsShipping:false) — form doğru gövdeyle submit edilir", async ({ page }) => {
  await addToCartFromPdp(page, product.slug);
  await page.goto("/checkout");

  await byId(page, "customerEmail").fill("misafir-kurumsal@example.com");
  await fillShippingAddress(page, { fullName: "Mehmet Demir", phone: "05559876543" });

  await selectBillingType(page, "Kurumsal");
  await byId(page, "billing.companyName").fill("Demir Ticaret A.Ş.");
  await byId(page, "billing.taxNumber").fill("1234567890");

  await page.getByRole("checkbox", { name: "Fatura adresim teslimat adresimle aynı" }).click();
  const billingAddress = {
    fullName: "Demir Ticaret Muhasebe",
    phone: "05551112233",
    city: "Ankara",
    district: "Çankaya",
    addressLine1: "Kızılay Meydanı No:5",
  };
  await byId(page, "billing.address.fullName").fill(billingAddress.fullName);
  await byId(page, "billing.address.phone").fill(billingAddress.phone);
  await byId(page, "billing.address.city").fill(billingAddress.city);
  await byId(page, "billing.address.district").fill(billingAddress.district);
  await byId(page, "billing.address.addressLine1").fill(billingAddress.addressLine1);

  await checkConsents(page);

  const mockCheckoutUrl = `${new URL(page.url()).origin}/qa-e2e-mock-stripe-checkout-2`;
  const interceptor = interceptCheckoutSession(page, mockCheckoutUrl);
  await interceptor.install();

  await page.getByRole("button", { name: "Güvenli Ödemeye Geç" }).click();

  const body = await interceptor.bodyPromise;
  expect(body.billing.billingType).toBe("CORPORATE");
  expect(body.billing.sameAsShipping).toBe(false);
  expect(body.billing.companyName).toBe("Demir Ticaret A.Ş.");
  expect(body.billing.taxNumber).toBe("1234567890");
  expect(body.billing.nationalId).toBeUndefined();
  expect(body.billing.address).toMatchObject(billingAddress);

  await page.waitForURL(/qa-e2e-mock-stripe-checkout-2/, { timeout: 10_000 });
});

test("madde 3: kurumsal ama vergi no eksik — hata billing.taxNumber alanının altında görünür, submit engellenir (API çağrılmaz)", async ({
  page,
}) => {
  await addToCartFromPdp(page, product.slug);
  await page.goto("/checkout");

  await byId(page, "customerEmail").fill("kurumsal-eksik@example.com");
  await fillShippingAddress(page);
  await selectBillingType(page, "Kurumsal");
  await byId(page, "billing.companyName").fill("Eksik Vergi A.Ş.");
  // `billing.taxNumber` BİLİNÇLİ olarak boş bırakılıyor.
  await checkConsents(page);

  let sessionCalled = false;
  await page.route("**/checkout/session", async (route) => {
    sessionCalled = true;
    await route.abort();
  });

  await page.getByRole("button", { name: "Güvenli Ödemeye Geç" }).click();

  const taxNumberInput = byId(page, "billing.taxNumber");
  await expect(taxNumberInput).toHaveAttribute("aria-invalid", "true");
  await expect(taxNumberInput).toHaveAttribute("aria-describedby", "billing.taxNumber-error");
  await expect(page.locator('[id="billing.taxNumber-error"]')).toHaveText("Vergi numarası 10 haneli olmalıdır.");
  expect(sessionCalled).toBe(false);
});

test("madde 4: yasal onay kutuları işaretlenmemiş — submit engellenir, hatalar checkbox altında görünür", async ({ page }) => {
  await addToCartFromPdp(page, product.slug);
  await page.goto("/checkout");

  await byId(page, "customerEmail").fill("onaysiz@example.com");
  await fillShippingAddress(page);
  // Yasal onay checkbox'ları BİLİNÇLİ olarak işaretlenMİyor.

  let sessionCalled = false;
  await page.route("**/checkout/session", async (route) => {
    sessionCalled = true;
    await route.abort();
  });

  await page.getByRole("button", { name: "Güvenli Ödemeye Geç" }).click();

  await expect(page.getByText("Mesafeli Satış Sözleşmesi'ni onaylamanız gerekir.")).toBeVisible();
  await expect(page.getByText("Ön Bilgilendirme Formu'nu onaylamanız gerekir.")).toBeVisible();
  expect(sessionCalled).toBe(false);
});

test("madde 5: geçersiz TCKN (checksum tutmuyor) — inline hata gösterilir, submit engellenir", async ({ page }) => {
  await addToCartFromPdp(page, product.slug);
  await page.goto("/checkout");

  await byId(page, "customerEmail").fill("tckn-gecersiz@example.com");
  await fillShippingAddress(page);
  // Bireysel (varsayılan) — 11 hane, format GEÇERLİ ama resmî checksum TUTMUYOR
  // (`checkout-schema.ts::isValidTcKimlikNo` — `backend/src/lib/tr-identity.ts` ile aynı algoritma).
  await byId(page, "billing.nationalId").fill("12345678901");
  await checkConsents(page);

  let sessionCalled = false;
  await page.route("**/checkout/session", async (route) => {
    sessionCalled = true;
    await route.abort();
  });

  await page.getByRole("button", { name: "Güvenli Ödemeye Geç" }).click();

  await expect(page.locator('[id="billing.nationalId-error"]')).toHaveText("Geçerli bir T.C. kimlik numarası giriniz.");
  expect(sessionCalled).toBe(false);
});

test.describe("madde 6: üye kullanıcı prefill", () => {
  const MEMBER_EMAIL = "qa-e2e-checkout-member@example.com";
  const MEMBER_PASSWORD = "QaE2eCheckoutMember12345!";
  const MEMBER_NAME = "QA E2E Checkout Member";
  let memberPage: Page;
  let closeMemberSession: () => Promise<void>;

  test.beforeAll(async ({ browser }) => {
    await resetFixtureUserToBaseline(adminToken, MEMBER_EMAIL);
    await registerFixtureUser(MEMBER_EMAIL, MEMBER_PASSWORD, MEMBER_NAME);
    ({ page: memberPage, close: closeMemberSession } = await createAuthenticatedPageAs(browser, MEMBER_EMAIL, MEMBER_PASSWORD));
  });

  test.afterAll(async () => {
    if (closeMemberSession) await closeMemberSession();
    await resetFixtureUserToBaseline(adminToken, MEMBER_EMAIL);
  });

  test("e-posta/ad soyad ön dolu, telefon boş bırakılır (User.phone yok, §6.2)", async () => {
    await memberPage.goto(`/products/${product.slug}`);
    await memberPage.getByRole("button", { name: "Sepete ekle" }).click();
    const drawer = memberPage.getByRole("dialog", { name: "Sepetiniz" });
    await expect(drawer).toBeVisible();
    await drawer.getByRole("button", { name: "Sepeti kapat" }).click();

    await memberPage.goto("/checkout");
    await expect(byId(memberPage, "customerEmail")).toHaveValue(MEMBER_EMAIL);
    await expect(byId(memberPage, "customerName")).toHaveValue(MEMBER_NAME);
    await expect(byId(memberPage, "shippingAddress.phone")).toHaveValue("");
  });
});

test("madde 7: sepet boşken /checkout mevcut boş durum ekranını gösterir (regresyon)", async ({ page }) => {
  await page.goto("/checkout");
  await expect(page.getByText("Sepetiniz boş")).toBeVisible();
  await expect(page.locator('[id="customerEmail"]')).toHaveCount(0);
});

test("madde 8: stok tükenmiş ürün — 409, Türkçe hata mesajı üstte Alert'te gösterilir (regresyon)", async ({ page }) => {
  await addToCartFromPdp(page, stockProduct.slug);
  await adminSetProductStock(adminToken, stockProduct.id, 0);

  await page.goto("/checkout");
  await byId(page, "customerEmail").fill("stok-yok@example.com");
  await fillShippingAddress(page);
  await checkConsents(page);

  // Bu test GERÇEK backend'e karşı çalışır (mock YOK) — stok kontrolü Stripe çağrısından
  // ÖNCE gerçekleşiyor (bkz. checkout.routes.ts), yani gerçek Stripe'a hiç ulaşılmıyor.
  await page.getByRole("button", { name: "Güvenli Ödemeye Geç" }).click();

  const alert = page.getByRole("alert").filter({ hasText: "yeterli stok yok" });
  await expect(alert).toBeVisible();
});

test("madde 9: shippingFlatFeeCents=null iken sipariş özetinde kargo satırı hiç görünmüyor (regresyon)", async ({ page }) => {
  await patchShippingSettings(adminToken, { shippingFlatFeeCents: null, freeShippingThresholdCents: null });

  await addToCartFromPdp(page, product.slug);
  await page.goto("/checkout");

  await expect(page.getByRole("heading", { name: "Sipariş Özeti", exact: true })).toBeVisible();
  await expect(page.getByText("Kargo", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Ara Toplam", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Toplam", { exact: true }).first()).toBeVisible();
});

test.describe("madde 10: responsive yerleşim", () => {
  test("masaüstü (≥1024px): 2 sütun + sticky sağ sütun, mobil 'peek' accordion YOK", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await addToCartFromPdp(page, product.slug);
    await page.goto("/checkout");

    await expect(page.getByRole("button", { name: /Sipariş Özeti \(\d+ ürün\)/ })).not.toBeVisible();

    const contactHeading = page.getByRole("heading", { name: "İletişim" });
    const summaryHeading = page.getByRole("heading", { name: "Sipariş Özeti", exact: true });
    await expect(contactHeading).toBeVisible();
    await expect(summaryHeading).toBeVisible();

    const contactBox = await contactHeading.boundingBox();
    const summaryBox = await summaryHeading.boundingBox();
    expect(contactBox).not.toBeNull();
    expect(summaryBox).not.toBeNull();
    // 2 sütun, sağ sütun sticky — sağ başlık sol başlığın SAĞINDA, neredeyse AYNI yükseklikte.
    expect(summaryBox!.x).toBeGreaterThan(contactBox!.x + contactBox!.width);
    expect(Math.abs(summaryBox!.y - contactBox!.y)).toBeLessThan(80);
  });

  test("mobil (<1024px): tek sütun, üstte Accordion 'peek' görünür", async ({ page }) => {
    await page.setViewportSize({ width: 480, height: 900 });
    await addToCartFromPdp(page, product.slug);
    await page.goto("/checkout");

    const peekTrigger = page.getByRole("button", { name: /Sipariş Özeti \(\d+ ürün\)/ });
    await expect(peekTrigger).toBeVisible();

    const contactHeading = page.getByRole("heading", { name: "İletişim" });
    const summaryHeading = page.getByRole("heading", { name: "Sipariş Özeti", exact: true });
    await expect(contactHeading).toBeVisible();
    await expect(summaryHeading).toBeVisible();

    const contactBox = await contactHeading.boundingBox();
    const summaryBox = await summaryHeading.boundingBox();
    expect(contactBox).not.toBeNull();
    expect(summaryBox).not.toBeNull();
    // Tek sütun — tam Sipariş Özeti kartı, form kartlarının (İletişim/Teslimat/Fatura) ALTINDA,
    // belirgin bir dikey mesafeyle.
    expect(summaryBox!.y).toBeGreaterThan(contactBox!.y + 200);
  });
});
