import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestApp } from "../helpers/build-test-app";
import { resetDatabase } from "../helpers/reset-db";
import { registerTestUser } from "../helpers/auth";

/**
 * `/admin/logs` ve `/admin/media` GET uçlarındaki route-level rate limit'i (120/dakika,
 * bkz. logs.routes.ts::LOGS_RATE_LIMIT ve media.routes.ts::MEDIA_LIST_RATE_LIMIT) doğrular.
 *
 * Bu limit env.RATE_LIMIT_MAX'tan (test ortamında 1000'e yükseltilmiş global limit)
 * BAĞIMSIZ, kod içinde sabit — bu yüzden test ortamında da gerçek değeriyle (120) çalışır.
 *
 * Kendi izole `buildTestApp()` instance'ında çalışır ki limiti fiilen tüketmesi başka bir
 * test dosyasındaki aynı endpoint kullanımlarını etkilemesin.
 */
describe("rate-limits — route-level (/admin/logs, /admin/media)", () => {
  let app: FastifyInstance;
  let admin: Awaited<ReturnType<typeof registerTestUser>>;

  function authHeader(token: string) {
    return { authorization: `Bearer ${token}` };
  }

  beforeAll(async () => {
    app = await buildTestApp();
    await resetDatabase(app.prisma);
    // Boş bir DB'de ilk kayıt olan kullanıcı otomatik ADMIN olur (bkz. auth.service.ts).
    admin = await registerTestUser(app, { email: "rate-limit-admin@example.com" });
  });

  afterAll(async () => {
    await resetDatabase(app.prisma);
    await app.close();
  });

  it("/admin/logs GET: 120 istek başarılı, 121. istek 429 döner ve RATE_LIMITED detaylarını içerir", async () => {
    for (let i = 0; i < 120; i++) {
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/admin/logs",
        headers: authHeader(admin.accessToken),
      });
      expect(res.statusCode).toBe(200);
    }

    const res121 = await app.inject({
      method: "GET",
      url: "/api/v1/admin/logs",
      headers: authHeader(admin.accessToken),
    });

    expect(res121.statusCode).toBe(429);
    const body = res121.json();
    expect(body.error.code).toBe("RATE_LIMITED");
    expect(body.error.details.retryAfterSeconds).toBeDefined();
  });

  it("/admin/media GET: aynı pattern'i uygular — 121. istek 429 döner", async () => {
    for (let i = 0; i < 120; i++) {
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/admin/media",
        headers: authHeader(admin.accessToken),
      });
      expect(res.statusCode).toBe(200);
    }

    const res121 = await app.inject({
      method: "GET",
      url: "/api/v1/admin/media",
      headers: authHeader(admin.accessToken),
    });

    expect(res121.statusCode).toBe(429);
    const body = res121.json();
    expect(body.error.code).toBe("RATE_LIMITED");
    expect(body.error.details.retryAfterSeconds).toBeDefined();
  });
});

/**
 * `/users/me/change-password` route-level rate limit'i (5/dakika, bkz.
 * lib/rate-limit.ts::SENSITIVE_ACTION_RATE_LIMIT) doğrular. Kendi izole `buildTestApp()`
 * instance'ında ve kendi kullanıcısında çalışır ki `users.test.ts`'teki senaryoların
 * (o dosyada zaten 5 isteklik bütçe kimliksiz/yanlış-şifre/doğrulama/başarı senaryolarıyla
 * tam dolduruluyor) bütçesini etkilemesin veya ondan etkilenmesin.
 */
describe("rate-limits — route-level (/users/me/change-password)", () => {
  let app: FastifyInstance;
  let user: Awaited<ReturnType<typeof registerTestUser>>;

  function authHeader(token: string) {
    return { authorization: `Bearer ${token}` };
  }

  beforeAll(async () => {
    app = await buildTestApp();
    await resetDatabase(app.prisma);
    user = await registerTestUser(app, { email: "rate-limit-change-password@example.com" });
  });

  afterAll(async () => {
    await resetDatabase(app.prisma);
    await app.close();
  });

  it("5 istek başarısız (yanlış şifre) sonrası 6. istek 429 döner ve RATE_LIMITED detaylarını içerir", async () => {
    for (let i = 0; i < 5; i++) {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/users/me/change-password",
        headers: authHeader(user.accessToken),
        payload: { currentPassword: "yanlis-sifre", newPassword: "YeniSifre123!" },
      });
      expect(res.statusCode).toBe(401);
    }

    const res6 = await app.inject({
      method: "POST",
      url: "/api/v1/users/me/change-password",
      headers: authHeader(user.accessToken),
      payload: { currentPassword: "yanlis-sifre", newPassword: "YeniSifre123!" },
    });

    expect(res6.statusCode).toBe(429);
    const body = res6.json();
    expect(body.error.code).toBe("RATE_LIMITED");
    expect(body.error.details.retryAfterSeconds).toBeDefined();
  });
});

/**
 * `POST /admin/reports/exports` route-level rate limit'i (10/10dk, bkz.
 * reports.routes.ts::EXPORT_CREATE_RATE_LIMIT) doğrular — `import.routes.ts::IMPORT_UPLOAD_RATE_LIMIT`
 * İLE AYNI GEREKÇE (pahalı DB aggregation + dosya üretimi tetikleyen bir uç, global
 * `env.RATE_LIMIT_MAX`'tan bağımsız, kod içinde sabit bir tavan). Kendi izole `buildTestApp()`
 * instance'ında çalışır.
 */
describe("rate-limits — route-level (POST /admin/reports/exports)", () => {
  let app: FastifyInstance;
  let admin: Awaited<ReturnType<typeof registerTestUser>>;

  function authHeader(token: string) {
    return { authorization: `Bearer ${token}` };
  }

  beforeAll(async () => {
    app = await buildTestApp();
    await resetDatabase(app.prisma);
    admin = await registerTestUser(app, { email: "rate-limit-export-admin@example.com" });
  });

  afterAll(async () => {
    await resetDatabase(app.prisma);
    await app.close();
  });

  it("10 istek başarılı (202), 11. istek 429 döner ve RATE_LIMITED detaylarını içerir", async () => {
    for (let i = 0; i < 10; i++) {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/admin/reports/exports",
        headers: authHeader(admin.accessToken),
        payload: { type: "VIEWS", format: "CSV", from: "2026-01-01", to: "2026-01-02" },
      });
      expect(res.statusCode).toBe(202);
    }

    const res11 = await app.inject({
      method: "POST",
      url: "/api/v1/admin/reports/exports",
      headers: authHeader(admin.accessToken),
      payload: { type: "VIEWS", format: "CSV", from: "2026-01-01", to: "2026-01-02" },
    });

    expect(res11.statusCode).toBe(429);
    const body = res11.json();
    expect(body.error.code).toBe("RATE_LIMITED");
    expect(body.error.details.retryAfterSeconds).toBeDefined();
  });
});
