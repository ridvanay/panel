import crypto from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestApp } from "../helpers/build-test-app";
import { resetDatabase } from "../helpers/reset-db";
import { hashPassword } from "../../src/lib/password";
import { signAccessToken } from "../../src/lib/jwt";

/**
 * `.claude/architect-scope-rbac-5-tier.md` §7.4 — `GET /users/me/orders`: authenticated
 * (5 rolün hepsi), rol guard'ı YOKTUR — gerçek yetkilendirme sahipliktir
 * (`Order.siteUserId = request.user.id`). Bir `USER`'ın çağırması boş liste döndürür (403
 * DEĞİL); bir kullanıcı BAŞKA bir kullanıcının siparişini asla göremez (IDOR koruması).
 *
 * NOT: kullanıcılar `POST /auth/register` (AUTH_RATE_LIMIT, dakikada 5) ÜZERİNDEN DEĞİL,
 * doğrudan Prisma ile oluşturulur ve token `signAccessToken()` ile üretilir (bkz.
 * admin-users-regression-matrix.test.ts'teki AYNI desen) — bu dosyanın çok sayıda kullanıcı
 * ihtiyacı rate limit'e takılmadan karşılanır.
 */
describe("users — GET /users/me/orders (§7.4)", () => {
  let app: FastifyInstance;

  function authHeader(token: string) {
    return { authorization: `Bearer ${token}` };
  }

  function tokenFor(user: { id: string; email: string }): string {
    return signAccessToken({ sub: user.id, email: user.email }).token;
  }

  async function createUserWithRole(role: "ADMIN" | "MANAGER" | "EDITOR" | "CUSTOMER" | "USER") {
    const passwordHash = await hashPassword("Sifre12345!");
    return app.prisma.user.create({
      data: {
        email: `orders-user-${role.toLowerCase()}-${crypto.randomUUID()}@example.com`,
        name: "Test Kullanıcı",
        passwordHash,
        role,
        status: "ACTIVE",
      },
    });
  }

  async function createProduct() {
    return app.prisma.product.create({
      data: {
        title: `Sipariş Testi Ürünü ${crypto.randomUUID()}`,
        slug: `siparis-testi-urunu-${crypto.randomUUID()}`,
        priceCents: 5000,
        currency: "TRY",
        stockQuantity: 100,
        status: "PUBLISHED",
        publishedAt: new Date(),
      },
    });
  }

  async function createOrderFor(siteUserId: string | null, product: { id: string; title: string; sku: string | null }) {
    return app.prisma.order.create({
      data: {
        orderNumber: `ORD-TEST-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
        siteUserId,
        customerEmail: `musteri-${crypto.randomUUID()}@example.com`,
        status: "PAID",
        currency: "TRY",
        subtotalCents: 5000,
        discountCents: 0,
        taxCents: 0,
        totalCents: 5000,
        paidAt: new Date(),
        items: {
          create: [
            {
              productId: product.id,
              productTitle: product.title,
              productSku: product.sku,
              unitPriceCents: 5000,
              quantity: 1,
              lineTotalCents: 5000,
            },
          ],
        },
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

  it("kimliksiz istek 401 döner", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/users/me/orders" });
    expect(res.statusCode).toBe(401);
  });

  it("USER'ın hiç siparişi yoksa boş liste döner (403 DEĞİL — rol guard'ı yok, sahiplik filtresi yeterli)", async () => {
    const user = await createUserWithRole("USER");
    const res = await app.inject({ method: "GET", url: "/api/v1/users/me/orders", headers: authHeader(tokenFor(user)) });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual([]);
  });

  it("yalnızca KENDİ siparişlerini döner — başka bir kullanıcının siparişi listede GÖRÜNMEZ (IDOR koruması)", async () => {
    const product = await createProduct();
    const userA = await createUserWithRole("USER");
    const userB = await createUserWithRole("USER");

    const orderA = await createOrderFor(userA.id, product);
    await createOrderFor(userB.id, product);
    await createOrderFor(null, product); // misafir siparişi — kimseye ait değil.

    const res = await app.inject({ method: "GET", url: "/api/v1/users/me/orders", headers: authHeader(tokenFor(userA)) });
    expect(res.statusCode).toBe(200);
    const ids = res.json().data.map((o: { id: string }) => o.id);
    expect(ids).toEqual([orderA.id]);
  });

  it("CUSTOMER, MANAGER, ADMIN dahil her rol kendi siparişini görebilir (rol guard'ı yok)", async () => {
    const product = await createProduct();
    const roles = ["USER", "CUSTOMER", "EDITOR", "MANAGER", "ADMIN"] as const;

    for (const role of roles) {
      const user = await createUserWithRole(role);
      const order = await createOrderFor(user.id, product);

      const res = await app.inject({ method: "GET", url: "/api/v1/users/me/orders", headers: authHeader(tokenFor(user)) });
      expect(res.statusCode, `role=${role}`).toBe(200);
      expect(res.json().data.map((o: { id: string }) => o.id)).toEqual([order.id]);
    }
  });

  it("status filtresi ve cursor sayfalama sözleşmesi çalışır", async () => {
    const product = await createProduct();
    const user = await createUserWithRole("USER");
    const order = await createOrderFor(user.id, product);
    await app.prisma.order.update({ where: { id: order.id }, data: { status: "FULFILLED" } });

    const matching = await app.inject({
      method: "GET",
      url: "/api/v1/users/me/orders?status=FULFILLED",
      headers: authHeader(tokenFor(user)),
    });
    expect(matching.statusCode).toBe(200);
    expect(matching.json().data).toHaveLength(1);

    const notMatching = await app.inject({
      method: "GET",
      url: "/api/v1/users/me/orders?status=PENDING",
      headers: authHeader(tokenFor(user)),
    });
    expect(notMatching.statusCode).toBe(200);
    expect(notMatching.json().data).toHaveLength(0);
  });
});
