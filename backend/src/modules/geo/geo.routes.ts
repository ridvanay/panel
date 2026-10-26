import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { ok } from "../../lib/envelope";
import { ApiSuccessSchema } from "../../schemas/common";
import { geoHintForIp } from "../../lib/geo";
import { GEO_HINT_RATE_LIMIT } from "../../lib/rate-limit";

const GeoHintSchema = z.object({ countryCode: z.string().nullable(), timeZone: z.string().nullable() });

/**
 * Paket R — `GET /geo/hint`: ziyaretçinin IP'sinden YALNIZCA ülke kodu + olası saat dilimi
 * (randevu ekranında saat dilimi ÖNERİSİ için; otomatik değişiklik yapılmaz).
 *  - IP saklanmaz/döndürülmez; bu route'un istek/yanıt logları kapalıdır (`logLevel: "silent"`).
 *  - `Cache-Control: private, no-store` (paylaşılan önbelleklerde başka ziyaretçiye dönmesin).
 *  - Route-level hız sınırı. Kimlik doğrulama gerektirmez; kişisel veri kaydı oluşmaz.
 *  - Gerçek istemci IP'si `trustProxy` (prod: TRUST_PROXY=true, nginx `X-Forwarded-For $remote_addr`) ile okunur.
 */
export async function geoRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>();
  server.get(
    "/hint",
    { logLevel: "silent", config: { rateLimit: GEO_HINT_RATE_LIMIT }, schema: { response: { 200: ApiSuccessSchema(GeoHintSchema) } } },
    async (request, reply) => {
      reply.header("Cache-Control", "private, no-store");
      return reply.send(ok(geoHintForIp(request.ip)));
    }
  );
}
