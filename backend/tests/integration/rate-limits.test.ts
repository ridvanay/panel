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

/**
 * `POST /admin/users` route-level rate limit'i (20/dakika, bkz.
 * admin-users.routes.ts::ADMIN_USERS_RATE_LIMIT) doğrular — `POST /admin/reports/exports`
 * İLE AYNI GEREKÇE, `env.RATE_LIMIT_MAX`'tan bağımsız, hassas kullanıcı yönetimi uçlarına
 * (create/rol/durum değişikliği) özel bir tavan (bkz. d804d51, security-agent denetimi).
 * `PATCH /:userId/role` ve `PATCH /:userId/status` AYNI `ADMIN_USERS_RATE_LIMIT` sabitini
 * paylaşır — mekanizmanın kendisini (route-level rate-limit config'in doğru bağlandığını)
 * kanıtlamak için üç uçtan birini (POST) doğrulamak yeterlidir, her uç kendi bağımsız
 * bütçesine sahiptir (Fastify rate-limit route-scoped çalışır). Kendi izole
 * `buildTestApp()` instance'ında çalışır.
 */
describe("rate-limits — route-level (POST /admin/users)", () => {
  let app: FastifyInstance;
  let admin: Awaited<ReturnType<typeof registerTestUser>>;

  function authHeader(token: string) {
    return { authorization: `Bearer ${token}` };
  }

  beforeAll(async () => {
    app = await buildTestApp();
    await resetDatabase(app.prisma);
    // Boş bir DB'de ilk kayıt olan kullanıcı otomatik ADMIN olur (bkz. auth.service.ts).
    admin = await registerTestUser(app, { email: "rate-limit-admin-users@example.com" });
  });

  afterAll(async () => {
    await resetDatabase(app.prisma);
    await app.close();
  });

  it("20 istek başarılı (201), 21. istek 429 döner ve RATE_LIMITED detaylarını içerir", async () => {
    for (let i = 0; i < 20; i++) {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/admin/users",
        headers: authHeader(admin.accessToken),
        payload: { name: `Rate Limit User ${i}`, email: `rate-limit-user-${i}@example.com` },
      });
      expect(res.statusCode).toBe(201);
    }

    const res21 = await app.inject({
      method: "POST",
      url: "/api/v1/admin/users",
      headers: authHeader(admin.accessToken),
      payload: { name: "Rate Limit User 21", email: "rate-limit-user-21@example.com" },
    });

    expect(res21.statusCode).toBe(429);
    const body = res21.json();
    expect(body.error.code).toBe("RATE_LIMITED");
    expect(body.error.details.retryAfterSeconds).toBeDefined();
  });
});

/**
 * `PUT /admin/appearance/custom-code/{css,js}` route-level rate limit'i (10/dakika, bkz.
 * appearance.routes.ts::CUSTOM_CODE_RATE_LIMIT, openapi.yaml açıklaması "Hız sınırı: 10 istek /
 * 1 dakika") doğrular — qa-agent boşluğu (security-agent'ın bıraktığı 403/422 testleri
 * appearance.test.ts'te zaten var, ama hız sınırının GERÇEKTEN 429 döndürdüğünü doğrulayan bir
 * test yoktu). `env.RATE_LIMIT_MAX`'tan bağımsız, kod içinde sabit bir tavan — diğer route-level
 * limit testleriyle AYNI desen. Kendi izole `buildTestApp()` instance'ında çalışır.
 */
describe("rate-limits — route-level (PUT /admin/appearance/custom-code/css)", () => {
  let app: FastifyInstance;
  let admin: Awaited<ReturnType<typeof registerTestUser>>;

  function authHeader(token: string) {
    return { authorization: `Bearer ${token}` };
  }

  beforeAll(async () => {
    app = await buildTestApp();
    await resetDatabase(app.prisma);
    admin = await registerTestUser(app, { email: "rate-limit-custom-css-admin@example.com" });
  });

  afterAll(async () => {
    await resetDatabase(app.prisma);
    await app.close();
  });

  it("10 istek başarılı (200), 11. istek 429 döner ve RATE_LIMITED detaylarını içerir", async () => {
    for (let i = 0; i < 10; i++) {
      const res = await app.inject({
        method: "PUT",
        url: "/api/v1/admin/appearance/custom-code/css",
        headers: authHeader(admin.accessToken),
        payload: { css: `body { color: red; } /* ${i} */`, acknowledged: true },
      });
      expect(res.statusCode).toBe(200);
    }

    const res11 = await app.inject({
      method: "PUT",
      url: "/api/v1/admin/appearance/custom-code/css",
      headers: authHeader(admin.accessToken),
      payload: { css: "body { color: blue; }", acknowledged: true },
    });

    expect(res11.statusCode).toBe(429);
    const body = res11.json();
    expect(body.error.code).toBe("RATE_LIMITED");
    expect(body.error.details.retryAfterSeconds).toBeDefined();
  });
});
