import crypto from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";

/**
 * `stripe.checkout.sessions.create` gerçek bir ağ çağrısıdır — test ortamında sahte bir
 * `STRIPE_SECRET_KEY` ile çalıştığından (bkz. lib/stripe.ts) gerçek Stripe API'sine ASLA
 * ulaşılmamalı. `../../src/lib/stripe` modülü tamamen mock'lanır (bkz. tests/integration/
 * site-modules.test.ts'teki `vi.mock` paterniyle AYNI yaklaşım).
 */
const stripeSessionsCreateMock = vi.hoisted(() => vi.fn());

vi.mock("../../src/lib/stripe", () => ({
  stripe: {
    checkout: { sessions: { create: stripeSessionsCreateMock } },
  },
}));

import { buildTestApp } from "../helpers/build-test-app";
import { resetDatabase } from "../helpers/reset-db";
import { registerTestUser } from "../helpers/auth";
import { deriveVariantKey } from "../../src/modules/products/lib/variants";
import { SETTINGS_ID, DEFAULTS as SETTINGS_DEFAULTS } from "../../src/modules/settings/settings.routes";

// `.claude/architect-scope-checkout-redesign.md` §5.2/§9 (bağlayıcı) — checkout gövdesi artık
// `shippingAddress`/`billing`/iki yasal onay ZORUNLU alanları içerir (bkz. checkout.schemas.ts).
// Bu yardımcılar TÜM describe bloklarında ORTAK kullanılır — her testin gövdesini elle tekrar
// yazmak yerine geçerli bir taban üretir, testler yalnızca ihtiyaç duydukları alanı override eder.
function validShippingAddress(overrides: Record<string, unknown> = {}) {
  return {
    fullName: "Ada Lovelace",
    phone: "+90 555 111 22 33",
    country: "TR",
    city: "İstanbul",
    district: "Kadıköy",
    addressLine1: "Örnek Mahallesi Çiçek Sokak No:1",
    postalCode: "34710",
    ...overrides,
  };
}

function validCheckoutExtras(overrides: { shippingAddress?: Record<string, unknown>; billing?: Record<string, unknown> } = {}) {
  return {
    shippingAddress: validShippingAddress(overrides.shippingAddress),
    billing: { billingType: "INDIVIDUAL", ...overrides.billing },
    distanceSalesApproved: true as const,
    preliminaryInfoApproved: true as const,
  };
}

// `.claude/architect-scope-checkout-redesign.md` §5.4 — resmî checksum algoritmasından geçen,
// TR geliştirici topluluğunda yaygın bilinen bir test TCKN'si (`tr-identity.test.ts` ile AYNI).
const VALID_TCKN = "10000000146";

describe("checkout — POST /checkout/session (session oluşturma + fiyat/stok bütünlüğü)", () => {
  let app: FastifyInstance;

  function cookieHeader(res: { cookies: { name: string; value: string }[] }): string {
    return res.cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  }

  async function createProduct(overrides: Partial<{ priceCents: number; stockQuantity: number; discountPriceCents: number | null }> = {}) {
    return app.prisma.product.create({
      data: {
        title: `Checkout Ürünü ${crypto.randomUUID()}`,
        slug: `checkout-urun-${crypto.randomUUID()}`,
        priceCents: overrides.priceCents ?? 10000,
        currency: "TRY",
        stockQuantity: overrides.stockQuantity ?? 10,
        discountPriceCents: overrides.discountPriceCents ?? null,
        status: "PUBLISHED",
        publishedAt: new Date(),
      },
    });
  }

  async function addToCart(productId: string, quantity: number, variantId?: string) {
    return app.inject({
      method: "POST",
      url: "/api/v1/cart/items",
      payload: variantId ? { productId, quantity, variantId } : { productId, quantity },
    });
  }

  beforeAll(async () => {
    app = await buildTestApp();
    await resetDatabase(app.prisma);
  });

  afterEach(() => {
    stripeSessionsCreateMock.mockReset();
  });

  afterAll(async () => {
    await resetDatabase(app.prisma);
    await app.close();
  });

  it("boş sepette (cookie yok) 409 döner", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/checkout/session",
      payload: { customerEmail: "musteri@example.com", ...validCheckoutExtras() },
    });
    expect(res.statusCode).toBe(409);
    expect(stripeSessionsCreateMock).not.toHaveBeenCalled();
  });

  it("geçerli sepetle 201 döner, Order DB'de PENDING olarak oluşur, fiyat DB'den (fresh) hesaplanır", async () => {
    const product = await createProduct({ priceCents: 20000 });
    const add = await addToCart(product.id, 2);
    const cookie = cookieHeader(add);

    // Sepete eklendikten SONRA fiyat değişti — checkout'un sepetin DONDURULMUŞ fiyatını
    // DEĞİL, güncel DB fiyatını kullandığını kanıtlamak için.
    await app.prisma.product.update({ where: { id: product.id }, data: { priceCents: 25000 } });

    stripeSessionsCreateMock.mockResolvedValue({ id: "cs_test_fresh_price", url: "https://checkout.stripe.test/cs_test_fresh_price" });

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/checkout/session",
      headers: { cookie },
      payload: { customerEmail: "musteri@example.com", customerName: "Ada Lovelace", ...validCheckoutExtras() },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().data.checkoutUrl).toBe("https://checkout.stripe.test/cs_test_fresh_price");

    expect(stripeSessionsCreateMock).toHaveBeenCalledTimes(1);
    const callArgs = stripeSessionsCreateMock.mock.calls[0]![0];
    expect(callArgs.mode).toBe("payment");
    expect(callArgs.line_items[0].price_data.unit_amount).toBe(25000);
    expect(callArgs.metadata.kind).toBe("order");

    const order = await app.prisma.order.findFirst({
      where: { customerEmail: "musteri@example.com" },
      include: { items: true },
    });
    expect(order).not.toBeNull();
    expect(order?.status).toBe("PENDING");
    expect(order?.stripeCheckoutSessionId).toBe("cs_test_fresh_price");
    // 2 adet x 25000 (güncel fiyat, 20000 DEĞİL) = 50000.
    expect(order?.totalCents).toBe(50000);
    expect(order?.items[0]?.unitPriceCents).toBe(25000);
  });

  it("sepetteki miktar mevcut stoktan fazlaysa 409 döner ve Order oluşmaz", async () => {
    const product = await createProduct({ stockQuantity: 1 });
    const add = await addToCart(product.id, 1);
    const cookie = cookieHeader(add);

    // Checkout'tan HEMEN önce stok başka bir yolla (ör. admin düzeltmesi) tükendi.
    await app.prisma.product.update({ where: { id: product.id }, data: { stockQuantity: 0 } });

    const before = await app.prisma.order.count();

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/checkout/session",
      headers: { cookie },
      payload: { customerEmail: "stoksuz@example.com", ...validCheckoutExtras() },
    });

    expect(res.statusCode).toBe(409);
    expect(stripeSessionsCreateMock).not.toHaveBeenCalled();
    expect(await app.prisma.order.count()).toBe(before);
  });

  it("geçersiz e-posta 422 (VALIDATION_ERROR) döner", async () => {
    const product = await createProduct();
    const add = await addToCart(product.id, 1);
    const cookie = cookieHeader(add);

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/checkout/session",
      headers: { cookie },
      payload: { customerEmail: "gecersiz-eposta", ...validCheckoutExtras() },
    });
    expect(res.statusCode).toBe(422);
  });

  // `.claude/architect-scope-rbac-5-tier.md` §7.2 — isteğe bağlı kimlik doğrulama.
  describe("isteğe bağlı kimlik doğrulama (§7.2)", () => {
    it("Authorization header'ı YOKSA misafir akışı aynen çalışır — Order.siteUserId null kalır, 401 ÜRETİLMEZ", async () => {
      const product = await createProduct();
      const add = await addToCart(product.id, 1);
      const cookie = cookieHeader(add);

      stripeSessionsCreateMock.mockResolvedValue({ id: "cs_test_guest", url: "https://checkout.stripe.test/cs_test_guest" });

      const res = await app.inject({
        method: "POST",
        url: "/api/v1/checkout/session",
        headers: { cookie },
        payload: { customerEmail: "misafir@example.com", ...validCheckoutExtras() },
      });
      expect(res.statusCode).toBe(201);

      const order = await app.prisma.order.findFirst({ where: { customerEmail: "misafir@example.com" } });
      expect(order?.siteUserId).toBeNull();
    });

    it("geçerli Authorization: Bearer header'ı VARSA Order.siteUserId doldurulur", async () => {
      const buyer = await registerTestUser(app, { email: `checkout-auth-${crypto.randomUUID()}@example.com` });
      const product = await createProduct();
      const add = await addToCart(product.id, 1);
      const cookie = cookieHeader(add);

      stripeSessionsCreateMock.mockResolvedValue({ id: "cs_test_authed", url: "https://checkout.stripe.test/cs_test_authed" });

      const res = await app.inject({
        method: "POST",
        url: "/api/v1/checkout/session",
        headers: { cookie, authorization: `Bearer ${buyer.accessToken}` },
        payload: { customerEmail: "kimlikli-alici@example.com", ...validCheckoutExtras() },
      });
      expect(res.statusCode).toBe(201);

      const order = await app.prisma.order.findFirst({ where: { customerEmail: "kimlikli-alici@example.com" } });
      expect(order?.siteUserId).toBe(buyer.userId);
    });

    it("geçersiz/süresi dolmuş Authorization header'ı 401 ÜRETMEZ — misafir gibi devam eder", async () => {
      const product = await createProduct();
      const add = await addToCart(product.id, 1);
      const cookie = cookieHeader(add);

      stripeSessionsCreateMock.mockResolvedValue({ id: "cs_test_bad_token", url: "https://checkout.stripe.test/cs_test_bad_token" });

      const res = await app.inject({
        method: "POST",
        url: "/api/v1/checkout/session",
        headers: { cookie, authorization: "Bearer not-a-real-token" },
        payload: { customerEmail: "gecersiz-token@example.com", ...validCheckoutExtras() },
      });
      expect(res.statusCode).toBe(201);

      const order = await app.prisma.order.findFirst({ where: { customerEmail: "gecersiz-token@example.com" } });
      expect(order?.siteUserId).toBeNull();
    });
  });
});

// AYRI `describe`/`app` — CHECKOUT_RATE_LIMIT (10/dakika, IP bazlı, bkz. "checkout — rate limit"
// bloğu) yukarıdaki ana describe'da BİLE aşılabiliyor; her yeni senaryo grubunun kendi (temiz
// sayaçlı) app örneğinde çalışması bu YAN ETKİYİ önler.
describe("checkout — varyasyonlu ürün (§1.2/§1.5/§1.6)", () => {
  let app: FastifyInstance;

  function cookieHeader(res: { cookies: { name: string; value: string }[] }): string {
    return res.cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  }

  async function addToCart(productId: string, quantity: number, variantId?: string) {
    return app.inject({
      method: "POST",
      url: "/api/v1/cart/items",
      payload: variantId ? { productId, quantity, variantId } : { productId, quantity },
    });
  }

  beforeAll(async () => {
    app = await buildTestApp();
    await resetDatabase(app.prisma);
  });

  afterEach(() => {
    stripeSessionsCreateMock.mockReset();
  });

  afterAll(async () => {
    await resetDatabase(app.prisma);
    await app.close();
  });

  // .claude/architect-scope-ecommerce-pro-template.md §1.6/§9.4 — integration-agent görevi.
  describe("varyasyonlu ürün checkout'u (§1.2/§1.5/§1.6)", () => {
    async function createProductWithVariant(overrides: Partial<{ productPriceCents: number; variantPriceCents: number | null; variantStock: number; variantActive: boolean }> = {}) {
      const optionValues = { Renk: "Antrasit", Beden: "L" };
      const product = await app.prisma.product.create({
        data: {
          title: `Varyasyonlu Ürün ${crypto.randomUUID()}`,
          slug: `varyasyonlu-urun-${crypto.randomUUID()}`,
          priceCents: overrides.productPriceCents ?? 10000,
          currency: "TRY",
          stockQuantity: 0, // §1.2 — varyasyonlu üründe YOK SAYILIR.
          sku: `URUN-${crypto.randomUUID().slice(0, 6).toUpperCase()}`,
          status: "PUBLISHED",
          publishedAt: new Date(),
          variantOptions: [
            { name: "Renk", type: "SWATCH", values: [{ value: "Antrasit", swatchHex: "#333333" }] },
            { name: "Beden", type: "TEXT", values: [{ value: "L" }] },
          ],
        },
      });
      const variant = await app.prisma.productVariant.create({
        data: {
          productId: product.id,
          variantKey: deriveVariantKey(optionValues),
          optionValues,
          sku: `VAR-${crypto.randomUUID().slice(0, 6).toUpperCase()}`,
          priceCents: overrides.variantPriceCents === undefined ? 15000 : overrides.variantPriceCents,
          stockQuantity: overrides.variantStock ?? 5,
          isActive: overrides.variantActive ?? true,
        },
      });
      return { product, variant };
    }

    it("varyasyon fiyatı MUTLAK olarak kullanılır (ürün fiyatı DEĞİL), variantId/variantLabel/productSku snapshot'lanır", async () => {
      const { product, variant } = await createProductWithVariant({ productPriceCents: 10000, variantPriceCents: 15000 });
      const add = await addToCart(product.id, 2, variant.id);
      const cookie = cookieHeader(add);

      stripeSessionsCreateMock.mockResolvedValue({ id: "cs_test_variant", url: "https://checkout.stripe.test/cs_test_variant" });

      const res = await app.inject({
        method: "POST",
        url: "/api/v1/checkout/session",
        headers: { cookie },
        payload: { customerEmail: "varyasyon@example.com", ...validCheckoutExtras() },
      });
      expect(res.statusCode).toBe(201);

      const callArgs = stripeSessionsCreateMock.mock.calls[0]![0];
      expect(callArgs.line_items[0].price_data.unit_amount).toBe(15000);
      expect(callArgs.line_items[0].price_data.product_data.name).toContain("Antrasit / L");

      const order = await app.prisma.order.findFirst({ where: { customerEmail: "varyasyon@example.com" }, include: { items: true } });
      expect(order?.items[0]?.unitPriceCents).toBe(15000);
      expect(order?.items[0]?.variantId).toBe(variant.id);
      expect(order?.items[0]?.variantLabel).toBe("Antrasit / L");
      expect(order?.items[0]?.productSku).toBe(variant.sku);
      expect(order?.subtotalCents).toBe(30000);
    });

    it("varyasyon fiyatı null ise ürün fiyatı MİRAS ALINIR (§1.5)", async () => {
      const { product, variant } = await createProductWithVariant({ productPriceCents: 12000, variantPriceCents: null });
      const add = await addToCart(product.id, 1, variant.id);
      const cookie = cookieHeader(add);

      stripeSessionsCreateMock.mockResolvedValue({ id: "cs_test_variant_inherit", url: "https://checkout.stripe.test/cs_test_variant_inherit" });

      const res = await app.inject({
        method: "POST",
        url: "/api/v1/checkout/session",
        headers: { cookie },
        payload: { customerEmail: "varyasyon-miras@example.com", ...validCheckoutExtras() },
      });
      expect(res.statusCode).toBe(201);

      const order = await app.prisma.order.findFirst({ where: { customerEmail: "varyasyon-miras@example.com" }, include: { items: true } });
      expect(order?.items[0]?.unitPriceCents).toBe(12000);
    });

    it("varyasyon stoku sepete eklendikten SONRA yetersiz kalırsa 409 döner, Order oluşmaz", async () => {
      const { product, variant } = await createProductWithVariant({ variantStock: 1 });
      const add = await addToCart(product.id, 1, variant.id);
      const cookie = cookieHeader(add);

      await app.prisma.productVariant.update({ where: { id: variant.id }, data: { stockQuantity: 0 } });

      const before = await app.prisma.order.count();
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/checkout/session",
        headers: { cookie },
        payload: { customerEmail: "varyasyon-stoksuz@example.com", ...validCheckoutExtras() },
      });

      expect(res.statusCode).toBe(409);
      expect(stripeSessionsCreateMock).not.toHaveBeenCalled();
      expect(await app.prisma.order.count()).toBe(before);
    });

    it("varyasyon sepete eklendikten SONRA pasife alınırsa 409 döner", async () => {
      const { product, variant } = await createProductWithVariant();
      const add = await addToCart(product.id, 1, variant.id);
      const cookie = cookieHeader(add);

      await app.prisma.productVariant.update({ where: { id: variant.id }, data: { isActive: false } });

      const res = await app.inject({
        method: "POST",
        url: "/api/v1/checkout/session",
        headers: { cookie },
        payload: { customerEmail: "varyasyon-pasif@example.com", ...validCheckoutExtras() },
      });
      expect(res.statusCode).toBe(409);
      expect(stripeSessionsCreateMock).not.toHaveBeenCalled();
    });
  });
});

// .claude/architect-scope-ecommerce-pro-template.md §3.3/§9.4 — integration-agent görevi.
// AYRI `describe`/`app` — CHECKOUT_RATE_LIMIT gerekçesi yukarıdaki blokla AYNI.
describe("checkout — kargo tahsilatı (§3.3)", () => {
  let app: FastifyInstance;

  function cookieHeader(res: { cookies: { name: string; value: string }[] }): string {
    return res.cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  }

  async function createProduct(overrides: Partial<{ priceCents: number }> = {}) {
    return app.prisma.product.create({
      data: {
        title: `Kargo Ürünü ${crypto.randomUUID()}`,
        slug: `kargo-urun-${crypto.randomUUID()}`,
        priceCents: overrides.priceCents ?? 10000,
        currency: "TRY",
        stockQuantity: 10,
        status: "PUBLISHED",
        publishedAt: new Date(),
      },
    });
  }

  async function addToCart(productId: string, quantity: number) {
    return app.inject({ method: "POST", url: "/api/v1/cart/items", payload: { productId, quantity } });
  }

  beforeAll(async () => {
    app = await buildTestApp();
    await resetDatabase(app.prisma);
  });

  afterEach(async () => {
    stripeSessionsCreateMock.mockReset();
    await app.prisma.siteSettings.deleteMany({ where: { id: SETTINGS_ID } });
  });

  afterAll(async () => {
    await resetDatabase(app.prisma);
    await app.close();
  });

  describe("kargo tahsilatı (§3.3)", () => {
    it("shippingFlatFeeCents null iken (varsayılan) kargo hesaplanmaz — bugünkü davranış birebir korunur", async () => {
      const product = await createProduct({ priceCents: 10000 });
      const add = await addToCart(product.id, 1);
      const cookie = cookieHeader(add);

      stripeSessionsCreateMock.mockResolvedValue({ id: "cs_test_no_shipping", url: "https://checkout.stripe.test/cs_test_no_shipping" });

      const res = await app.inject({
        method: "POST",
        url: "/api/v1/checkout/session",
        headers: { cookie },
        payload: { customerEmail: "kargosuz@example.com", ...validCheckoutExtras() },
      });
      expect(res.statusCode).toBe(201);

      const callArgs = stripeSessionsCreateMock.mock.calls[0]![0];
      expect(callArgs.line_items).toHaveLength(1); // "Kargo" satırı YOK.

      const order = await app.prisma.order.findFirst({ where: { customerEmail: "kargosuz@example.com" } });
      expect(order?.shippingCents).toBe(0);
      expect(order?.totalCents).toBe(10000);
    });

    it("eşik altındayken kargo bedeli Order.shippingCents'e yazılır VE Stripe oturumuna AYRI bir 'Kargo' satırı olarak eklenir", async () => {
      await app.prisma.siteSettings.upsert({
        where: { id: SETTINGS_ID },
        create: { id: SETTINGS_ID, ...SETTINGS_DEFAULTS, shippingFlatFeeCents: 2500, freeShippingThresholdCents: 50000 },
        update: { shippingFlatFeeCents: 2500, freeShippingThresholdCents: 50000 },
      });

      const product = await createProduct({ priceCents: 10000 });
      const add = await addToCart(product.id, 1);
      const cookie = cookieHeader(add);

      stripeSessionsCreateMock.mockResolvedValue({ id: "cs_test_shipping", url: "https://checkout.stripe.test/cs_test_shipping" });

      const res = await app.inject({
        method: "POST",
        url: "/api/v1/checkout/session",
        headers: { cookie },
        payload: { customerEmail: "kargoli@example.com", ...validCheckoutExtras() },
      });
      expect(res.statusCode).toBe(201);

      const callArgs = stripeSessionsCreateMock.mock.calls[0]![0];
      expect(callArgs.line_items).toHaveLength(2);
      const shippingLine = callArgs.line_items[1];
      expect(shippingLine.price_data.unit_amount).toBe(2500);
      expect(shippingLine.price_data.product_data.name).toBe("Kargo");

      const order = await app.prisma.order.findFirst({ where: { customerEmail: "kargoli@example.com" } });
      expect(order?.shippingCents).toBe(2500);
      expect(order?.totalCents).toBe(12500); // 10000 + 2500 — gösterilen = tahsil edilen (§3.3).
    });

    it("eşiğe ULAŞILDIĞINDA (subtotal >= threshold) kargo 0'a düşer, 'Kargo' satırı Stripe'a EKLENMEZ", async () => {
      await app.prisma.siteSettings.upsert({
        where: { id: SETTINGS_ID },
        create: { id: SETTINGS_ID, ...SETTINGS_DEFAULTS, shippingFlatFeeCents: 2500, freeShippingThresholdCents: 50000 },
        update: { shippingFlatFeeCents: 2500, freeShippingThresholdCents: 50000 },
      });

      const product = await createProduct({ priceCents: 50000 });
      const add = await addToCart(product.id, 1);
      const cookie = cookieHeader(add);

      stripeSessionsCreateMock.mockResolvedValue({ id: "cs_test_free_shipping", url: "https://checkout.stripe.test/cs_test_free_shipping" });

      const res = await app.inject({
        method: "POST",
        url: "/api/v1/checkout/session",
        headers: { cookie },
        payload: { customerEmail: "ucretsiz-kargo@example.com", ...validCheckoutExtras() },
      });
      expect(res.statusCode).toBe(201);

      const callArgs = stripeSessionsCreateMock.mock.calls[0]![0];
      expect(callArgs.line_items).toHaveLength(1); // eşik dolu, kargo satırı yok.

      const order = await app.prisma.order.findFirst({ where: { customerEmail: "ucretsiz-kargo@example.com" } });
      expect(order?.shippingCents).toBe(0);
      expect(order?.totalCents).toBe(50000);
    });
  });
});

// .claude/architect-scope-checkout-redesign.md §5/§9 (bağlayıcı) — adres/fatura/yasal onay
// genişletmesi. AYRI `describe`/`app` — CHECKOUT_RATE_LIMIT gerekçesi yukarıdaki bloklarla AYNI.
describe("checkout — adres/fatura/yasal onay snapshot'ı (§3.3/§3.4/§3.5/§5.2)", () => {
  let app: FastifyInstance;

  function cookieHeader(res: { cookies: { name: string; value: string }[] }): string {
    return res.cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  }

  async function createProduct(overrides: Partial<{ priceCents: number }> = {}) {
    return app.prisma.product.create({
      data: {
        title: `Snapshot Ürünü ${crypto.randomUUID()}`,
        slug: `snapshot-urun-${crypto.randomUUID()}`,
        priceCents: overrides.priceCents ?? 10000,
        currency: "TRY",
        stockQuantity: 10,
        status: "PUBLISHED",
        publishedAt: new Date(),
      },
    });
  }

  async function addToCart(productId: string, quantity: number) {
    return app.inject({ method: "POST", url: "/api/v1/cart/items", payload: { productId, quantity } });
  }

  beforeAll(async () => {
    app = await buildTestApp();
    await resetDatabase(app.prisma);
  });

  afterEach(() => {
    stripeSessionsCreateMock.mockReset();
  });

  afterAll(async () => {
    await resetDatabase(app.prisma);
    await app.close();
  });

  it("misafir + bireysel (TCKN'siz) + sameAsShipping true → 201, teslimat/fatura adresi snapshot'ı DOLAR ve BİREBİR AYNIDIR", async () => {
    const product = await createProduct();
    const add = await addToCart(product.id, 1);
    const cookie = cookieHeader(add);

    stripeSessionsCreateMock.mockResolvedValue({ id: "cs_test_snapshot_individual", url: "https://checkout.stripe.test/cs_test_snapshot_individual" });

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/checkout/session",
      headers: { cookie },
      payload: { customerEmail: "snapshot-bireysel@example.com", ...validCheckoutExtras() },
    });
    expect(res.statusCode).toBe(201);

    const order = await app.prisma.order.findFirst({ where: { customerEmail: "snapshot-bireysel@example.com" } });
    expect(order?.customerName).toBe("Ada Lovelace"); // customerName gönderilmedi → shippingAddress.fullName kullanıldı.
    expect(order?.shippingAddressFullName).toBe("Ada Lovelace");
    expect(order?.shippingAddressCity).toBe("İstanbul");
    expect(order?.shippingAddressPostalCode).toBe("34710");
    expect(order?.billingType).toBe("INDIVIDUAL");
    expect(order?.billingNationalId).toBeNull();
    // sameAsShipping true (varsayılan) → fatura adresi teslimat adresinin BİREBİR KOPYASI, bayrak DB'ye YAZILMAZ.
    expect(order?.billingAddressFullName).toBe(order?.shippingAddressFullName);
    expect(order?.billingAddressCity).toBe(order?.shippingAddressCity);
    expect(order?.billingAddressLine1).toBe(order?.shippingAddressLine1);
    expect(order?.distanceSalesApprovedAt).not.toBeNull();
    expect(order?.preliminaryInfoApprovedAt).not.toBeNull();
  });

  it("misafir + kurumsal + ayrı fatura adresi (sameAsShipping false) → 201, doğru kolonlar dolar", async () => {
    const product = await createProduct();
    const add = await addToCart(product.id, 1);
    const cookie = cookieHeader(add);

    stripeSessionsCreateMock.mockResolvedValue({ id: "cs_test_snapshot_corporate", url: "https://checkout.stripe.test/cs_test_snapshot_corporate" });

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/checkout/session",
      headers: { cookie },
      payload: {
        customerEmail: "snapshot-kurumsal@example.com",
        ...validCheckoutExtras({
          billing: {
            billingType: "CORPORATE",
            companyName: "Acme Yazılım A.Ş.",
            taxOffice: "Kadıköy",
            taxNumber: "1234567890",
            sameAsShipping: false,
            address: validShippingAddress({ fullName: "Acme Yazılım A.Ş. Muhasebe", city: "Ankara", district: "Çankaya" }),
          },
        }),
      },
    });
    expect(res.statusCode).toBe(201);

    const order = await app.prisma.order.findFirst({ where: { customerEmail: "snapshot-kurumsal@example.com" } });
    expect(order?.billingType).toBe("CORPORATE");
    expect(order?.billingCompanyName).toBe("Acme Yazılım A.Ş.");
    expect(order?.billingTaxNumber).toBe("1234567890");
    expect(order?.billingNationalId).toBeNull();
    // Ayrı fatura adresi — teslimat adresinden FARKLI.
    expect(order?.billingAddressCity).toBe("Ankara");
    expect(order?.shippingAddressCity).toBe("İstanbul");
    expect(order?.billingAddressFullName).toBe("Acme Yazılım A.Ş. Muhasebe");
  });

  it("kurumsal ama taxNumber eksik → 422, hata `billing.taxNumber` ALTINDA görünür", async () => {
    const product = await createProduct();
    const add = await addToCart(product.id, 1);
    const cookie = cookieHeader(add);

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/checkout/session",
      headers: { cookie },
      payload: {
        customerEmail: "kurumsal-eksik@example.com",
        ...validCheckoutExtras({ billing: { billingType: "CORPORATE", companyName: "Acme A.Ş." } }),
      },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.details["billing.taxNumber"]).toContain("Vergi numarası 10 haneli olmalıdır.");
    expect(stripeSessionsCreateMock).not.toHaveBeenCalled();
  });

  it("kurumsal faturada nationalId gönderilirse 422 (`billing.nationalId`)", async () => {
    const product = await createProduct();
    const add = await addToCart(product.id, 1);
    const cookie = cookieHeader(add);

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/checkout/session",
      headers: { cookie },
      payload: {
        customerEmail: "kurumsal-tckn@example.com",
        ...validCheckoutExtras({
          billing: { billingType: "CORPORATE", companyName: "Acme A.Ş.", taxNumber: "1234567890", nationalId: VALID_TCKN },
        }),
      },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.details["billing.nationalId"]).toBeDefined();
  });

  it("bireysel faturada companyName gönderilirse 422 (`billing.companyName`)", async () => {
    const product = await createProduct();
    const add = await addToCart(product.id, 1);
    const cookie = cookieHeader(add);

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/checkout/session",
      headers: { cookie },
      payload: {
        customerEmail: "bireysel-firma@example.com",
        ...validCheckoutExtras({ billing: { billingType: "INDIVIDUAL", companyName: "Acme A.Ş." } }),
      },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.details["billing.companyName"]).toBeDefined();
  });

  it("sameAsShipping true iken billing.address gönderilirse 422 (`billing.address`)", async () => {
    const product = await createProduct();
    const add = await addToCart(product.id, 1);
    const cookie = cookieHeader(add);

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/checkout/session",
      headers: { cookie },
      payload: {
        customerEmail: "sameas-true-address@example.com",
        ...validCheckoutExtras({ billing: { billingType: "INDIVIDUAL", address: validShippingAddress() } }),
      },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.details["billing.address"]).toBeDefined();
  });
});

// AYRI `describe`/`app` — yukarıdaki blok + bu blok toplamda CHECKOUT_RATE_LIMIT'i (10/dakika)
// aşacağından (12 senaryo), ikiye bölündü (bkz. dosya başındaki "AYRI describe/app" gerekçesi).
describe("checkout — adres/fatura/yasal onay snapshot'ı, devamı (§3.3/§3.4/§3.5/§5.2)", () => {
  let app: FastifyInstance;

  function cookieHeader(res: { cookies: { name: string; value: string }[] }): string {
    return res.cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  }

  async function createProduct(overrides: Partial<{ priceCents: number }> = {}) {
    return app.prisma.product.create({
      data: {
        title: `Snapshot Ürünü 2 ${crypto.randomUUID()}`,
        slug: `snapshot-urun-2-${crypto.randomUUID()}`,
        priceCents: overrides.priceCents ?? 10000,
        currency: "TRY",
        stockQuantity: 10,
        status: "PUBLISHED",
        publishedAt: new Date(),
      },
    });
  }

  async function addToCart(productId: string, quantity: number) {
    return app.inject({ method: "POST", url: "/api/v1/cart/items", payload: { productId, quantity } });
  }

  beforeAll(async () => {
    app = await buildTestApp();
    await resetDatabase(app.prisma);
  });

  afterEach(() => {
    stripeSessionsCreateMock.mockReset();
  });

  afterAll(async () => {
    await resetDatabase(app.prisma);
    await app.close();
  });

  it("sameAsShipping false iken billing.address EKSİKSE 422 (`billing.address`)", async () => {
    const product = await createProduct();
    const add = await addToCart(product.id, 1);
    const cookie = cookieHeader(add);

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/checkout/session",
      headers: { cookie },
      payload: {
        customerEmail: "sameas-false-missing@example.com",
        ...validCheckoutExtras({ billing: { billingType: "INDIVIDUAL", sameAsShipping: false } }),
      },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.details["billing.address"]).toBeDefined();
  });

  it("geçersiz TCKN (checksum tutmayan 11 hane) → 422 (`billing.nationalId`)", async () => {
    const product = await createProduct();
    const add = await addToCart(product.id, 1);
    const cookie = cookieHeader(add);

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/checkout/session",
      headers: { cookie },
      payload: {
        customerEmail: "gecersiz-tckn@example.com",
        ...validCheckoutExtras({ billing: { billingType: "INDIVIDUAL", nationalId: "10000000145" } }),
      },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.details["billing.nationalId"]).toContain("Geçerli bir T.C. kimlik numarası giriniz.");
  });

  it("geçerli TCKN gönderilirse INDIVIDUAL'da kabul edilir ve snapshot'lanır", async () => {
    const product = await createProduct();
    const add = await addToCart(product.id, 1);
    const cookie = cookieHeader(add);

    stripeSessionsCreateMock.mockResolvedValue({ id: "cs_test_valid_tckn", url: "https://checkout.stripe.test/cs_test_valid_tckn" });

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/checkout/session",
      headers: { cookie },
      payload: {
        customerEmail: "gecerli-tckn@example.com",
        ...validCheckoutExtras({ billing: { billingType: "INDIVIDUAL", nationalId: VALID_TCKN } }),
      },
    });
    expect(res.statusCode).toBe(201);

    const order = await app.prisma.order.findFirst({ where: { customerEmail: "gecerli-tckn@example.com" } });
    expect(order?.billingNationalId).toBe(VALID_TCKN);
  });

  it("yasal onay kutuları işaretlenmemiş (false) → 422, iki alan ayrı ayrı raporlanır", async () => {
    const product = await createProduct();
    const add = await addToCart(product.id, 1);
    const cookie = cookieHeader(add);

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/checkout/session",
      headers: { cookie },
      payload: {
        customerEmail: "onay-yok@example.com",
        ...validCheckoutExtras(),
        distanceSalesApproved: false,
        preliminaryInfoApproved: false,
      },
    });
    expect(res.statusCode).toBe(422);
    const details = res.json().error.details;
    expect(details.distanceSalesApproved).toContain("Mesafeli Satış Sözleşmesi'ni onaylamanız gerekir.");
    expect(details.preliminaryInfoApproved).toContain("Ön Bilgilendirme Formu'nu onaylamanız gerekir.");
  });

  it("TR posta kodu 5 haneli değilse 422 (`shippingAddress.postalCode`)", async () => {
    const product = await createProduct();
    const add = await addToCart(product.id, 1);
    const cookie = cookieHeader(add);

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/checkout/session",
      headers: { cookie },
      payload: {
        customerEmail: "gecersiz-posta@example.com",
        ...validCheckoutExtras({ shippingAddress: { postalCode: "123" } }),
      },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.details["shippingAddress.postalCode"]).toContain("Posta kodu 5 haneli olmalıdır.");
  });

  it("üye kullanıcı checkout'unda sipariş siteUserId ile ilişkilendirilir (adres/fatura akışıyla birlikte)", async () => {
    const buyer = await registerTestUser(app, { email: `checkout-snapshot-${crypto.randomUUID()}@example.com` });
    const product = await createProduct();
    const add = await addToCart(product.id, 1);
    const cookie = cookieHeader(add);

    stripeSessionsCreateMock.mockResolvedValue({ id: "cs_test_member_snapshot", url: "https://checkout.stripe.test/cs_test_member_snapshot" });

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/checkout/session",
      headers: { cookie, authorization: `Bearer ${buyer.accessToken}` },
      payload: { customerEmail: "uye-snapshot@example.com", ...validCheckoutExtras() },
    });
    expect(res.statusCode).toBe(201);

    const order = await app.prisma.order.findFirst({ where: { customerEmail: "uye-snapshot@example.com" } });
    expect(order?.siteUserId).toBe(buyer.userId);
    expect(order?.shippingAddressFullName).toBe("Ada Lovelace");
  });
});

describe("checkout — rate limit (10/dakika, IP bazlı)", () => {
  let app: FastifyInstance;

  function cookieHeader(res: { cookies: { name: string; value: string }[] }): string {
    return res.cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  }

  beforeAll(async () => {
    app = await buildTestApp();
    await resetDatabase(app.prisma);
    // Her çağrıda BENZERSİZ bir session id döner — `Order.stripeCheckoutSessionId` @unique
    // olduğu için aynı id'nin tekrar dönmesi ikinci Order.update()'te unique constraint ihlaline
    // yol açar (gerçek Stripe API'si de her zaman benzersiz bir session id üretir).
    stripeSessionsCreateMock.mockImplementation(async () => {
      const id = `cs_test_rl_${crypto.randomUUID()}`;
      return { id, url: `https://checkout.stripe.test/${id}` };
    });
  });

  afterAll(async () => {
    stripeSessionsCreateMock.mockReset();
    await resetDatabase(app.prisma);
    await app.close();
  });

  it("10 istek başarılı (201), 11. istek 429 döner", async () => {
    const product = await app.prisma.product.create({
      data: {
        title: "Rate Limit Ürünü",
        slug: `rate-limit-urun-${crypto.randomUUID()}`,
        priceCents: 1000,
        currency: "TRY",
        stockQuantity: 1000,
        status: "PUBLISHED",
        publishedAt: new Date(),
      },
    });
    const add = await app.inject({ method: "POST", url: "/api/v1/cart/items", payload: { productId: product.id, quantity: 1 } });
    const cookie = cookieHeader(add);

    for (let i = 0; i < 10; i++) {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/checkout/session",
        headers: { cookie },
        payload: { customerEmail: `rl-${i}@example.com`, ...validCheckoutExtras() },
      });
      expect(res.statusCode).toBe(201);
    }

    const res11 = await app.inject({
      method: "POST",
      url: "/api/v1/checkout/session",
      headers: { cookie },
      payload: { customerEmail: "rl-11@example.com", ...validCheckoutExtras() },
    });

    expect(res11.statusCode).toBe(429);
    expect(res11.json().error.code).toBe("RATE_LIMITED");
  });
});
