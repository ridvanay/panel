import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestApp } from "../helpers/build-test-app";
import { resetDatabase } from "../helpers/reset-db";
import { registerTestUser } from "../helpers/auth";

/**
 * `.claude/architect-scope-products-catalog.md` §2.5 (bağlayıcı) — `SiteSettings.
 * shippingEstimatedDaysMin/Max` tahmini teslimat süresi. İKİSİ de `null` iken PDP satırı HİÇ
 * render etmez (frontend-agent sahası); backend yalnızca çapraz-alan doğrulamasından (`Max <
 * Min` → 422) ve public `GET /settings`'in bu alanları döndüğünden sorumludur.
 */
describe("settings — shippingEstimatedDaysMin/Max (§2.5)", () => {
  let app: FastifyInstance;
  let accessToken: string;

  beforeAll(async () => {
    app = await buildTestApp();
    await resetDatabase(app.prisma);
    ({ accessToken } = await registerTestUser(app, { email: "settings-shipping-admin@example.com" }));
  });

  afterAll(async () => {
    await resetDatabase(app.prisma);
    await app.close();
  });

  function authHeader() {
    return { authorization: `Bearer ${accessToken}` };
  }

  it("public GET /settings varsayılan olarak shippingEstimatedDaysMin/Max: null döner (satır kaydı yoksa)", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/settings" });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.shippingEstimatedDaysMin).toBeNull();
    expect(res.json().data.shippingEstimatedDaysMax).toBeNull();
  });

  it("ADMIN her ikisini de ayarlayabilir; public GET /settings güncel değerleri döner", async () => {
    const patch = await app.inject({
      method: "PATCH",
      url: "/api/v1/admin/settings",
      headers: authHeader(),
      payload: { shippingEstimatedDaysMin: 2, shippingEstimatedDaysMax: 4 },
    });
    expect(patch.statusCode).toBe(200);
    expect(patch.json().data.shippingEstimatedDaysMin).toBe(2);
    expect(patch.json().data.shippingEstimatedDaysMax).toBe(4);

    const publicGet = await app.inject({ method: "GET", url: "/api/v1/settings" });
    expect(publicGet.json().data.shippingEstimatedDaysMin).toBe(2);
    expect(publicGet.json().data.shippingEstimatedDaysMax).toBe(4);
  });

  it("Max < Min AYNI istekte gönderilirse 422 döner (şema seviyesi çapraz-alan kuralı)", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/api/v1/admin/settings",
      headers: authHeader(),
      payload: { shippingEstimatedDaysMin: 10, shippingEstimatedDaysMax: 5 },
    });
    expect(res.statusCode).toBe(422);
  });

  it("Min === Max geçerlidir (arayüz tek sayı gösterir)", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/api/v1/admin/settings",
      headers: authHeader(),
      payload: { shippingEstimatedDaysMin: 3, shippingEstimatedDaysMax: 3 },
    });
    expect(res.statusCode).toBe(200);
  });

  it("Max, mevcut kayıttaki Min'e göre TEK BAŞINA gönderildiğinde de çapraz kontrol edilir (route handler)", async () => {
    // Önce Min=5, Max=8 ayarla.
    await app.inject({
      method: "PATCH",
      url: "/api/v1/admin/settings",
      headers: authHeader(),
      payload: { shippingEstimatedDaysMin: 5, shippingEstimatedDaysMax: 8 },
    });

    // Yalnızca Max gönder — mevcut Min (5) ile çapraz kontrol edilmeli, 3 < 5 olduğu için 422.
    const res = await app.inject({
      method: "PATCH",
      url: "/api/v1/admin/settings",
      headers: authHeader(),
      payload: { shippingEstimatedDaysMax: 3 },
    });
    expect(res.statusCode).toBe(422);

    // Mevcut satır DEĞİŞMEMİŞ olmalı.
    const afterFailedPatch = await app.inject({ method: "GET", url: "/api/v1/settings" });
    expect(afterFailedPatch.json().data.shippingEstimatedDaysMax).toBe(8);
  });

  it("yalnızca Min'i null'a çekmek (Max dolu kalırken) geçerlidir — çapraz kural yalnızca İKİSİ de doluyken uygulanır", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/api/v1/admin/settings",
      headers: authHeader(),
      payload: { shippingEstimatedDaysMin: null },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.shippingEstimatedDaysMin).toBeNull();
  });

  it("min/max 0-90 aralığı dışında 422 döner", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/api/v1/admin/settings",
      headers: authHeader(),
      payload: { shippingEstimatedDaysMin: 91 },
    });
    expect(res.statusCode).toBe(422);
  });
});
