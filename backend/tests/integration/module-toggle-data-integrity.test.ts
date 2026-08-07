import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestApp } from "../helpers/build-test-app";
import { resetDatabase } from "../helpers/reset-db";
import { registerTestUser } from "../helpers/auth";

/**
 * §10.9 Eklenti/Modül Yönetimi — `site-modules.test.ts`'in AKSİNE burada `MODULE_REGISTRY`
 * MOCK'LANMAZ: GERÇEK `products`/`portfolio` kayıtlarına karşı, gerçek `PATCH /admin/modules/:key`
 * toggle ucu üzerinden UÇTAN UCA doğrulanır — `products.test.ts`/`portfolio.test.ts`'teki
 * "modül kapalıyken" senaryoları `lib/module-state.ts::isModuleEnabled`'ı `vi.doMock` ile DOĞRUDAN
 * sahteler (DB toggle akışını atlar); bu dosya o boşluğu kapatır: admin panelden gerçekten
 * kapatılan bir modülün ARDINDAN veri kaybı YAŞANMADIĞINI ve tekrar açılınca public erişimin
 * SORUNSUZ geri geldiğini kanıtlar.
 */
describe("modül toggle → veri korunumu (gerçek registry, mock YOK)", () => {
  let app: FastifyInstance;
  let adminToken: string;

  function authHeader(token: string) {
    return { authorization: `Bearer ${token}` };
  }

  beforeAll(async () => {
    app = await buildTestApp();
    await resetDatabase(app.prisma);

    const admin = await registerTestUser(app, { email: "module-toggle-admin@example.com" });
    adminToken = admin.accessToken;
  });

  afterAll(async () => {
    await resetDatabase(app.prisma);
    await app.close();
  });

  it("products modülü kapatılınca: public 404, admin veriye erişmeye devam eder, DB satırı SİLİNMEZ; tekrar açılınca public geri döner", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/api/v1/admin/products",
      headers: authHeader(adminToken),
      payload: { title: "Gerçek Toggle Ürünü", priceCents: 5000, status: "PUBLISHED" },
    });
    expect(create.statusCode).toBe(201);
    const product = create.json().data;

    // Kapatmadan önce public görünür olduğunu doğrula (kontrol grubu).
    const beforeDisable = await app.inject({ method: "GET", url: `/api/v1/products/${product.slug}` });
    expect(beforeDisable.statusCode).toBe(200);

    const disable = await app.inject({
      method: "PATCH",
      url: "/api/v1/admin/modules/products",
      headers: authHeader(adminToken),
      payload: { enabled: false },
    });
    expect(disable.statusCode).toBe(200);
    expect(disable.json().data.enabled).toBe(false);

    const publicList = await app.inject({ method: "GET", url: "/api/v1/products" });
    expect(publicList.statusCode).toBe(404);
    const publicDetail = await app.inject({ method: "GET", url: `/api/v1/products/${product.slug}` });
    expect(publicDetail.statusCode).toBe(404);

    // Admin uçları ETKİLENMEZ — veri hâlâ tam erişilebilir.
    const adminGet = await app.inject({
      method: "GET",
      url: `/api/v1/admin/products/${product.id}`,
      headers: authHeader(adminToken),
    });
    expect(adminGet.statusCode).toBe(200);
    expect(adminGet.json().data.title).toBe("Gerçek Toggle Ürünü");

    // DB satırı fiilen hâlâ mevcut, deletedAt set edilmemiş.
    const row = await app.prisma.product.findUniqueOrThrow({ where: { id: product.id } });
    expect(row.deletedAt).toBeNull();
    expect(row.title).toBe("Gerçek Toggle Ürünü");

    const enable = await app.inject({
      method: "PATCH",
      url: "/api/v1/admin/modules/products",
      headers: authHeader(adminToken),
      payload: { enabled: true },
    });
    expect(enable.statusCode).toBe(200);

    const publicAfterReEnable = await app.inject({ method: "GET", url: `/api/v1/products/${product.slug}` });
    expect(publicAfterReEnable.statusCode).toBe(200);
    expect(publicAfterReEnable.json().data.id).toBe(product.id);
  });

  it("portfolio modülü kapatılınca: public 404, admin veriye erişmeye devam eder, DB satırı SİLİNMEZ; tekrar açılınca public geri döner", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/api/v1/admin/portfolio",
      headers: authHeader(adminToken),
      payload: { title: "Gerçek Toggle Projesi", status: "PUBLISHED" },
    });
    expect(create.statusCode).toBe(201);
    const item = create.json().data;

    const disable = await app.inject({
      method: "PATCH",
      url: "/api/v1/admin/modules/portfolio",
      headers: authHeader(adminToken),
      payload: { enabled: false },
    });
    expect(disable.statusCode).toBe(200);

    const publicList = await app.inject({ method: "GET", url: "/api/v1/portfolio" });
    expect(publicList.statusCode).toBe(404);
    const publicDetail = await app.inject({ method: "GET", url: `/api/v1/portfolio/${item.slug}` });
    expect(publicDetail.statusCode).toBe(404);

    const adminGet = await app.inject({
      method: "GET",
      url: `/api/v1/admin/portfolio/${item.id}`,
      headers: authHeader(adminToken),
    });
    expect(adminGet.statusCode).toBe(200);

    const row = await app.prisma.portfolioItem.findUniqueOrThrow({ where: { id: item.id } });
    expect(row.deletedAt).toBeNull();

    const enable = await app.inject({
      method: "PATCH",
      url: "/api/v1/admin/modules/portfolio",
      headers: authHeader(adminToken),
      payload: { enabled: true },
    });
    expect(enable.statusCode).toBe(200);

    const publicAfterReEnable = await app.inject({ method: "GET", url: `/api/v1/portfolio/${item.slug}` });
    expect(publicAfterReEnable.statusCode).toBe(200);
  });

  it("products modülü kapalıyken cart/checkout uçları da 404 döner (aynı guard'ı paylaşırlar)", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/api/v1/admin/products",
      headers: authHeader(adminToken),
      payload: { title: "Sepet Guard Ürünü", priceCents: 5000, status: "PUBLISHED" },
    });
    const product = create.json().data;

    await app.inject({
      method: "PATCH",
      url: "/api/v1/admin/modules/products",
      headers: authHeader(adminToken),
      payload: { enabled: false },
    });

    const cartRes = await app.inject({
      method: "POST",
      url: "/api/v1/cart/items",
      payload: { productId: product.id, quantity: 1 },
    });
    expect(cartRes.statusCode).toBe(404);

    const checkoutRes = await app.inject({
      method: "POST",
      url: "/api/v1/checkout/session",
      payload: { customerEmail: "guard@example.com" },
    });
    expect(checkoutRes.statusCode).toBe(404);

    // Sonraki testlerin etkilenmemesi için modülü tekrar aç.
    await app.inject({
      method: "PATCH",
      url: "/api/v1/admin/modules/products",
      headers: authHeader(adminToken),
      payload: { enabled: true },
    });
  });
});
