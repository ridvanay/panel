import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestApp } from "../helpers/build-test-app";
import { EXTERNAL_MEETINGS_ENABLED, setExternalMeetingsEnabledForTests } from "../../src/lib/feature-flags";

/** AI İş 3 hızlı sürüm: genel harici toplantı bayrağı kapalıyken AG ev sahibi/ADMIN uçları KAYITLI DEĞİLDİR; misafir uçları kayıtlıdır. */
describe("EXTERNAL_MEETINGS_ENABLED kapalı", () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    setExternalMeetingsEnabledForTests(null);
    app = await buildTestApp();
    await app.prisma.siteModule.upsert({ where: { key: "telehealth" }, create: { key: "telehealth", enabled: true }, update: { enabled: true } });
  });
  afterAll(async () => {
    await app.close();
  });

  it("sabit false", () => {
    expect(EXTERNAL_MEETINGS_ENABLED).toBe(false);
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
