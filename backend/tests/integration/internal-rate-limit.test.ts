import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { buildTestApp } from "../helpers/build-test-app";
import { resetDatabase } from "../helpers/reset-db";
import { UPLOAD_DIR } from "../../src/plugins/uploads";

/**
 * Canlı yapının taklidi (INFRA.md "internal rate-limit sınıflandırması"): TRUST_PROXY=true, Nginx
 * `X-Forwarded-For`'u gerçek ziyaretçi adresiyle yazar ve backend'e Docker gateway adresinden
 * bağlanır; frontend konteyneri (SSR + next/image) XFF'siz, kendi iç adresinden bağlanır.
 */
vi.mock("../../src/config/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/config/env")>();
  return { ...actual, env: { ...actual.env, TRUST_PROXY: true, RATE_LIMIT_MAX: 300 } };
});

const FRONTEND = "172.19.0.4";
const GATEWAY = "172.19.0.1"; // Nginx → 127.0.0.1:4000 → docker-proxy
const uuidFile = `${randomUUID()}.png`;
const legacyFile = `legacy-logo-${randomUUID().slice(0, 8)}.png`;
// 1x1 PNG
const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c63f8cfc0f01f0005000201a5b3c0520000000049454e44ae426082", "hex");

function visitor(ip: string) {
  return { remoteAddress: GATEWAY, headers: { "x-forwarded-for": ip } };
}

describe("rate limit — iç istemci (frontend) ayrı kova, /uploads ayrı kova + önbellek", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
    await resetDatabase(app.prisma);
    // DNS çözümü yerine test adresi — sınıflandırma YALNIZCA ham soket adresine bakar.
    app.internalClients.isInternal = (address) => address === FRONTEND;
    fs.writeFileSync(path.join(UPLOAD_DIR, uuidFile), PNG);
    fs.writeFileSync(path.join(UPLOAD_DIR, legacyFile), PNG);
  });

  afterAll(async () => {
    fs.rmSync(path.join(UPLOAD_DIR, uuidFile), { force: true });
    fs.rmSync(path.join(UPLOAD_DIR, legacyFile), { force: true });
    await resetDatabase(app.prisma);
    await app.close();
  });

  it("frontend'den 400 istek 429'a düşmez; iç kova 10.000/dk ve ziyaretçileri etkilemez", async () => {
    for (let i = 0; i < 400; i++) {
      const res = await app.inject({ method: "GET", url: "/api/v1/settings", remoteAddress: FRONTEND });
      expect(res.statusCode).toBe(200);
      if (i === 0) expect(res.headers["x-ratelimit-limit"]).toBe("10000");
    }
    const visitorRes = await app.inject({ method: "GET", url: "/api/v1/settings", ...visitor("203.0.113.10") });
    expect(visitorRes.statusCode).toBe(200);
    expect(visitorRes.headers["x-ratelimit-limit"]).toBe("300");
    expect(visitorRes.headers["x-ratelimit-remaining"]).toBe("299");
  });

  it("Nginx'ten gelen ziyaretçiler XFF adresiyle ayrı kovalarda; biri 300'ü aşınca yalnız o 429 alır", async () => {
    for (let i = 0; i < 300; i++) {
      const res = await app.inject({ method: "GET", url: "/api/v1/settings", ...visitor("203.0.113.20") });
      expect(res.statusCode).toBe(200);
    }
    expect((await app.inject({ method: "GET", url: "/api/v1/settings", ...visitor("203.0.113.20") })).statusCode).toBe(429);
    expect((await app.inject({ method: "GET", url: "/api/v1/settings", ...visitor("203.0.113.21") })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/api/v1/settings", remoteAddress: FRONTEND })).statusCode).toBe(200);
  });

  it("taklit edilemez: XFF'e frontend adresi yazmak veya gateway'den XFF'siz gelmek iç kovaya almaz", async () => {
    const spoofed = await app.inject({ method: "GET", url: "/api/v1/settings", ...visitor(FRONTEND) });
    expect(spoofed.headers["x-ratelimit-limit"]).toBe("300");
    const direct = await app.inject({ method: "GET", url: "/api/v1/settings", remoteAddress: "198.51.100.7", headers: { "x-forwarded-for": FRONTEND } });
    expect(direct.headers["x-ratelimit-limit"]).toBe("300");
    const gatewayNoXff = await app.inject({ method: "GET", url: "/api/v1/settings", remoteAddress: GATEWAY });
    expect(gatewayNoXff.headers["x-ratelimit-limit"]).toBe("300");
  });

  it("/uploads: 100 hızlı istek hepsi 200, UUID dosya 1 yıl immutable, diğerleri 1 gün; API kovası tüketilmez", async () => {
    for (let i = 0; i < 100; i++) {
      const res = await app.inject({ method: "GET", url: `/uploads/${uuidFile}`, ...visitor("203.0.113.30") });
      expect(res.statusCode).toBe(200);
      expect(res.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
    }
    const legacy = await app.inject({ method: "GET", url: `/uploads/${legacyFile}`, ...visitor("203.0.113.30") });
    expect(legacy.headers["cache-control"]).toBe("public, max-age=86400");

    const api = await app.inject({ method: "GET", url: "/api/v1/settings", ...visitor("203.0.113.30") });
    expect(api.headers["x-ratelimit-remaining"]).toBe("299");
  });

  it("/uploads ziyaretçi kovası 600/dk; iç istemci (next/image) kendi kovasında", async () => {
    for (let i = 0; i < 600; i++) {
      const res = await app.inject({ method: "GET", url: "/uploads/does-not-exist.png", ...visitor("203.0.113.40") });
      expect(res.statusCode).toBe(404);
    }
    expect((await app.inject({ method: "GET", url: "/uploads/does-not-exist.png", ...visitor("203.0.113.40") })).statusCode).toBe(429);
    const internal = await app.inject({ method: "GET", url: `/uploads/${uuidFile}`, remoteAddress: FRONTEND });
    expect(internal.statusCode).toBe(200);
    expect(internal.headers["x-ratelimit-limit"]).toBe("10000");
  });
});
