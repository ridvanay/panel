import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import sanitizeLocalhostMediaUrlsPlugin from "../../src/plugins/sanitize-localhost-media-urls";

/**
 * 2026-09-19 (kullanıcı talebi) — `sanitize-localhost-urls.test.ts`'in çekirdek fonksiyonu (saf,
 * birim test edildi) GERÇEKTEN bir Fastify `onSend` yanıt döngüsüne bağlı mı, doğru `Content-Type`
 * ayrımını yapıyor mu — BU dosya doğrular. Tam `buildTestApp()` (DB/auth GEREKTİRİR) yerine
 * BİLİNÇLİ OLARAK minimal, bağımsız bir Fastify örneği: plugin'in KENDİSİ DB'den/auth'tan bağımsız
 * saf bir `onSend` hook'u, tam üretim uygulamasını ayağa kaldırmak GEREKSİZ ek karmaşıklık olurdu.
 */
describe("plugins/sanitize-localhost-media-urls — onSend hook", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify();
    await app.register(sanitizeLocalhostMediaUrlsPlugin);
    app.get("/json-with-localhost", async () => ({ url: "http://siteadi.localhost:4000/uploads/x.png", title: "Ana Sayfa" }));
    app.get("/json-clean", async () => ({ url: "https://wmhealthistanbul.com/uploads/x.png" }));
    app.get("/plain-text-with-localhost", async (_req, reply) => {
      reply.type("text/plain");
      return "http://localhost:4000/uploads/x.png";
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("application/json yanıtındaki loopback host+port önekini siler", async () => {
    const res = await app.inject({ method: "GET", url: "/json-with-localhost" });
    expect(res.json()).toEqual({ url: "/uploads/x.png", title: "Ana Sayfa" });
    expect(res.body).not.toContain("localhost");
  });

  it("loopback host İÇERMEYEN bir JSON yanıtına DOKUNMAZ (bit-bit aynı gövde)", async () => {
    const res = await app.inject({ method: "GET", url: "/json-clean" });
    expect(res.json()).toEqual({ url: "https://wmhealthistanbul.com/uploads/x.png" });
  });

  it("application/json OLMAYAN (ör. text/plain) yanıtlara DOKUNMAZ", async () => {
    const res = await app.inject({ method: "GET", url: "/plain-text-with-localhost" });
    expect(res.body).toBe("http://localhost:4000/uploads/x.png");
  });
});
