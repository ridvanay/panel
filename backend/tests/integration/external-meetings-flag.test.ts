import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestApp } from "../helpers/build-test-app";
import { EXTERNAL_MEETINGS_ENABLED, setExternalMeetingsEnabledForTests } from "../../src/lib/feature-flags";

/** Varsayılan: bayrak AÇIK (uçlar kayıtlı). Bayrak test içinde kapatılırsa ev sahibi/ADMIN uçları KAYITLI DEĞİLDİR; misafir uçları her zaman kayıtlıdır. */
describe("EXTERNAL_MEETINGS_ENABLED varsayılan (açık)", () => {
  it("sabit true; ev sahibi, ADMIN gözetimi ve meeting-host uçları kayıtlı (404 değil)", async () => {
    setExternalMeetingsEnabledForTests(null);
    const app = await buildTestApp();
    try {
      await app.prisma.siteModule.upsert({ where: { key: "telehealth" }, create: { key: "telehealth", enabled: true }, update: { enabled: true } });
      expect(EXTERNAL_MEETINGS_ENABLED).toBe(true);
      for (const [method, url] of [
        ["GET", "/api/v1/meetings"],
        ["GET", "/api/v1/meetings/host-status"],
        ["GET", "/api/v1/admin/meetings"],
        ["PATCH", "/api/v1/admin/users/abc/meeting-host"],
      ] as const) {
        const res = await app.inject({ method, url, payload: method === "GET" ? undefined : {} });
        expect(res.statusCode, `${method} ${url}`).not.toBe(404);
      }
    } finally {
      await app.close();
    }
  });
});

describe("EXTERNAL_MEETINGS_ENABLED test içinde kapatıldığında", () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    setExternalMeetingsEnabledForTests(false);
    app = await buildTestApp();
    await app.prisma.siteModule.upsert({ where: { key: "telehealth" }, create: { key: "telehealth", enabled: true }, update: { enabled: true } });
  });
  afterAll(async () => {
    await app.close();
    setExternalMeetingsEnabledForTests(null);
  });

  it("ev sahibi, ADMIN gözetimi ve meeting-host uçları kayıtlı değil (404, kimlik doğrulamadan önce)", async () => {
    for (const [method, url] of [
      ["GET", "/api/v1/meetings"],
      ["POST", "/api/v1/meetings"],
      ["GET", "/api/v1/meetings/host-status"],
      ["POST", "/api/v1/meetings/abc/host-token"],
      ["GET", "/api/v1/admin/meetings"],
      ["PATCH", "/api/v1/admin/users/abc/meeting-host"],
    ] as const) {
      const res = await app.inject({ method, url, payload: method === "GET" ? undefined : {} });
      expect(res.statusCode, `${method} ${url}`).toBe(404);
    }
  });

  it("misafir uçları kayıtlı (geçersiz belirteç → tek tip 404 MEETING_LINK_INVALID)", async () => {
    const res = await app.inject({ method: "POST", url: "/api/v1/meet/guest/preflight", payload: { t: "mg_" + "a".repeat(43) } });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("MEETING_LINK_INVALID");
  });
});
