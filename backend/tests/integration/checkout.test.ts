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

  it("boş sepette (cookie yok) 409 döner", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/checkout/session",
      payload: { customerEmail: "musteri@example.com" },
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
      payload: { customerEmail: "musteri@example.com", customerName: "Ada Lovelace" },
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
      payload: { customerEmail: "stoksuz@example.com" },
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
      payload: { customerEmail: "gecersiz-eposta" },
    });
    expect(res.statusCode).toBe(422);
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
        payload: { customerEmail: `rl-${i}@example.com` },
      });
      expect(res.statusCode).toBe(201);
    }

    const res11 = await app.inject({
      method: "POST",
      url: "/api/v1/checkout/session",
      headers: { cookie },
      payload: { customerEmail: "rl-11@example.com" },
    });

    expect(res11.statusCode).toBe(429);
    expect(res11.json().error.code).toBe("RATE_LIMITED");
  });
});
