import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestApp } from "../helpers/build-test-app";

describe("GET /api/v1/healthz", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it("returns ok (DB erişilebilirken)", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/healthz" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
  });

  // Docker/orkestrasyon healthcheck'inin DB down senaryosunda gerçekten devreye girdiğini
  // kanıtlar — bkz. src/modules/health/health.routes.ts'teki karar notu.
  it("DB'ye ulaşılamadığında 503 döner, sözleşmeyi (200 durumu) bozmaz", async () => {
    const spy = vi.spyOn(app.prisma, "$queryRaw").mockRejectedValueOnce(new Error("connection terminated"));

    const res = await app.inject({ method: "GET", url: "/api/v1/healthz" });

    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ status: "error" });

    spy.mockRestore();
  });

  it("her istek için bir x-request-id response header'ı taşır (trace correlation)", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/healthz" });
    expect(res.headers["x-request-id"]).toEqual(expect.any(String));
    expect((res.headers["x-request-id"] as string).length).toBeGreaterThan(0);
  });

  it("istemcinin gönderdiği x-request-id'yi aynen geri yansıtır", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/healthz",
      headers: { "x-request-id": "test-trace-abc-123" },
    });
    expect(res.headers["x-request-id"]).toBe("test-trace-abc-123");
  });
});
