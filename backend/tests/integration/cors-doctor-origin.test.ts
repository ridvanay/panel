import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestApp } from "../helpers/build-test-app";
import { resetDatabase } from "../helpers/reset-db";
import { env } from "../../src/config/env";

// `.claude/architect-scope-doctor-subdomain.md` §6.4/§7.2 — CORS allow-list şimdi
// `[FRONTEND_URL, DOCTOR_FRONTEND_URL].filter(Boolean)` (bkz. plugins/security.ts). Bu dosya,
// hem ana site hem hekim portalı origin'inin `Access-Control-Allow-Origin` +
// `Access-Control-Allow-Credentials` aldığını, bilinmeyen/rastgele bir origin'in ise
// ALMADIĞINI doğrular. `DOCTOR_FRONTEND_URL` `.env.test`'te tanımlıdır (bkz. o dosyadaki not).
describe("CORS — hekim portalı allow-list (§7.2)", () => {
  let app: FastifyInstance;

  const doctorOrigin = env.DOCTOR_FRONTEND_URL!;
  const siteOrigin = env.FRONTEND_URL;
  const unknownOrigin = "http://evil-attacker.example.com";

  beforeAll(async () => {
    // Bu doğrulama testin kendisinin anlamlı olduğundan emin olur: `.env.test`'te
    // `DOCTOR_FRONTEND_URL` tanımsız kalırsa test sessizce yanlış pozitif vermesin.
    expect(doctorOrigin).toEqual(expect.any(String));

    app = await buildTestApp();
    await resetDatabase(app.prisma);
  });

  afterAll(async () => {
    await resetDatabase(app.prisma);
    await app.close();
  });

  it("ana site origin'i preflight'ta Allow-Origin + Allow-Credentials alır", async () => {
    const res = await app.inject({
      method: "OPTIONS",
      url: "/api/v1/auth/login",
      headers: {
        origin: siteOrigin,
        "access-control-request-method": "POST",
        "access-control-request-headers": "content-type",
      },
    });

    expect(res.headers["access-control-allow-origin"]).toBe(siteOrigin);
    expect(res.headers["access-control-allow-credentials"]).toBe("true");
  });

  it("hekim portalı origin'i preflight'ta Allow-Origin + Allow-Credentials alır", async () => {
    const res = await app.inject({
      method: "OPTIONS",
      url: "/api/v1/auth/login",
      headers: {
        origin: doctorOrigin,
        "access-control-request-method": "POST",
        "access-control-request-headers": "content-type",
      },
    });

    expect(res.headers["access-control-allow-origin"]).toBe(doctorOrigin);
    expect(res.headers["access-control-allow-credentials"]).toBe("true");
  });

  it("bilinmeyen bir origin Allow-Origin ALMAZ (tarayıcı yanıtı erişilemez sayar)", async () => {
    const res = await app.inject({
      method: "OPTIONS",
      url: "/api/v1/auth/login",
      headers: {
        origin: unknownOrigin,
        "access-control-request-method": "POST",
        "access-control-request-headers": "content-type",
      },
    });

    // Kritik güvenlik invaryantı: allow-list'te olmayan bir origin `Access-Control-Allow-Origin`
    // ALMAZ. `@fastify/cors` (bkz. node_modules/@fastify/cors/index.js::addCorsHeaders),
    // `credentials: true` yapılandırıldığında `Access-Control-Allow-Credentials: true` header'ını
    // origin eşleşmesinden BAĞIMSIZ olarak her zaman ekler — bu kütüphanenin belgelenmiş
    // davranışıdır ve bir güvenlik açığı değildir: tarayıcı, kimlik bilgili (credentialed) bir
    // isteğin yanıtını yalnızca `Access-Control-Allow-Origin` İSTEK origin'iyle TAM eşleştiğinde
    // JavaScript'e açar (bkz. Fetch/CORS spesifikasyonu) — `Allow-Origin` eksikken
    // `Allow-Credentials` tek başına hiçbir origin'e erişim sağlamaz.
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("hekim portalı origin'i gerçek (preflight olmayan) istekte de Allow-Origin alır", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      headers: { origin: doctorOrigin },
      payload: { email: "nonexistent@example.com", password: "wrong-password" },
    });

    // Kimlik doğrulama başarısız olabilir (401) — burada test edilen CORS header'ı, iş
    // mantığı sonucundan BAĞIMSIZDIR.
    expect(res.headers["access-control-allow-origin"]).toBe(doctorOrigin);
    expect(res.headers["access-control-allow-credentials"]).toBe("true");
  });
});
