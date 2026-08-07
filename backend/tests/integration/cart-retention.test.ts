import crypto from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestApp } from "../helpers/build-test-app";
import { resetDatabase } from "../helpers/reset-db";
import { runCartRetentionSweep } from "../../src/lib/cart-retention";

/**
 * §10.9.3 Sepet + Stripe Checkout — `lib/cart-retention.ts::runCartRetentionSweep` doğrudan
 * çağrılır (gerçek zaman-tetiklemeli `setInterval` zamanlayıcısı — bkz.
 * `registerCartRetentionSweeper` — production sarmalayıcısıdır, burada test edilen ASIL iş
 * mantığı değildir). `import-retention.test.ts`/`scheduled-publish.test.ts` İLE AYNI PATERN.
 *
 * `CART_TOKEN_TTL_DAYS` (30 gün) kendisi cart.test.ts'te cookie `maxAge` üzerinden dolaylı
 * doğrulanır; burada asıl sessiz-silme (sweep) davranışı doğrulanır.
 */
describe("sepet saklama süresi taraması (cart-retention, §10.9.3)", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
    await resetDatabase(app.prisma);
  });

  afterAll(async () => {
    await resetDatabase(app.prisma);
    await app.close();
  });

  async function createProduct() {
    return app.prisma.product.create({
      data: {
        title: `Retention Ürünü ${crypto.randomUUID()}`,
        slug: `retention-urun-${crypto.randomUUID()}`,
        priceCents: 10000,
        currency: "TRY",
        stockQuantity: 10,
        status: "PUBLISHED",
        publishedAt: new Date(),
      },
    });
  }

  async function createCart(expiresAt: Date, withItem = true) {
    const cart = await app.prisma.cart.create({
      data: { tokenHash: crypto.randomUUID(), currency: "TRY", expiresAt },
    });
    if (withItem) {
      const product = await createProduct();
      await app.prisma.cartItem.create({
        data: { cartId: cart.id, productId: product.id, quantity: 1, unitPriceCents: 10000 },
      });
    }
    return cart;
  }

  it("expiresAt geçmişte olan bir sepeti (ve CartItem'larını) SESSİZCE siler", async () => {
    const expired = await createCart(new Date(Date.now() - 24 * 60 * 60 * 1000));

    const result = await runCartRetentionSweep(app);
    expect(result.deletedCarts).toBeGreaterThanOrEqual(1);

    const cartAfter = await app.prisma.cart.findUnique({ where: { id: expired.id } });
    expect(cartAfter).toBeNull();

    // `CartItem.cart` -> `onDelete: Cascade` — çocuk satırlar da gitmiş olmalı.
    const itemsAfter = await app.prisma.cartItem.findMany({ where: { cartId: expired.id } });
    expect(itemsAfter).toHaveLength(0);
  });

  it("expiresAt gelecekte olan (henüz süresi dolmamış) bir sepete DOKUNMAZ", async () => {
    const active = await createCart(new Date(Date.now() + 24 * 60 * 60 * 1000));

    await runCartRetentionSweep(app);

    const cartAfter = await app.prisma.cart.findUnique({ where: { id: active.id } });
    expect(cartAfter).not.toBeNull();
  });

  it("süresi dolmuş bir sepetteki ürünün STOĞU etkilenmez (yalnızca sepet silinir, Product dokunulmaz)", async () => {
    const expired = await createCart(new Date(Date.now() - 60 * 1000));
    const item = await app.prisma.cartItem.findFirstOrThrow({ where: { cartId: expired.id } });
    const productBefore = await app.prisma.product.findUniqueOrThrow({ where: { id: item.productId } });

    await runCartRetentionSweep(app);

    const productAfter = await app.prisma.product.findUniqueOrThrow({ where: { id: item.productId } });
    expect(productAfter.stockQuantity).toBe(productBefore.stockQuantity);
  });

  it("idempotenttir — ardışık iki çalıştırmada ikincisi 0 sepet siler, hata FIRLATMAZ", async () => {
    await createCart(new Date(Date.now() - 60 * 1000));

    const first = await runCartRetentionSweep(app);
    expect(first.deletedCarts).toBeGreaterThanOrEqual(1);

    const second = await runCartRetentionSweep(app);
    expect(second.deletedCarts).toBe(0);
  });

  it("süresi geçmiş bir sepetin cookie'siyle GET /cart yapılırsa boş sepet döner (sweep beklenmeden de görünmez)", async () => {
    const rawToken = "expired-raw-token-for-cookie-test";
    const { hashToken } = await import("../../src/lib/tokens");
    await app.prisma.cart.create({
      data: { tokenHash: hashToken(rawToken), currency: "TRY", expiresAt: new Date(Date.now() - 1000) },
    });

    const res = await app.inject({ method: "GET", url: "/api/v1/cart", headers: { cookie: `cart_token=${rawToken}` } });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual({ items: [], currency: null, subtotalCents: 0 });
  });
});
