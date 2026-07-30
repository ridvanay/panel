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

  function authHeader() {
    return { authorization: `Bearer ${accessToken}` };
  }

  it("rejects /admin/stats/views without authentication (401)", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/admin/stats/views" });
    expect(res.statusCode).toBe(401);
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
