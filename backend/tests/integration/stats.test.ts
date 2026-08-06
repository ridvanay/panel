import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestApp } from "../helpers/build-test-app";
import { resetDatabase } from "../helpers/reset-db";
import { registerTestUser } from "../helpers/auth";

describe("stats", () => {
  let app: FastifyInstance;
  let accessToken: string;

  beforeAll(async () => {
    app = await buildTestApp();
    await resetDatabase(app.prisma);
    // İlk kayıt olan kullanıcı otomatik ADMIN olur (bkz. auth.service.ts).
    ({ accessToken } = await registerTestUser(app));
  });

  afterAll(async () => {
    await resetDatabase(app.prisma);
    await app.close();
  });

  function authHeader(token: string = accessToken) {
    return { authorization: `Bearer ${token}` };
  }

  it("rejects /admin/stats/views without authentication (401)", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/admin/stats/views" });
    expect(res.statusCode).toBe(401);
  });

  describe("RBAC guard (requireSiteRole) — route-bazlı (d616d9f)", () => {
    // İçerik analitiği: EDITOR + ADMIN. Kullanıcı/gelir verisi: yalnızca ADMIN.
    const CONTENT_ANALYTICS_ROUTES = ["/views", "/live-visitors", "/breakdown", "/top-content"];
    const RESTRICTED_ANALYTICS_ROUTES = ["/summary", "/users", "/revenue"];

    it("ADMIN olmayan, EDITOR de olmayan (VIEWER) bir kullanıcı içerik analitiği uçlarına da erişemez (403)", async () => {
      // İlk kayıt (admin1) zaten ADMIN oldu; ikinci register: userCount artık 0 değil
      // -> şema varsayılanı VIEWER (bkz. schema.prisma::User.role).
      const viewer = await registerTestUser(app, { email: "stats-viewer1@example.com" });
      const headers = authHeader(viewer.accessToken);

      for (const route of [...CONTENT_ANALYTICS_ROUTES, ...RESTRICTED_ANALYTICS_ROUTES]) {
        const res = await app.inject({ method: "GET", url: `/api/v1/admin/stats${route}`, headers });
        expect(res.statusCode, `VIEWER -> ${route}`).toBe(403);
        expect(res.json().error.code).toBe("FORBIDDEN");
      }
    });

    it("EDITOR içerik analitiği uçlarına (views/live-visitors/breakdown/top-content) erişebilir (200)", async () => {
      const editor = await registerTestUser(app, { email: "stats-editor1@example.com" });
      await app.prisma.user.update({ where: { id: editor.userId }, data: { role: "EDITOR" } });
      const headers = authHeader(editor.accessToken);

      for (const route of CONTENT_ANALYTICS_ROUTES) {
        const res = await app.inject({ method: "GET", url: `/api/v1/admin/stats${route}`, headers });
        expect(res.statusCode, `EDITOR -> ${route}`).toBe(200);
      }
    });

    it("EDITOR kısıtlı (ADMIN-only) analitik uçlarına (summary/users/revenue) ERİŞEMEZ (403)", async () => {
      const editor = await registerTestUser(app, { email: "stats-editor2@example.com" });
      await app.prisma.user.update({ where: { id: editor.userId }, data: { role: "EDITOR" } });
      const headers = authHeader(editor.accessToken);

      for (const route of RESTRICTED_ANALYTICS_ROUTES) {
        const res = await app.inject({ method: "GET", url: `/api/v1/admin/stats${route}`, headers });
        expect(res.statusCode, `EDITOR -> ${route}`).toBe(403);
        expect(res.json().error.code).toBe("FORBIDDEN");
      }
    });

    it("ADMIN tüm analitik uçlarına erişebilir (200), kısıtlı uçlar dahil", async () => {
      const headers = authHeader();
      for (const route of [...CONTENT_ANALYTICS_ROUTES, ...RESTRICTED_ANALYTICS_ROUTES]) {
        const res = await app.inject({ method: "GET", url: `/api/v1/admin/stats${route}`, headers });
        expect(res.statusCode, `ADMIN -> ${route}`).toBe(200);
      }
    });
  });

  it("records deviceType/country breakdown on public page views", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/api/v1/admin/pages",
      headers: authHeader(),
      payload: { title: "İstatistik Testi", status: "PUBLISHED" },
    });
    const page = create.json().data;

    await app.inject({
      method: "POST",
      url: `/api/v1/pages/${page.slug}/view`,
      headers: {
        "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148",
        "x-forwarded-for": "8.8.8.8",
      },
    });
    await app.inject({
      method: "POST",
      url: `/api/v1/pages/${page.slug}/view`,
      headers: {
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
      },
    });

    const breakdown = await app.inject({
      method: "GET",
      url: "/api/v1/admin/stats/breakdown?days=30",
      headers: authHeader(),
    });
    expect(breakdown.statusCode).toBe(200);
    const { devices, countries } = breakdown.json().data;

    const totalDeviceCount = devices.reduce((sum: number, d: { count: number }) => sum + d.count, 0);
    expect(totalDeviceCount).toBeGreaterThanOrEqual(2);

    const totalCountryCount = countries.reduce((sum: number, c: { count: number }) => sum + c.count, 0);
    expect(totalCountryCount).toBeGreaterThanOrEqual(2);

    const after = await app.inject({
      method: "GET",
      url: `/api/v1/admin/pages/${page.id}`,
      headers: authHeader(),
    });
    expect(after.json().data.viewCount).toBe(2);
  });

  it("live-visitors count reflects recent view calls", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/api/v1/admin/pages",
      headers: authHeader(),
      payload: { title: "Canlı Ziyaretçi Testi", status: "PUBLISHED" },
    });
    const page = create.json().data;

    await app.inject({
      method: "POST",
      url: `/api/v1/pages/${page.slug}/view`,
      headers: { "user-agent": "unique-live-visitor-agent-1" },
    });

    const res = await app.inject({ method: "GET", url: "/api/v1/admin/stats/live-visitors", headers: authHeader() });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.count).toBeGreaterThanOrEqual(1);
  });
});
