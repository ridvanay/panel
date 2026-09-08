import crypto from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestApp } from "../helpers/build-test-app";
import { resetDatabase } from "../helpers/reset-db";
import { registerTestUser } from "../helpers/auth";

/**
 * Merkezi KDV/Vergi Sınıfları — `/admin/tax-rates` CRUD (bkz. tax.routes.ts) + `lib/tax.ts::
 * computeTaxBreakdown` sepet entegrasyonu. `tests/integration/cart.test.ts`/`cart-retention.test.ts`
 * İLE AYNI `app.inject()` + cookie taşıma deseni (bkz. o dosyalardaki `cookieHeader` yardımcı notu).
 */
describe("tax rates (merkezi KDV/Vergi Sınıfları)", () => {
  let app: FastifyInstance;
  let adminToken: string;
  let managerToken: string;

  function authHeader(token: string) {
    return { authorization: `Bearer ${token}` };
  }

  function cookieHeader(res: { cookies: { name: string; value: string }[] }): string {
    return res.cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  }

  async function createTaxRate(token: string, overrides: Partial<{ name: string; ratePercent: number; isDefault: boolean }> = {}) {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/admin/tax-rates",
      headers: authHeader(token),
      payload: {
        name: overrides.name ?? `Oran ${crypto.randomUUID()}`,
        ratePercent: overrides.ratePercent ?? 20,
        isDefault: overrides.isDefault ?? false,
      },
    });
    expect(res.statusCode).toBe(201);
    return res.json().data as { id: string; name: string; ratePercent: number; isDefault: boolean };
  }

  async function createProduct(token: string, overrides: Partial<{ priceCents: number; taxRateId: string | null; stockQuantity: number }> = {}) {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/admin/products",
      headers: authHeader(token),
      payload: {
        title: `Test Ürün ${crypto.randomUUID()}`,
        priceCents: overrides.priceCents ?? 10000,
        status: "PUBLISHED",
        stockQuantity: overrides.stockQuantity ?? 10,
        ...(overrides.taxRateId !== undefined ? { taxRateId: overrides.taxRateId } : {}),
      },
    });
    expect(res.statusCode).toBe(201);
    return res.json().data as { id: string; slug: string; taxRateId: string | null };
  }

  async function setPricesIncludeTax(token: string, pricesIncludeTax: boolean) {
    const res = await app.inject({
      method: "PATCH",
      url: "/api/v1/admin/settings",
      headers: authHeader(token),
      payload: { pricesIncludeTax },
    });
    expect(res.statusCode).toBe(200);
  }

  beforeAll(async () => {
    app = await buildTestApp();
    await resetDatabase(app.prisma);

    // İlk kayıt boş bir DB'de otomatik ADMIN olur (bkz. auth.service.ts::register).
    const admin = await registerTestUser(app, { email: "tax-admin@example.com" });
    adminToken = admin.accessToken;

    const manager = await registerTestUser(app, { email: "tax-manager@example.com" });
    await app.prisma.user.update({ where: { id: manager.userId }, data: { role: "MANAGER" } });
    managerToken = manager.accessToken;
  });

  afterAll(async () => {
    await resetDatabase(app.prisma);
    await app.close();
  });

  describe("RBAC — GET ADMIN+MANAGER, POST/PATCH/DELETE yalnızca ADMIN", () => {
    it("kimliği doğrulanmamış istekler 401 alır", async () => {
      const res = await app.inject({ method: "GET", url: "/api/v1/admin/tax-rates" });
      expect(res.statusCode).toBe(401);
    });

    it("MANAGER GET yapabilir ama POST/PATCH/DELETE'te 403 alır", async () => {
      const list = await app.inject({ method: "GET", url: "/api/v1/admin/tax-rates", headers: authHeader(managerToken) });
      expect(list.statusCode).toBe(200);

      const create = await app.inject({
        method: "POST",
        url: "/api/v1/admin/tax-rates",
        headers: authHeader(managerToken),
        payload: { name: `Manager Denemesi ${crypto.randomUUID()}`, ratePercent: 18 },
      });
      expect(create.statusCode).toBe(403);

      const rate = await createTaxRate(adminToken);

      const patch = await app.inject({
        method: "PATCH",
        url: `/api/v1/admin/tax-rates/${rate.id}`,
        headers: authHeader(managerToken),
        payload: { ratePercent: 5 },
      });
      expect(patch.statusCode).toBe(403);

      const del = await app.inject({
        method: "DELETE",
        url: `/api/v1/admin/tax-rates/${rate.id}`,
        headers: authHeader(managerToken),
      });
      expect(del.statusCode).toBe(403);
    });

    it("ADMIN oluşturabilir, güncelleyebilir ve silebilir (200/201/204)", async () => {
      const rate = await createTaxRate(adminToken, { name: `ADMIN CRUD ${crypto.randomUUID()}`, ratePercent: 8 });

      const patch = await app.inject({
        method: "PATCH",
        url: `/api/v1/admin/tax-rates/${rate.id}`,
        headers: authHeader(adminToken),
        payload: { ratePercent: 9 },
      });
      expect(patch.statusCode).toBe(200);
      expect(Number(patch.json().data.ratePercent)).toBe(9);

      const del = await app.inject({
        method: "DELETE",
        url: `/api/v1/admin/tax-rates/${rate.id}`,
        headers: authHeader(adminToken),
      });
      expect(del.statusCode).toBe(204);
    });
  });

  describe("DELETE koruma kuralları", () => {
    it("varsayılan sınıf silinemez — 409 TAX_RATE_IS_DEFAULT", async () => {
      const rate = await createTaxRate(adminToken, { name: `Varsayılan ${crypto.randomUUID()}`, isDefault: true });

      const del = await app.inject({
        method: "DELETE",
        url: `/api/v1/admin/tax-rates/${rate.id}`,
        headers: authHeader(adminToken),
      });
      expect(del.statusCode).toBe(409);
      expect(del.json().error.details.reason).toEqual(["TAX_RATE_IS_DEFAULT"]);
    });

    it("kullanımda olan sınıf reassignToId olmadan silinemez — 409 TAX_RATE_IN_USE; reassignToId ile başarılı silinir ve ürün yeni sınıfa taşınır", async () => {
      const rateA = await createTaxRate(adminToken, { name: `Kullanımda A ${crypto.randomUUID()}`, ratePercent: 20 });
      const rateB = await createTaxRate(adminToken, { name: `Hedef B ${crypto.randomUUID()}`, ratePercent: 10 });
      const product = await createProduct(adminToken, { taxRateId: rateA.id });

      const deleteWithoutReassign = await app.inject({
        method: "DELETE",
        url: `/api/v1/admin/tax-rates/${rateA.id}`,
        headers: authHeader(adminToken),
      });
      expect(deleteWithoutReassign.statusCode).toBe(409);
      expect(deleteWithoutReassign.json().error.details.reason).toEqual(["TAX_RATE_IN_USE"]);

      const deleteWithReassign = await app.inject({
        method: "DELETE",
        url: `/api/v1/admin/tax-rates/${rateA.id}?reassignToId=${rateB.id}`,
        headers: authHeader(adminToken),
      });
      expect(deleteWithReassign.statusCode).toBe(204);

      const updatedProduct = await app.prisma.product.findUnique({ where: { id: product.id } });
      expect(updatedProduct?.taxRateId).toBe(rateB.id);
    });
  });

  describe("eski taxRatePercent alanı — .strict() ile 422", () => {
    it("POST /admin/products'a taxRatePercent göndermek 422 döner", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/admin/products",
        headers: authHeader(adminToken),
        payload: { title: `Eski Alan ${crypto.randomUUID()}`, priceCents: 1000, taxRatePercent: 18 },
      });
      expect(res.statusCode).toBe(422);
    });

    it("PATCH /admin/products/:id'e taxRatePercent göndermek 422 döner", async () => {
      const product = await createProduct(adminToken);
      const res = await app.inject({
        method: "PATCH",
        url: `/api/v1/admin/products/${product.id}`,
        headers: authHeader(adminToken),
        payload: { taxRatePercent: 18 },
      });
      expect(res.statusCode).toBe(422);
    });
  });

  describe("sepet KDV dökümü — computeTaxBreakdown ile tutarlılık", () => {
    it("pricesIncludeTax: true iken KDV fiyattan GERİ ÇIKARILIR (dahil fiyat)", async () => {
      await setPricesIncludeTax(adminToken, true);
      const rate = await createTaxRate(adminToken, { name: `Sepet Dahil ${crypto.randomUUID()}`, ratePercent: 20 });
      const product = await createProduct(adminToken, { priceCents: 12000, taxRateId: rate.id });

      const add = await app.inject({
        method: "POST",
        url: "/api/v1/cart/items",
        payload: { productId: product.id, quantity: 1 },
      });
      expect(add.statusCode).toBe(201);

      const body = add.json().data;
      // Gross=12000, r=20 -> tax = round(12000*20/120) = 2000, net = 10000.
      expect(body.tax.includedInPrice).toBe(true);
      expect(body.tax.totalTaxCents).toBe(2000);
      expect(body.tax.breakdown).toEqual([{ ratePercent: 20, baseCents: 10000, taxCents: 2000 }]);
      expect(body.totalCents ?? body.subtotalCents).toBe(12000);
    });

    it("pricesIncludeTax: false iken KDV fiyatın ÜZERİNE EKLENİR (hariç fiyat)", async () => {
      await setPricesIncludeTax(adminToken, false);
      const rate = await createTaxRate(adminToken, { name: `Sepet Hariç ${crypto.randomUUID()}`, ratePercent: 10 });
      const product = await createProduct(adminToken, { priceCents: 10000, taxRateId: rate.id });

      const add = await app.inject({
        method: "POST",
        url: "/api/v1/cart/items",
        payload: { productId: product.id, quantity: 2 },
      });
      expect(add.statusCode).toBe(201);
      const cookie = cookieHeader(add);

      const get = await app.inject({ method: "GET", url: "/api/v1/cart", headers: { cookie } });
      const body = get.json().data;
      // Net = 10000*2 = 20000, r=10 -> tax = round(20000*10/100) = 2000.
      expect(body.tax.includedInPrice).toBe(false);
      expect(body.tax.totalTaxCents).toBe(2000);
      expect(body.tax.breakdown).toEqual([{ ratePercent: 10, baseCents: 20000, taxCents: 2000 }]);
      expect(body.subtotalCents).toBe(20000);

      // Sıfırlama — sonraki testleri etkilememesi için varsayılana geri döndür.
      await setPricesIncludeTax(adminToken, true);
    });
  });
});
