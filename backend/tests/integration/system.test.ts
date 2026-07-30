import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestApp } from "../helpers/build-test-app";
import { resetDatabase } from "../helpers/reset-db";
import { registerTestUser } from "../helpers/auth";

describe("system health", () => {
  let app: FastifyInstance;
  let adminAccessToken: string;
  let viewerAccessToken: string;

  beforeAll(async () => {
    app = await buildTestApp();
    await resetDatabase(app.prisma);
    // İlk kayıt olan kullanıcı otomatik ADMIN olur (bkz. auth.service.ts); ikincisi varsayılan VIEWER kalır.
    ({ accessToken: adminAccessToken } = await registerTestUser(app));
    ({ accessToken: viewerAccessToken } = await registerTestUser(app));
  });

  afterAll(async () => {
    await resetDatabase(app.prisma);
    await app.close();
  });

  it("rejects without authentication (401)", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/admin/health" });
    expect(res.statusCode).toBe(401);
  });

  it("rejects a non-ADMIN authenticated user (403)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/admin/health",
      headers: { authorization: `Bearer ${viewerAccessToken}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it("returns real system metrics for an ADMIN", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/admin/health",
      headers: { authorization: `Bearer ${adminAccessToken}` },
    });
    expect(res.statusCode).toBe(200);

    const data = res.json().data;
    expect(typeof data.dbPingMs).toBe("number");
    expect(data.dbPingMs).toBeGreaterThanOrEqual(0);
    expect(data.dbSizeBytes).toBeGreaterThan(0);
    expect(data.mediaStorageBytes).toBeGreaterThanOrEqual(0);
    expect(data.memoryTotalBytes).toBeGreaterThan(0);
    expect(data.memoryUsedBytes).toBeGreaterThan(0);
    expect(data.processMemoryBytes).toBeGreaterThan(0);
    expect(data.loadAverage).toHaveLength(3);
    expect(typeof data.platform).toBe("string");
    expect(data.uptimeSeconds).toBeGreaterThanOrEqual(0);
    expect(typeof data.checkedAt).toBe("string");
    // Bu ortamda quota env değişkenleri tanımlı değil -> null bekleniyor (uydurma sayı yok).
    expect(data.dbQuotaBytes).toBeNull();
    expect(data.mediaStorageQuotaBytes).toBeNull();
  });
});
