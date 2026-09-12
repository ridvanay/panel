import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { requireModuleEnabled } from "../../middleware/module-guard";
import { authenticateOptional } from "../../middleware/authenticate";
import { ok } from "../../lib/envelope";
import { ApiSuccessSchema } from "../../schemas/common";
import { BookingCheckoutSessionResponseSchema } from "../../schemas/entities";
import { BookingExpiredError, BookingNotPayableError, NotFoundError, PaymentsNotConfiguredError } from "../../lib/errors";
import { assertBookingPatientOnlyAccess } from "../../lib/telehealth-access";
import { stripe } from "../../lib/stripe";
import { env } from "../../config/env";
import { BOOKING_CHECKOUT_SESSION_RATE_LIMIT } from "../../lib/rate-limit";
import { AccessTokenQuerySchema, BookingIdParamSchema } from "./telehealth.schemas";
import { getLocaleSet } from "../../lib/localization";

/**
 * `.claude/architect-scope-telehealth-template.md` §9.7.1 KARAR G / §9.7.9 / §9.7.10 —
 * integration-agent'ın TEK SAHASI: `POST /appointments/bookings/{bookingId}/checkout-session`.
 * `telehealth.routes.ts`'e (backend-agent'ın dosyası) KASITLI OLARAK DOKUNULMAZ — bu ayrı dosya
 * `app.ts`'de KENDİ BAŞINA kaydedilir (`telehealth.livekit.routes.ts` İLE AYNI desen). Public
 * `/appointments` yüzeyine EKLENİR; fiyat/slot matematiğine (booking oluşturma) DOKUNMAZ, yalnızca
 * ZATEN hesaplanmış `unitPriceCents`/`slotCount`/`totalCents`'i Stripe'a taşır.
 */

const WITH_BOOKING_DOCTOR = { id: true, title: true, fullName: true, slug: true, userId: true } as const;

/**
 * Stripe, `expires_at` için oturum OLUŞTURULMA anından itibaren EN AZ 30 dakika ister
 * (`InvalidRequestError` aksi hâlde). `AppointmentBooking.expiresAt` İSE booking OLUŞTURULMA
 * anından + sabit 30 dakikadır — bu uç booking oluşturulduktan bir miktar SONRA çağrıldığında
 * (kaçınılmaz — aynı anda olamaz), booking'in kalan süresi Stripe'ın "şu andan +30dk" asgarisinin
 * ALTINA düşer. Çözüm: yalnızca Stripe'a gönderilen değeri Stripe'ın asgari sınırına (bir dakikalık
 * güvenlik payıyla) YÜKSELT — `AppointmentBooking.expiresAt`'in KENDİSİ (slot tutma/süpürücü
 * mantığı) DEĞİŞTİRİLMEZ. **Bilinçli, dar bir sapma** — mimari doküma (§9.7.1 madde 2) "expires_at
 * = booking'in expiresAt'i" der; bu, Stripe SDK kısıtıyla harfiyen aynı anda ÇAKIŞTIĞI için
 * (gecikme > 0 olduğu sürece matematiksel olarak imkânsız) mecburi bir uyarlamadır — bkz. görev
 * özeti/security-agent'a taşınan risk notu.
 */
const STRIPE_MIN_EXPIRES_AT_BUFFER_MS = 31 * 60 * 1000;

function resolveStripeExpiresAtSeconds(bookingExpiresAt: Date): number {
  const nowMs = Date.now();
  const bookingExpiresMs = bookingExpiresAt.getTime();
  const minAllowedMs = nowMs + STRIPE_MIN_EXPIRES_AT_BUFFER_MS;
  return Math.floor(Math.max(bookingExpiresMs, minAllowedMs) / 1000);
}

/** `/patient/bookings/{id}` sayfasına dönüş — mevcut `notifications.ts::buildMagicLink` İLE AYNI dil/yol deseni. */
async function buildPatientReturnUrl(app: FastifyInstance, bookingId: string, providedToken: string | undefined, suffix: string): Promise<string> {
  const localeSet = await getLocaleSet(app);
  const tokenQuery = providedToken ? `&t=${encodeURIComponent(providedToken)}` : "";
  return `${env.FRONTEND_URL}/${localeSet.default.code}/patient/bookings/${bookingId}?${suffix}${tokenQuery}`;
}

/** `/appointments` prefix'i altında bağlanır (bkz. app.ts) — PUBLIC, opsiyonel kimlik doğrulama. */
export async function telehealthCheckoutRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>();
  server.addHook("preHandler", requireModuleEnabled("telehealth"));
  // §7.2/§9.7.10 — oturum açmış hasta Bearer ile de çağırabilir (misafir `?t=` akışıyla AYNI uç).
  server.addHook("preHandler", authenticateOptional);

  server.post(
    "/appointments/bookings/:bookingId/checkout-session",
    {
      config: { rateLimit: BOOKING_CHECKOUT_SESSION_RATE_LIMIT },
      schema: {
        params: BookingIdParamSchema,
        querystring: AccessTokenQuerySchema,
        response: { 200: ApiSuccessSchema(BookingCheckoutSessionResponseSchema) },
      },
    },
    async (request, reply) => {
      // §9.7.1 madde 6 (bağlayıcı) — yapılandırılmamışken booking'in var olup olmadığı hiç
      // sorgulanmadan HEMEN 503 (`LiveKitNotConfiguredError` İLE BİREBİR AYNI desen).
      if (!env.STRIPE_SECRET_KEY) {
        throw new PaymentsNotConfiguredError();
      }

      const booking = await app.prisma.appointmentBooking.findUnique({
        where: { id: request.params.bookingId },
        include: { doctor: { select: WITH_BOOKING_DOCTOR }, appointments: { select: { endsAt: true } } },
      });
      if (!booking) throw new NotFoundError("Rezervasyon bulunamadı.");

      // §9.7.10 uç tablosu (bağlayıcı) — YALNIZCA hasta (`?t=`/oturum); `ADMIN` bu ucu
      // KULLANMAZ (manuel ofis-içi ödeme için AYRI `POST /admin/telehealth/bookings/{id}/mark-paid`
      // ucu vardır, §9.7.1 madde 7 — backend-agent'ın sahası).
      assertBookingPatientOnlyAccess(booking, { user: request.user, providedToken: request.query.t });

      if (booking.paymentStatus !== "PENDING") {
        throw new BookingNotPayableError();
      }
      // Süpürücü (`lib/booking-expiry.ts`) 5 dakikada bir çalışır — booking süresi dolmuş ama
      // henüz süpürülmemiş olabilir; bu durumu `PENDING` ile KARIŞTIRMAMAK için AYRI bir kod.
      if (booking.expiresAt.getTime() < Date.now()) {
        throw new BookingExpiredError();
      }

      // İDEMPOTENCY (openapi.yaml açıklaması, bağlayıcı) — booking'in ZATEN geçerli/açık bir
      // Checkout oturumu varsa Stripe'a YENİDEN oturum AÇILMAZ, aynısı döner (ör. hasta ödeme
      // sayfasını yenilerse/geri gelirse iki ayrı Stripe oturumu birikmez).
      if (booking.stripeCheckoutSessionId) {
        const existingSession = await stripe.checkout.sessions.retrieve(booking.stripeCheckoutSessionId);
        if (existingSession.status === "open" && existingSession.url) {
          return reply.send(
            ok({
              checkoutUrl: existingSession.url,
              sessionId: existingSession.id,
              expiresAt: existingSession.expires_at
                ? new Date(existingSession.expires_at * 1000).toISOString()
                : booking.expiresAt.toISOString(),
            })
          );
        }
      }

      // **KRİTİK TASARIM KARARI** (görev notu, backend-agent'ın `lib/booking.ts::
      // confirmBookingPayment` yorumundaki ÖNERİLEN kullanım) — booking'in KENDİ ham
      // `accessToken`'ı (yalnızca misafir `?t=` ile geldiyse ELİMİZDEDİR) Stripe `metadata`'sına
      // TAŞINIR. Webhook (`webhooks/stripe.routes.ts::handleTelehealthBookingPaid`) bu değeri
      // `confirmBookingPayment`'a `knownRawAccessToken` olarak geçirir — böylece
      // `accessTokenHash` ROTATE EDİLMEZ ve hastanın booking oluşturma anında aldığı magic-link
      // ödeme SONRASI da ÇALIŞMAYA DEVAM EDER (§9.7.7 madde 4: "ham token BİR KEZ döner ve ödeme
      // sonrası e-postada iletilir" — AYNI bağlantı, rotate edilmiş YENİ bir bağlantı DEĞİL).
      // Oturum açmış (Bearer) hastanın `?t=`'si YOKSA metadata'ya bir şey KONULMAZ; webhook bu
      // durumda `resend-link` ile AYNI ilkeyle YENİ bir token üretir (rotate) — oturumlu hastanın
      // zaten `/patient/bookings` üzerinden kimlik-doğrulamalı erişimi olduğu için bu bir
      // erişim KAYBI DEĞİLDİR (bkz. görev özeti — security-agent'a taşınan karar notu:
      // ham token'ın Stripe metadata'sına TAŞINMASI, backend↔Stripe arası kalır, istemciye/loglara
      // SIZMAZ, ama 3. parti bir sistemde bir erişim kimlik bilgisi bulundurmanın kendi riskini
      // taşır — ayrı sağlık verisi erişim yetkisine denk geldiği için AYRICA denetlenmelidir).
      const metadata: Record<string, string> = { kind: "telehealth_booking", bookingId: booking.id };
      if (request.query.t) {
        metadata.rawAccessToken = request.query.t;
      }

      const expiresAtSeconds = resolveStripeExpiresAtSeconds(booking.expiresAt);

      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        customer_email: booking.patientEmail,
        line_items: [
          {
            price_data: {
              currency: booking.currency.toLowerCase(),
              unit_amount: booking.unitPriceCents,
              // §9.7.1 madde 9 gerekçesi (c) / §9.7.5 madde 8 disiplini — doktor/uzmanlık adı
              // ÇIKARIMSAL SAĞLIK VERİSİDİR; Stripe'a giden satır adına ASLA YAZILMAZ.
              product_data: { name: `Online konsültasyon (${booking.slotCount} seans)` },
            },
            quantity: booking.slotCount,
          },
        ],
        success_url: await buildPatientReturnUrl(app, booking.id, request.query.t, "payment=success"),
        cancel_url: await buildPatientReturnUrl(app, booking.id, request.query.t, "payment=cancelled"),
        expires_at: expiresAtSeconds,
        // `payment_intent.payment_failed` olayı yalnızca `PaymentIntent`i taşır (Checkout Session'ı
        // DEĞİL) — `bookingId`'yi o olayda da çözebilmek için PaymentIntent'e AYRICA yazılır.
        payment_intent_data: { metadata: { bookingId: booking.id } },
        metadata,
      });

      if (!session.url) throw new BookingNotPayableError("Stripe checkout oturumu oluşturulamadı.");

      // GÜVENLİK DÜZELTMESİ (security-agent, görev özeti madde 2) — `booking.expiresAt`
      // (`lib/booking-expiry.ts` süpürücüsünün KENDİ kesim noktası, 5 dk kadans) Stripe'a
      // VAAT EDİLEN `expiresAtSeconds` (yukarıda `resolveStripeExpiresAtSeconds`) DEĞERİYLE
      // SENKRONİZE edilir. AKSİ HÂLDE: booking oluşturma ile checkout-session çağrısı arasında
      // (ör. hasta intake formunu doldururken) geçen HERHANGİ bir gecikme, iki "süre dolumu"
      // saatini birbirinden AYRIŞTIRIR — Stripe'ın ödeme sayfası hâlâ AÇIK göründüğü hâlde
      // süpürücü randevu satırlarını HARD DELETE edip booking'i `EXPIRED` yapabilir; hasta
      // Stripe'ta ödemeyi TAMAMLARSA `confirmBookingPayment` `booking.paymentStatus !== PENDING`
      // görüp `BookingNotPayableError` fırlatır ve webhook bunu SESSİZCE idempotent no-op sanır
      // — para ALINIR ama randevu ASLA `SCHEDULED` olmaz, iade mekanizması bu turda YOKTUR
      // (§9.7.1 madde 8). Bu satır, süpürücünün KENDİ ÜRETTİĞİMİZ ödeme penceresinden ÖNCE asla
      // devreye girmemesini garanti eder — "en fazla 30 dk slot tutma" garantisi BOZULMAZ (o
      // garanti yalnızca hasta HENÜZ ödeme sayfasına GEÇMEDİYSE geçerlidir; ödeme sayfası
      // AÇILDIKTAN sonra hold, Stripe'a fiilen VAAT EDİLEN süreye kadar UZAR — bu, "ödeme
      // sürecindeyken slotu elinden almamak" ile "sonsuza dek tutmamak" arasındaki tek tutarlı
      // orta yoldur; idempotency zaten AÇIK bir Stripe oturumu varken bu güncellemeyi TEKRARLAMAZ,
      // bkz. yukarıdaki `existingSession.status === "open"` erken dönüşü).
      await app.prisma.appointmentBooking.update({
        where: { id: booking.id },
        data: { stripeCheckoutSessionId: session.id, expiresAt: new Date(expiresAtSeconds * 1000) },
      });

      return reply.send(
        ok({
          checkoutUrl: session.url,
          sessionId: session.id,
          expiresAt: new Date(expiresAtSeconds * 1000).toISOString(),
        })
      );
    }
  );
}
