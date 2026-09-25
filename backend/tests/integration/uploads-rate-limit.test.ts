import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestApp } from "../helpers/build-test-app";
import { resetDatabase } from "../helpers/reset-db";

/**
 * `/uploads/*` (bkz. plugins/uploads.ts) auth GEREKTİRMEYEN, herkese açık statik medya
 * servisidir — API kovasından (`env.RATE_LIMIT_MAX`) ayrı, kod içinde sabit kendi limitine
 * (600/dk, bkz. lib/rate-limit.ts::UPLOADS_RATE_LIMIT) tabidir.
 * Var olmayan bir dosya istemek bile (route eşleşmesi `/uploads/*` wildcard'ı üzerinden olduğu
 * için) rate limit sayacını işletir — bu yüzden gerçek bir dosya yüklemeye gerek yok, sadece
 * sayaç davranışını doğruluyoruz (404'ler limit sayılır, limit aşılınca 429 döner).
 *
 * Kendi izole `buildTestApp()` instance'ında çalışır ki bu limiti fiilen tüketmesi başka bir
 * test dosyasındaki `/uploads/*` kullanımlarını etkilemesin.
 */
describe("rate-limits — route-özel (/uploads/*)", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
    await resetDatabase(app.prisma);
  });

  afterAll(async () => {
    await resetDatabase(app.prisma);
    await app.close();
  });

  it("600 istek sonrası 601. istek 429 döner (var olmayan dosya için bile sayaç işler)", async () => {
    for (let i = 0; i < 600; i++) {
      const res = await app.inject({ method: "GET", url: "/uploads/does-not-exist.png" });
      // Dosya gerçekte yok — beklenen 404, ÖNEMLİ olan rate limit sayacının 429'a ulaşmadan
      // önce bu isteklerin hepsini geçirmesi.
      expect(res.statusCode).toBe(404);
    }

    const resOver = await app.inject({ method: "GET", url: "/uploads/does-not-exist.png" });
    expect(resOver.statusCode).toBe(429);
  });
});
