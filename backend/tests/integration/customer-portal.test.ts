import crypto from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestApp } from "../helpers/build-test-app";
import { resetDatabase } from "../helpers/reset-db";
import { hashPassword } from "../../src/lib/password";
import { signAccessToken } from "../../src/lib/jwt";

/**
 * Müşteri & E-Ticaret Alanı (Customer Portal) — bkz. `.claude/architect-scope-customer-portal.md`
 * §9 (qa-agent test matrisi, bağlayıcı). Bu dosya backend-agent'ın kapsama giren madde 1-13'ünü
 * (adres/favori/sipariş detayı CRUD'u + IDOR izolasyonu + modül guard matrisi) kapsar.
 *
 * NOT: `users-orders.test.ts` ile AYNI desen — kullanıcılar doğrudan Prisma ile oluşturulur,
 * token `signAccessToken()` ile üretilir (AUTH_RATE_LIMIT'e takılmadan çok sayıda kullanıcı).
 */
describe("customer portal — adresler, favoriler, sipariş detayı (§9)", () => {
  let app: FastifyInstance;

  function authHeader(token: string) {
    return { authorization: `Bearer ${token}` };
  }

  function tokenFor(user: { id: string; email: string }): string {
    return signAccessToken({ sub: user.id, email: user.email }).token;
  }

  async function createUserWithRole(role: "ADMIN" | "MANAGER" | "EDITOR" | "CUSTOMER" | "USER" = "USER") {
    const passwordHash = await hashPassword("Sifre12345!");
    return app.prisma.user.create({
      data: {
        email: `cp-user-${crypto.randomUUID()}@example.com`,
        name: "Test Kullanıcı",
        passwordHash,
        role,
        status: "ACTIVE",
      },
    });
  }

  async function createProduct(overrides: Partial<{ status: "DRAFT" | "PUBLISHED" | "SCHEDULED"; deletedAt: Date | null }> = {}) {
    return app.prisma.product.create({
      data: {
        title: `Test Ürünü ${crypto.randomUUID()}`,
        slug: `test-urunu-${crypto.randomUUID()}`,
        priceCents: 5000,
        currency: "TRY",
        stockQuantity: 100,
        status: overrides.status ?? "PUBLISHED",
        publishedAt: (overrides.status ?? "PUBLISHED") === "PUBLISHED" ? new Date() : null,
        deletedAt: overrides.deletedAt ?? null,
      },
    });
  }

  async function createOrderFor(siteUserId: string | null) {
    return app.prisma.order.create({
      data: {
        orderNumber: `ORD-CP-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
        siteUserId,
        customerEmail: `musteri-${crypto.randomUUID()}@example.com`,
        status: "PAID",
        currency: "TRY",
        subtotalCents: 5000,
        discountCents: 0,
        taxCents: 0,
        totalCents: 5000,
        paidAt: new Date(),
        items: { create: [{ productTitle: "Test Ürün", productSku: null, unitPriceCents: 5000, quantity: 1, lineTotalCents: 5000 }] },
      },
    });
  }

  async function setProductsModuleEnabled(enabled: boolean) {
    await app.prisma.siteModule.upsert({
      where: { key: "products" },
      create: { key: "products", enabled },
      update: { enabled },
    });
  }

  const validAddressPayload = {
    title: "Ev",
    fullName: "Ada Lovelace",
    phone: "+90 555 123 45 67",
    city: "İstanbul",
    district: "Kadıköy",
    addressLine1: "Bahariye Cd. No:1",
  };

  beforeAll(async () => {
    app = await buildTestApp();
    await resetDatabase(app.prisma);
  });

  afterAll(async () => {
    await resetDatabase(app.prisma);
    await app.close();
  });

  // ---------- Adres defteri (§2.2) ----------

  describe("adresler", () => {
    it("kimliksiz istekler 401 döner", async () => {
      const getRes = await app.inject({ method: "GET", url: "/api/v1/users/me/addresses" });
      expect(getRes.statusCode).toBe(401);

      const postRes = await app.inject({ method: "POST", url: "/api/v1/users/me/addresses", payload: validAddressPayload });
      expect(postRes.statusCode).toBe(401);
    });

    it("tam CRUD turu: POST 201 -> GET 200 -> PATCH 200 -> DELETE 204", async () => {
      const user = await createUserWithRole();
      const token = tokenFor(user);

      const createRes = await app.inject({
        method: "POST",
        url: "/api/v1/users/me/addresses",
        headers: authHeader(token),
        payload: validAddressPayload,
      });
      expect(createRes.statusCode).toBe(201);
      const created = createRes.json().data;
      expect(created.title).toBe("Ev");
      // İlk adres OTOMATİK varsayılandır (§2.2) — `isDefault` gönderilmese de.
      expect(created.isDefault).toBe(true);

      const listRes = await app.inject({ method: "GET", url: "/api/v1/users/me/addresses", headers: authHeader(token) });
      expect(listRes.statusCode).toBe(200);
      expect(listRes.json().data).toHaveLength(1);

      const patchRes = await app.inject({
        method: "PATCH",
        url: `/api/v1/users/me/addresses/${created.id}`,
        headers: authHeader(token),
        payload: { title: "İş" },
      });
      expect(patchRes.statusCode).toBe(200);
      expect(patchRes.json().data.title).toBe("İş");
      expect(patchRes.json().data.fullName).toBe("Ada Lovelace"); // kısmi güncelleme — diğer alanlar korunur

      const deleteRes = await app.inject({
        method: "DELETE",
        url: `/api/v1/users/me/addresses/${created.id}`,
        headers: authHeader(token),
      });
      expect(deleteRes.statusCode).toBe(204);

      const afterDelete = await app.inject({ method: "GET", url: "/api/v1/users/me/addresses", headers: authHeader(token) });
      expect(afterDelete.json().data).toHaveLength(0);
    });

    it("başkasının addressId'siyle PATCH/DELETE 404 döner (403 DEĞİL — IDOR koruması)", async () => {
      const owner = await createUserWithRole();
      const intruder = await createUserWithRole();

      const createRes = await app.inject({
        method: "POST",
        url: "/api/v1/users/me/addresses",
        headers: authHeader(tokenFor(owner)),
        payload: validAddressPayload,
      });
      const addressId = createRes.json().data.id;

      const patchRes = await app.inject({
        method: "PATCH",
        url: `/api/v1/users/me/addresses/${addressId}`,
        headers: authHeader(tokenFor(intruder)),
        payload: { title: "Ele geçirilmiş" },
      });
      expect(patchRes.statusCode).toBe(404);

      const deleteRes = await app.inject({
        method: "DELETE",
        url: `/api/v1/users/me/addresses/${addressId}`,
        headers: authHeader(tokenFor(intruder)),
      });
      expect(deleteRes.statusCode).toBe(404);

      // Sahibi hâlâ kendi adresine erişebiliyor — silinmedi.
      const ownerList = await app.inject({ method: "GET", url: "/api/v1/users/me/addresses", headers: authHeader(tokenFor(owner)) });
      expect(ownerList.json().data).toHaveLength(1);
    });

    it("21. adres 409 döner (20 adres sınırı)", async () => {
      const user = await createUserWithRole();
      const token = tokenFor(user);

      for (let i = 0; i < 20; i++) {
        const res = await app.inject({
          method: "POST",
          url: "/api/v1/users/me/addresses",
          headers: authHeader(token),
          payload: { ...validAddressPayload, title: `Adres ${i}` },
        });
        expect(res.statusCode).toBe(201);
      }

      const overLimit = await app.inject({
        method: "POST",
        url: "/api/v1/users/me/addresses",
        headers: authHeader(token),
        payload: { ...validAddressPayload, title: "Adres 21" },
      });
      expect(overLimit.statusCode).toBe(409);
    });

    it("varsayılan adres silinirse seq'i en küçük kalan adres varsayılan olur", async () => {
      const user = await createUserWithRole();
      const token = tokenFor(user);

      const first = await app.inject({
        method: "POST",
        url: "/api/v1/users/me/addresses",
        headers: authHeader(token),
        payload: { ...validAddressPayload, title: "Birinci" },
      });
      const second = await app.inject({
        method: "POST",
        url: "/api/v1/users/me/addresses",
        headers: authHeader(token),
        payload: { ...validAddressPayload, title: "İkinci" },
      });
      expect(first.json().data.isDefault).toBe(true);
      expect(second.json().data.isDefault).toBe(false);

      await app.inject({
        method: "DELETE",
        url: `/api/v1/users/me/addresses/${first.json().data.id}`,
        headers: authHeader(token),
      });

      const listRes = await app.inject({ method: "GET", url: "/api/v1/users/me/addresses", headers: authHeader(token) });
      expect(listRes.json().data).toEqual([expect.objectContaining({ id: second.json().data.id, isDefault: true })]);
    });
  });

  // ---------- Favoriler / wishlist (§2.3) ----------

  describe("favoriler (wishlist)", () => {
    it("kimliksiz istekler 401 döner", async () => {
      const res = await app.inject({ method: "GET", url: "/api/v1/users/me/wishlist" });
      expect(res.statusCode).toBe(401);
    });

    it("products AÇIK: ekle (201) -> tekrar ekle (200 idempotent) -> sil (204) -> tekrar sil (204 idempotent)", async () => {
      await setProductsModuleEnabled(true);
      const user = await createUserWithRole();
      const token = tokenFor(user);
      const product = await createProduct();

      const addRes = await app.inject({
        method: "POST",
        url: "/api/v1/users/me/wishlist",
        headers: authHeader(token),
        payload: { productId: product.id },
      });
      expect(addRes.statusCode).toBe(201);
      expect(addRes.json().data.productId).toBe(product.id);

      const addAgainRes = await app.inject({
        method: "POST",
        url: "/api/v1/users/me/wishlist",
        headers: authHeader(token),
        payload: { productId: product.id },
      });
      expect(addAgainRes.statusCode).toBe(200);

      const listRes = await app.inject({ method: "GET", url: "/api/v1/users/me/wishlist", headers: authHeader(token) });
      expect(listRes.json().data).toHaveLength(1);

      const deleteRes = await app.inject({
        method: "DELETE",
        url: `/api/v1/users/me/wishlist/${product.id}`,
        headers: authHeader(token),
      });
      expect(deleteRes.statusCode).toBe(204);

      const deleteAgainRes = await app.inject({
        method: "DELETE",
        url: `/api/v1/users/me/wishlist/${product.id}`,
        headers: authHeader(token),
      });
      expect(deleteAgainRes.statusCode).toBe(204);
    });

    it("var olmayan/yayında olmayan ürün için POST 404 döner", async () => {
      await setProductsModuleEnabled(true);
      const user = await createUserWithRole();
      const draftProduct = await createProduct({ status: "DRAFT" });

      const missingRes = await app.inject({
        method: "POST",
        url: "/api/v1/users/me/wishlist",
        headers: authHeader(tokenFor(user)),
        payload: { productId: crypto.randomUUID() },
      });
      expect(missingRes.statusCode).toBe(404);

      const draftRes = await app.inject({
        method: "POST",
        url: "/api/v1/users/me/wishlist",
        headers: authHeader(tokenFor(user)),
        payload: { productId: draftProduct.id },
      });
      expect(draftRes.statusCode).toBe(404);
    });

    it("soft-delete edilmiş/taslak ürün favori LİSTESİNDE görünmez, satır DB'de kalır", async () => {
      await setProductsModuleEnabled(true);
      const user = await createUserWithRole();
      const token = tokenFor(user);
      const product = await createProduct();

      const addRes = await app.inject({
        method: "POST",
        url: "/api/v1/users/me/wishlist",
        headers: authHeader(token),
        payload: { productId: product.id },
      });
      expect(addRes.statusCode).toBe(201);

      await app.prisma.product.update({ where: { id: product.id }, data: { deletedAt: new Date() } });

      const listRes = await app.inject({ method: "GET", url: "/api/v1/users/me/wishlist", headers: authHeader(token) });
      expect(listRes.json().data).toHaveLength(0);

      const row = await app.prisma.wishlistItem.findUnique({ where: { userId_productId: { userId: user.id, productId: product.id } } });
      expect(row).not.toBeNull();
    });

    it("100 favori sınırı aşılınca POST 409 döner", async () => {
      await setProductsModuleEnabled(true);
      const user = await createUserWithRole();
      const products = await Promise.all(Array.from({ length: 100 }, () => createProduct()));
      await app.prisma.wishlistItem.createMany({
        data: products.map((p) => ({ userId: user.id, productId: p.id })),
      });

      const extraProduct = await createProduct();
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/users/me/wishlist",
        headers: authHeader(tokenFor(user)),
        payload: { productId: extraProduct.id },
      });
      expect(res.statusCode).toBe(409);
    });

    it("products KAPALI: GET/POST/DELETE /users/me/wishlist* 404 döner", async () => {
      await setProductsModuleEnabled(false);
      const user = await createUserWithRole();
      const token = tokenFor(user);
      const product = await createProduct();

      const getRes = await app.inject({ method: "GET", url: "/api/v1/users/me/wishlist", headers: authHeader(token) });
      expect(getRes.statusCode).toBe(404);

      const postRes = await app.inject({
        method: "POST",
        url: "/api/v1/users/me/wishlist",
        headers: authHeader(token),
        payload: { productId: product.id },
      });
      expect(postRes.statusCode).toBe(404);

      const deleteRes = await app.inject({
        method: "DELETE",
        url: `/api/v1/users/me/wishlist/${product.id}`,
        headers: authHeader(token),
      });
      expect(deleteRes.statusCode).toBe(404);

      await setProductsModuleEnabled(true); // sonraki testleri etkilememesi için geri aç.
    });
  });

  // ---------- Sipariş detayı + modül guard matrisi (§2.1/§3) ----------

  describe("sipariş detayı ve modül guard matrisi", () => {
    it("GET /users/me/orders/{orderId} kendi siparişini döner (trackingNumber/shippingCarrier dahil)", async () => {
      const user = await createUserWithRole();
      const order = await createOrderFor(user.id);
      await app.prisma.order.update({
        where: { id: order.id },
        data: { status: "SHIPPED", trackingNumber: "TRK-123", shippingCarrier: "Yurtiçi Kargo" },
      });

      const res = await app.inject({
        method: "GET",
        url: `/api/v1/users/me/orders/${order.id}`,
        headers: authHeader(tokenFor(user)),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data).toMatchObject({
        id: order.id,
        status: "SHIPPED",
        trackingNumber: "TRK-123",
        shippingCarrier: "Yurtiçi Kargo",
      });
      expect(res.json().data.items).toHaveLength(1);
    });

    it("başkasının orderId'si ile detay 404 döner (403 DEĞİL — varlık sızdırılmaz)", async () => {
      const owner = await createUserWithRole();
      const intruder = await createUserWithRole();
      const order = await createOrderFor(owner.id);

      const res = await app.inject({
        method: "GET",
        url: `/api/v1/users/me/orders/${order.id}`,
        headers: authHeader(tokenFor(intruder)),
      });
      expect(res.statusCode).toBe(404);
    });

    it("var olmayan orderId için 404 döner", async () => {
      const user = await createUserWithRole();
      const res = await app.inject({
        method: "GET",
        url: `/api/v1/users/me/orders/${crypto.randomUUID()}`,
        headers: authHeader(tokenFor(user)),
      });
      expect(res.statusCode).toBe(404);
    });

    it("GET /users/me/orders `seq desc` (en yeni önce) sıralar — kontrat, bkz. openapi.yaml:545", async () => {
      const user = await createUserWithRole();
      const token = tokenFor(user);
      const first = await createOrderFor(user.id);
      const second = await createOrderFor(user.id);
      const third = await createOrderFor(user.id);

      const res = await app.inject({ method: "GET", url: "/api/v1/users/me/orders", headers: authHeader(token) });
      expect(res.statusCode).toBe(200);
      const ids = res.json().data.map((o: { id: string }) => o.id);
      expect(ids).toEqual([third.id, second.id, first.id]);
    });

    it("products KAPALI: GET /users/me/orders ve /orders/{id} 200 döner (§3 — bu test kararın bekçisidir)", async () => {
      await setProductsModuleEnabled(false);
      const user = await createUserWithRole();
      const token = tokenFor(user);
      const order = await createOrderFor(user.id);

      const listRes = await app.inject({ method: "GET", url: "/api/v1/users/me/orders", headers: authHeader(token) });
      expect(listRes.statusCode).toBe(200);

      const detailRes = await app.inject({
        method: "GET",
        url: `/api/v1/users/me/orders/${order.id}`,
        headers: authHeader(token),
      });
      expect(detailRes.statusCode).toBe(200);

      await setProductsModuleEnabled(true);
    });

    it("products KAPALI: GET/PATCH /users/me ve /users/me/addresses HÂLÂ 200 döner", async () => {
      await setProductsModuleEnabled(false);
      const user = await createUserWithRole();
      const token = tokenFor(user);

      const meRes = await app.inject({ method: "GET", url: "/api/v1/users/me", headers: authHeader(token) });
      expect(meRes.statusCode).toBe(200);

      const addressesRes = await app.inject({ method: "GET", url: "/api/v1/users/me/addresses", headers: authHeader(token) });
      expect(addressesRes.statusCode).toBe(200);

      await setProductsModuleEnabled(true);
    });

    it("USER rolüyle tüm uçlar 403 DEĞİL — normal davranış (boş liste/200)", async () => {
      const user = await createUserWithRole("USER");
      const token = tokenFor(user);

      const ordersRes = await app.inject({ method: "GET", url: "/api/v1/users/me/orders", headers: authHeader(token) });
      expect(ordersRes.statusCode).toBe(200);

      const addressesRes = await app.inject({ method: "GET", url: "/api/v1/users/me/addresses", headers: authHeader(token) });
      expect(addressesRes.statusCode).toBe(200);

      const wishlistRes = await app.inject({ method: "GET", url: "/api/v1/users/me/wishlist", headers: authHeader(token) });
      expect(wishlistRes.statusCode).toBe(200);
    });
  });
});
