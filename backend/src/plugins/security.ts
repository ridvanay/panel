import fp from "fastify-plugin";
import type { FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import cookie from "@fastify/cookie";
import { env } from "../config/env";

export default fp(async function securityPlugin(app: FastifyInstance) {
  await app.register(helmet, {
    // Saf JSON API — HTML sunmuyoruz, CSP burada anlamsız ve istemci entegrasyonlarını kırabilir.
    contentSecurityPolicy: false,
    // helmet'in varsayılanı `same-origin`; ancak /uploads/* altındaki görseller/medya
    // farklı origin/port'taki frontend'den (bkz. plugins/uploads.ts — "herkese açık
    // statik servis") <img> ile yüklenmek üzere tasarlandı. `same-origin` bu cross-origin
    // resource yüklemelerini tarayıcıda sessizce engelliyordu (CORS izin verse bile).
    crossOriginResourcePolicy: { policy: "cross-origin" },
  });

  await app.register(cors, {
    origin: env.FRONTEND_URL,
    credentials: true, // refresh token httpOnly cookie için gerekli
  });

  await app.register(cookie);

  await app.register(rateLimit, {
    global: true,
    max: env.RATE_LIMIT_MAX,
    timeWindow: env.RATE_LIMIT_WINDOW,
    // Varsayılan header davranışı korunur (Retry-After dahil x-ratelimit-* header'ları
    // otomatik eklenir, bkz. addHeaders/addHeadersOnExceeding varsayılanları) — burada sadece
    // JSON gövdesini projenin standart hata zarfıyla (`{ error: { code, message, details } }`,
    // bkz. plugins/error-handler.ts::sendError) tutarlı hale getiriyor ve kalan bekleme
    // süresini somut saniye olarak mesaja/gövdeye ekliyoruz. Bu obje `throw` edilip
    // setErrorHandler'a düşer (bkz. error-handler.ts'teki RATE_LIMITED dalı).
    errorResponseBuilder: (_request, context) => {
      const retryAfterSeconds = Math.max(1, Math.ceil(context.ttl / 1000));
      return {
        statusCode: 429,
        retryAfterSeconds,
        message: `Çok fazla istek. ${retryAfterSeconds} saniye sonra tekrar deneyin.`,
      };
    },
  });
});
