import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestApp } from "../helpers/build-test-app";
import { resetDatabase } from "../helpers/reset-db";
import { registerTestUser } from "../helpers/auth";

/**
 * `GET /admin/logs`: RBAC guard (`requireSiteRole("ADMIN")`), `status`/`action` filtreleri
 * ve cursor-tabanlı sayfalama (`seq desc` + `seq: {lt: cursor}`, bkz. logs.routes.ts).
 * Route-level rate limit (120/dk) zaten `rate-limits.test.ts`'te test ediliyor, burada tekrar edilmez.
 */
describe("logs — GET /admin/logs", () => {
  let app: FastifyInstance;
  let adminToken: string;
  let viewerToken: string;

  function authHeader(token: string) {
    return { authorization: `Bearer ${token}` };
  }

  beforeAll(async () => {
    app = await buildTestApp();
    await resetDatabase(app.prisma);

    // İlk register boş bir DB'de otomatik ADMIN olur (bkz. auth.service.ts).
    const admin = await registerTestUser(app, { email: "logs-admin@example.com" });
    adminToken = admin.accessToken;

    const viewer = await registerTestUser(app, { email: "logs-viewer@example.com" });
    viewerToken = viewer.accessToken;

    // Deterministik loglar: doğrudan Prisma ile oluşturulur (register akışının kendi
    // ürettiği auth.* loglarından bağımsız, filtre/sayfalama davranışını izole test etmek için).
    for (let i = 0; i < 5; i++) {
      await app.prisma.auditLog.create({
        data: {
          actorId: admin.userId,
          actorEmail: admin.email,
          action: "test.fixture_action",
          status: i % 2 === 0 ? "SUCCESS" : "FAILURE",
        },
      });
    }
  });

  afterAll(async () => {
    await resetDatabase(app.prisma);
    await app.close();
  });

  it("ADMIN olmayan bir kullanıcı erişemez (403)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/admin/logs",
      headers: authHeader(viewerToken),
    });
    expect(res.statusCode).toBe(403);
  });

  it("kimliksiz istek 401 döner", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/admin/logs" });
    expect(res.statusCode).toBe(401);
  });

  it("status filtresi yalnızca eşleşen kayıtları döner", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/admin/logs?status=FAILURE&action=test.fixture_action",
      headers: authHeader(adminToken),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.length).toBeGreaterThan(0);
    for (const log of body.data) {
      expect(log.status).toBe("FAILURE");
    }
  });

  it("action filtresi prefix (startsWith) eşleşmesi yapar", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/admin/logs?action=test.fixture",
      headers: authHeader(adminToken),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.length).toBe(5);
    for (const log of body.data) {
      expect(log.action.startsWith("test.fixture")).toBe(true);
    }
  });

  it("cursor sayfalaması: limit=2 ile en yeni önce sırayla, çakışmadan ilerler", async () => {
    const page1 = await app.inject({
      method: "GET",
      url: "/api/v1/admin/logs?action=test.fixture_action&limit=2",
      headers: authHeader(adminToken),
    });
    expect(page1.statusCode).toBe(200);
    const body1 = page1.json();
    expect(body1.data.length).toBe(2);
    expect(body1.meta.nextCursor).toBeTruthy();

    const page2 = await app.inject({
      method: "GET",
      url: `/api/v1/admin/logs?action=test.fixture_action&limit=2&cursor=${body1.meta.nextCursor}`,
      headers: authHeader(adminToken),
    });
    expect(page2.statusCode).toBe(200);
    const body2 = page2.json();
    expect(body2.data.length).toBe(2);

    // Sayfa 1 ve sayfa 2 arasında ID çakışması olmamalı.
    const ids1 = body1.data.map((l: { id: string }) => l.id);
    const ids2 = body2.data.map((l: { id: string }) => l.id);
    expect(ids1.some((id: string) => ids2.includes(id))).toBe(false);

    // Son sayfaya ulaşınca nextCursor null döner.
    const page3 = await app.inject({
      method: "GET",
      url: `/api/v1/admin/logs?action=test.fixture_action&limit=2&cursor=${body2.meta.nextCursor}`,
      headers: authHeader(adminToken),
    });
    expect(page3.statusCode).toBe(200);
    const body3 = page3.json();
    expect(body3.data.length).toBe(1);
    expect(body3.meta.nextCursor).toBeNull();
  });
});
