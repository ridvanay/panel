import fp from "fastify-plugin";
import type { FastifyInstance } from "fastify";

/**
 * Trace correlation (bkz. proje kökü CLAUDE.md § Kurallar): her isteğin bir request-id'si
 * olmalı ve bu id istemciden sunucuya kadar aynı kalmalıdır. `app.ts`'teki `requestIdHeader:
 * "x-request-id"` + `genReqId` ayarları sayesinde Fastify, istemcinin gönderdiği
 * `x-request-id` header'ını `request.id` olarak KABUL EDER (yoksa yeni bir UUID üretir) —
 * bu plugin sadece son adımı tamamlar: sonucu response header'ında GERİ YANSITIR ki
 * frontend kendi ürettiği id'yi (bkz. frontend/src/lib/api/client.ts) response'ta doğrulayıp
 * hata loglarına/Sentry event'lerine ekleyebilsin (bkz. plugins/error-handler.ts — aynı id
 * `request.log.error` satırlarında `reqId` alanı olarak zaten görünür, pino child logger'ı
 * `request.id`'yi otomatik bağlar).
 */
export default fp(async function requestIdPlugin(app: FastifyInstance) {
  app.addHook("onSend", async (request, reply, payload) => {
    reply.header("x-request-id", request.id);
    return payload;
  });
});
