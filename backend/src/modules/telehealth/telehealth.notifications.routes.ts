import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { requireModuleEnabled } from "../../middleware/module-guard";
import { BOOKING_RESEND_LINK_RATE_LIMIT } from "../../lib/rate-limit";
import { BookingIdParamSchema } from "./telehealth.schemas";
import { resendBookingAccessLink } from "./lib/notifications";

/**
 * `.claude/architect-scope-telehealth-template.md` §9.7.8/§9.7.10 — notification-agent'ın TEK
 * SAHASI. `telehealth.routes.ts`'e (backend-agent'ın dosyası) KASITLI OLARAK DOKUNULMAZ (bkz. o
 * dosyanın üstündeki "NOT" yorumu); bu ayrı dosya `app.ts`'de KENDİ BAŞINA kaydedilir — mevcut
 * `telehealth.livekit.routes.ts` İLE AYNI ayrık-dosya deseni. Public `/appointments` prefix'i
 * altında bağlanır, kimlik doğrulaması GEREKTİRMEZ (openapi.yaml: `security: []`).
 */
export async function telehealthNotificationRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>();
  server.addHook("preHandler", requireModuleEnabled("telehealth"));

  server.post(
    "/appointments/bookings/:bookingId/resend-link",
    {
      // §9.7.7 madde 4 / §9.7.10 (bağlayıcı) — 1 istek/dakika, e-posta numaralandırma/kaba-kuvvet
      // yüzeyini sınırlamak için diğer booking uçlarından ÇOK daha sıkı.
      config: { rateLimit: BOOKING_RESEND_LINK_RATE_LIMIT },
      schema: {
        params: BookingIdParamSchema,
        response: { 202: z.undefined() },
      },
    },
    async (request, reply) => {
      // openapi.yaml (bağlayıcı) — booking var olsun olmasın, ödenmiş olsun olmasın yanıt HER
      // ZAMAN 202'dir (varlık/ödeme durumu sızdırılmaz); ham token YANITTA ASLA dönmez, yalnızca
      // kayıtlı `patientEmail`'e gönderilir (bkz. lib/notifications.ts::resendBookingAccessLink).
      await resendBookingAccessLink(app, request.params.bookingId);
      return reply.code(202).send();
    }
  );
}
