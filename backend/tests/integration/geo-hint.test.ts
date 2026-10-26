import { Writable } from "node:stream";
import Fastify from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import { buildTestApp } from "../helpers/build-test-app";
import { geoRoutes } from "../../src/modules/geo/geo.routes";
import { geoHintForIp } from "../../src/lib/geo";

/**
 * Paket R — `GET /geo/hint`: IP'den yalnızca ülke kodu + olası dilim; `no-store`; IP loglanmaz;
 * hız sınırı. (geoip-lite gömülü veritabanı: 88.198.x → DE, 94.200.x → AE, 8.8.8.8 → US.)
 */
describe("Paket R — /geo/hint", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it("IP'den ülke ve olası saat dilimi; IP yanıtta yok; Cache-Control private, no-store", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/geo/hint", remoteAddress: "88.198.1.1" });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual({ countryCode: "DE", timeZone: "Europe/Berlin" });
    expect(res.headers["cache-control"]).toBe("private, no-store");
    expect(res.body).not.toContain("88.198");

    const local = await app.inject({ method: "GET", url: "/api/v1/geo/hint", remoteAddress: "127.0.0.1" });
    expect(local.json().data).toEqual({ countryCode: null, timeZone: null });
  });

  it("geoip kaydında dilim yoksa/ülkeyle uyuşmazsa ülkenin ana dilimi (RU → Moskova, Kaliningrad değil)", () => {
    expect(geoHintForIp("94.200.0.1")).toEqual({ countryCode: "AE", timeZone: "Asia/Dubai" });
    expect(geoHintForIp("8.8.8.8").countryCode).toBe("US");
    expect(geoHintForIp("5.255.255.70")).toEqual({ countryCode: "RU", timeZone: "Europe/Moscow" });
    expect(geoHintForIp(undefined)).toEqual({ countryCode: null, timeZone: null });
  });

  it("IP loglanmaz: route istek/yanıt logları kapalı; trustProxy ile gerçek istemci IP'si okunur", async () => {
    const lines: string[] = [];
    const stream = new Writable({
      write(chunk, _enc, cb) {
        lines.push(String(chunk));
        cb();
      },
    });
    const probe = Fastify({ logger: { level: "trace", stream }, trustProxy: true });
    probe.setValidatorCompiler(validatorCompiler);
    probe.setSerializerCompiler(serializerCompiler);
    await probe.register(geoRoutes, { prefix: "/geo" });
    probe.get("/control", async () => ({ ok: true }));
    await probe.ready();

    // nginx: `X-Forwarded-For $remote_addr` — soket 127.0.0.1, gerçek istemci 94.200.0.1 (AE).
    const res = await probe.inject({ method: "GET", url: "/geo/hint", remoteAddress: "127.0.0.1", headers: { "x-forwarded-for": "94.200.0.1" } });
    expect(res.json().data.countryCode).toBe("AE");
    expect(lines.join("\n")).not.toContain("94.200.0.1");
    expect(lines.some((l) => l.includes("/geo/hint"))).toBe(false);

    // Yakalama gerçekten çalışıyor: kontrol route'u istek logunu (ve adresi) yazar.
    await probe.inject({ method: "GET", url: "/control", remoteAddress: "127.0.0.1", headers: { "x-forwarded-for": "94.200.0.2" } });
    expect(lines.some((l) => l.includes("/control"))).toBe(true);
    await probe.close();
  });

  it("hız sınırı: dakikada 20 istekten sonra 429", async () => {
    const ip = "88.198.7.7";
    const codes: number[] = [];
    for (let i = 0; i < 21; i++) codes.push((await app.inject({ method: "GET", url: "/api/v1/geo/hint", remoteAddress: ip })).statusCode);
    expect(codes.slice(0, 20).every((c) => c === 200)).toBe(true);
    expect(codes[20]).toBe(429);
  });
});
