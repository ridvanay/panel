import crypto from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestApp } from "../helpers/build-test-app";
import { resetDatabase } from "../helpers/reset-db";

/**
 * §10.9.3 Sepet + Stripe Checkout — `/cart` uçları PUBLIC'tir, kimlik doğrulama GEREKMEZ.
 * `cart_token` httpOnly çerezi `app.inject()`'in döndüğü `res.cookies` üzerinden okunup
 * bir sonraki isteğe `cookie` header'ı olarak elle taşınır (bkz. tests/integration/
 * users.test.ts/security.test.ts ile AYNI patern).
 */
describe("cart (§10.9.3 Sepet + Stripe Checkout)", () => {
  let app: FastifyInstance;

  function cookieHeader(res: { cookies: { name: string; value: string }[] }): string {
    return res.cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  }

  async function createProduct(overrides: Partial<{ priceCents: number; currency: string; stockQuantity: number; discountPriceCents: number | null }> = {}) {
    return app.prisma.product.create({
      data: {
        title: `Test Ürün ${crypto.randomUUID()}`,
        slug: `test-urun-${crypto.randomUUID()}`,
        priceCents: overrides.priceCents ?? 10000,
        currency: overrides.currency ?? "TRY",
        stockQuantity: overrides.stockQuantity ?? 10,
        discountPriceCents: overrides.discountPriceCents ?? null,
        status: "PUBLISHED",
        publishedAt: new Date(),
      },
    });
  }

  beforeAll(async () => {
    app = await buildTestApp();
    await resetDatabase(app.prisma);
  });

  afterAll(async () => {
    await resetDatabase(app.prisma);
    await app.close();
  });

  it("cookie yokken GET /cart boş sepet döner", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/cart" });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual({ items: [], currency: null, subtotalCents: 0 });
  });

  it("olmayan/taslak bir ürün için POST /cart/items 404 döner", async () => {
    const draftProduct = await app.prisma.product.create({
      data: { title: "Taslak Ürün", slug: `taslak-${crypto.randomUUID()}`, priceCents: 5000, status: "DRAFT" },
    });

    const missing = await app.inject({
      method: "POST",
      url: "/api/v1/cart/items",
      payload: { productId: crypto.randomUUID(), quantity: 1 },
    });
    expect(missing.statusCode).toBe(404);

    const draft = await app.inject({
      method: "POST",
      url: "/api/v1/cart/items",
      payload: { productId: draftProduct.id, quantity: 1 },
    });
    expect(draft.statusCode).toBe(404);
  });

  it("stokta olmayan (stockQuantity: 0) ürün eklenemez (409)", async () => {
    const outOfStock = await createProduct({ stockQuantity: 0 });

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/cart/items",
      payload: { productId: outOfStock.id, quantity: 1 },
    });
    expect(res.statusCode).toBe(409);
  });

  it("ilk POST /cart/items yeni bir sepet+cart_token çerezi oluşturur", async () => {
    const product = await createProduct({ priceCents: 15000, discountPriceCents: 12000 });

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/cart/items",
      payload: { productId: product.id, quantity: 2 },
    });

    expect(res.statusCode).toBe(201);
    const cartCookie = res.cookies.find((c) => c.name === "cart_token");
    expect(cartCookie).toBeDefined();
    expect(cartCookie?.httpOnly).toBe(true);
    expect(cartCookie?.sameSite).toBe("Lax");
    expect(cartCookie?.path).toBe("/");

    const body = res.json().data;
    expect(body.currency).toBe("TRY");
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({
      productId: product.id,
      quantity: 2,
      // İndirimli fiyat sepete eklenirken dondurulur.
      frozenUnitPriceCents: 12000,
      currentPriceCents: 12000,
      lineTotalCents: 24000,
    });
    expect(body.subtotalCents).toBe(24000);
  });

  it("aynı ürün tekrar eklenince miktar artar (yeni satır oluşmaz), cookie GET /cart'ta çalışır", async () => {
    const product = await createProduct({ priceCents: 5000 });

    const first = await app.inject({
      method: "POST",
      url: "/api/v1/cart/items",
      payload: { productId: product.id, quantity: 1 },
    });
    const cookie = cookieHeader(first);

    const second = await app.inject({
      method: "POST",
      url: "/api/v1/cart/items",
      headers: { cookie },
      payload: { productId: product.id, quantity: 3 },
    });
    expect(second.statusCode).toBe(201);
    expect(second.json().data.items).toHaveLength(1);
    expect(second.json().data.items[0].quantity).toBe(4);

    const get = await app.inject({ method: "GET", url: "/api/v1/cart", headers: { cookie } });
    expect(get.statusCode).toBe(200);
    expect(get.json().data.items[0].quantity).toBe(4);
  });

  it("dolu bir sepete farklı para birimli ürün eklenirse 409 CONFLICT döner", async () => {
    const tryProduct = await createProduct({ currency: "TRY" });
    const usdProduct = await createProduct({ currency: "USD" });

    const first = await app.inject({
      method: "POST",
      url: "/api/v1/cart/items",
      payload: { productId: tryProduct.id, quantity: 1 },
    });
    const cookie = cookieHeader(first);

    const conflict = await app.inject({
      method: "POST",
      url: "/api/v1/cart/items",
      headers: { cookie },
      payload: { productId: usdProduct.id, quantity: 1 },
    });
    expect(conflict.statusCode).toBe(409);
  });

  it("fiyat sepete eklendikten sonra değişirse frozenUnitPriceCents/currentPriceCents ayrışır", async () => {
    const product = await createProduct({ priceCents: 8000 });

    const add = await app.inject({
      method: "POST",
      url: "/api/v1/cart/items",
      payload: { productId: product.id, quantity: 1 },
    });
    const cookie = cookieHeader(add);

    await app.prisma.product.update({ where: { id: product.id }, data: { priceCents: 9500 } });

    const get = await app.inject({ method: "GET", url: "/api/v1/cart", headers: { cookie } });
    const item = get.json().data.items[0];
    expect(item.frozenUnitPriceCents).toBe(8000);
    expect(item.currentPriceCents).toBe(9500);
  });

  it("PATCH /cart/items/:itemId miktarı günceller", async () => {
    const product = await createProduct();
    const add = await app.inject({
      method: "POST",
      url: "/api/v1/cart/items",
      payload: { productId: product.id, quantity: 1 },
    });
    const cookie = cookieHeader(add);
    const itemId = add.json().data.items[0].id;

    const patch = await app.inject({
      method: "PATCH",
      url: `/api/v1/cart/items/${itemId}`,
      headers: { cookie },
      payload: { quantity: 5 },
    });
    expect(patch.statusCode).toBe(200);
    expect(patch.json().data.items[0].quantity).toBe(5);
  });

  it("başka bir sepetin item'ını PATCH/DELETE etmeye çalışmak 404 döner", async () => {
    const productA = await createProduct();
    const addA = await app.inject({
      method: "POST",
      url: "/api/v1/cart/items",
      payload: { productId: productA.id, quantity: 1 },
    });
    const itemIdA = addA.json().data.items[0].id;

    const productB = await createProduct();
    const addB = await app.inject({
      method: "POST",
      url: "/api/v1/cart/items",
      payload: { productId: productB.id, quantity: 1 },
    });
    const cookieB = cookieHeader(addB);

    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/cart/items/${itemIdA}`,
      headers: { cookie: cookieB },
      payload: { quantity: 2 },
    });
    expect(res.statusCode).toBe(404);
  });

  it("DELETE /cart/items/:itemId sepetten kaldırır", async () => {
    const product = await createProduct();
    const add = await app.inject({
      method: "POST",
      url: "/api/v1/cart/items",
      payload: { productId: product.id, quantity: 1 },
    });
    const cookie = cookieHeader(add);
    const itemId = add.json().data.items[0].id;

    const del = await app.inject({ method: "DELETE", url: `/api/v1/cart/items/${itemId}`, headers: { cookie } });
    expect(del.statusCode).toBe(204);

    const get = await app.inject({ method: "GET", url: "/api/v1/cart", headers: { cookie } });
    expect(get.json().data.items).toHaveLength(0);
  });
});
