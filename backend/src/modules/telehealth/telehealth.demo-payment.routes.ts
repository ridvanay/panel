import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { requireModuleEnabled } from "../../middleware/module-guard";
import { authenticateOptional } from "../../middleware/authenticate";
import { ok } from "../../lib/envelope";
import { ApiSuccessSchema } from "../../schemas/common";
import { AppointmentBookingSchema } from "../../schemas/entities";
import { BookingExpiredError, BookingNotPayableError, DemoPaymentsDisabledError, NotFoundError } from "../../lib/errors";
import { assertBookingPatientOnlyAccess, canAccessBookingHealthData } from "../../lib/telehealth-access";
import { isDemoPaymentsEnabled } from "../../config/env";
import { computeDemoPaymentsEnabled } from "../../lib/demo-payments";
import { SETTINGS_ID } from "../settings/settings.routes";
import { BOOKING_CHECKOUT_SESSION_RATE_LIMIT } from "../../lib/rate-limit";
import { AccessTokenQuerySchema, BookingIdParamSchema } from "./telehealth.schemas";
import { toAppointmentBookingDto } from "../../mappers";
import { confirmBookingPayment } from "./lib/booking";
import { triggerAppointmentConfirmationEmail } from "./lib/notifications";
import { provisionPatientAccountForBooking } from "./lib/patient-account";

/**
 * `.claude/architect-scope-demo-payment-doctor-counters.md` İstek 1 (BAĞLAYICI) —
 * `POST /appointments/bookings/{bookingId}/demo-pay`: geliştirme/demo ödeme simülatörü.
 *
 * **Sahiplik:** backend-agent. Stripe SDK'sına/webhook'a/herhangi bir 3. parti API'ye HİÇ
 * DOKUNMAZ → integration-agent'ın sahası DEĞİLDİR (yalnızca gözden geçirir). `telehealth.routes.ts`
 * (her zaman kayıtlı) ve `telehealth.checkout.routes.ts`'e (integration-agent'ın sahası) KASITLI
 * OLARAK DOKUNULMAZ — bu YENİ, AYRI bir dosyadır; `app.ts`'de KOŞULLU register edilir
 * (`telehealth.livekit.routes.ts`/`telehealth.checkout.routes.ts` İLE AYNI "kendi başına register
 * edilen ayrı dosya" deseni, ama bunlardan FARKLI olarak yalnızca `isDemoPaymentsEnabled` iken).
 *
 * **Üç katmanlı gating (VE, "VEYA" DEĞİL) — §1.3:**
 * 1. Env: `env.NODE_ENV !== "production"` VE `env.ENABLE_DEMO_PAYMENTS === true`
 *    (`config/env.ts::isDemoPaymentsEnabled`, fail-closed boot koruması ORADA uygulanır).
 * 2. Register-time gizleme: bayrak kapalıyken bu route `app.ts`'de HİÇ register edilmez → `404`,
 *    `403` DEĞİL (kapalı bir modülün/ucun varlığı sızdırılmaz).
 * 3. Runtime ikinci kontrol (defense-in-depth, AŞAĞIDA handler'ın İLK satırı) — biri `app.ts`'deki
 *    koşullu register'ı gelecekte bir refactor'da düşürürse uç YİNE DE kapalı kalır.
 *
 * `STRIPE_SECRET_KEY` bu gating'e DAHİL DEĞİLDİR: Stripe test anahtarı tanımlı ama webhook tüneli
 * olmayan kurulum bu ucun BİRİNCİL kullanım senaryosudur.
 *
 * **Auth — YENİ mekanizma İCAT EDİLMEDİ:** `telehealth.checkout.routes.ts::checkout-session` ile
 * BİREBİR AYNI zincir (`requireModuleEnabled("telehealth")` + `authenticateOptional` +
 * `assertBookingPatientOnlyAccess` + `BOOKING_CHECKOUT_SESSION_RATE_LIMIT`, mevcut sabit YENİDEN
 * KULLANILIR — ayrı bir demo-pay rate limiti TANIMLANMADI, §1.3 "mevcut sabit yeniden kullanılır"
 * ifadesi bağlayıcıdır). Yalnızca booking sahibi HASTA (oturum VEYA `?t=` magic-link, TTL dahil);
 * doktor/`MANAGER`/`ADMIN` bu ucu KULLANAMAZ (`ADMIN`'in zaten kendi `mark-paid` ucu vardır).
 * Yetkisiz erişim `404` (IDOR disiplini, `403` DEĞİL) — `checkout-session` İLE TUTARLI.
 *
 * **İş mantığı — kod tekrarı YASAK:** durum geçişini kendi YAZMAZ; `lib/booking.ts::
 * confirmBookingPayment`'ı DOĞRUDAN çağırır — gerçek Stripe webhook'unun ve ADMIN `mark-paid`'in
 * kullandığı AYNI fonksiyon. `paidBy: "demo"` ZORUNLUDUR (demo ile ödenmiş bir satır DB'de/
 * faturada/denetimde SONSUZA DEK ayırt edilebilir kalır — 1.1'deki istisnanın BEDELİ).
 * `stripePaymentIntentId`/`stripeCheckoutSessionId` ASLA yazılmaz (sahte Stripe kimliği üretmek =
 * sözleşme ihlali) — `confirmBookingPayment`'a bu alanlar hiç GEÇİRİLMEZ, `undefined` kalır.
 *
 * **Denetim:** `logAudit` ÇAĞRILMAZ (aktör anonim misafir olabilir; audit kaydı kimliklendirilmiş
 * aktör bekler). Yerine `app.log.warn` ZORUNLUDUR.
 */
export async function telehealthDemoPaymentRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>();
  server.addHook("preHandler", requireModuleEnabled("telehealth"));
  // §7.2/§9.7.10 — oturum açmış hasta Bearer ile de çağırabilir (misafir `?t=` akışıyla AYNI uç,
  // `checkout-session` İLE BİREBİR AYNI desen).
  server.addHook("preHandler", authenticateOptional);

  server.post(
    "/appointments/bookings/:bookingId/demo-pay",
    {
      config: { rateLimit: BOOKING_CHECKOUT_SESSION_RATE_LIMIT },
      schema: {
        params: BookingIdParamSchema,
        querystring: AccessTokenQuerySchema,
        response: { 200: ApiSuccessSchema(AppointmentBookingSchema) },
      },
    },
    async (request, reply) => {
      // Katman 3 (defense-in-depth, §1.3 madde 3, bağlayıcı) — handler'ın İLK satırı. Register-time
      // gizleme (katman 2, `app.ts`) düşse/refactor edilse BİLE bu uç KAPALI KALIR.
      if (!isDemoPaymentsEnabled) {
        throw new NotFoundError();
      }

      // Katman 4 (2026-09-15, `.claude/security-review-demo-payment-toggle.md` Madde 5) — env
      // kapısı ZATEN AÇIK (yukarıdaki katman 3 geçildi); admin panelden `SiteSettings.
      // demoPaymentsEnabled = false` yapılmışsa `403 DEMO_PAYMENTS_DISABLED` (404 DEĞİL — bu
      // noktada ucun varlığı zaten bilinen bir sır DEĞİL). DB'den **cache'siz, her istekte
      // taze** okunur (çok-instance deploy'larda admin toggle'ı anında tüm instance'lara
      // yansımalıdır) — booking DB'den okunmadan ÖNCE kontrol edilir.
      const settingsRow = await app.prisma.siteSettings.findUnique({ where: { id: SETTINGS_ID } });
      const dbDemoPaymentsEnabled = settingsRow?.demoPaymentsEnabled ?? true;
      if (!computeDemoPaymentsEnabled(dbDemoPaymentsEnabled)) {
        throw new DemoPaymentsDisabledError();
      }

      const booking = await app.prisma.appointmentBooking.findUnique({
        where: { id: request.params.bookingId },
        include: { doctor: { select: { id: true, title: true, fullName: true, slug: true, userId: true } }, appointments: { select: { endsAt: true } } },
      });
      if (!booking) throw new NotFoundError("Rezervasyon bulunamadı.");

      // §9.7.10 uç tablosu (bağlayıcı) — YALNIZCA hasta (`?t=`/oturum); doktor/`MANAGER`/`ADMIN`
      // bu ucu KULLANMAZ (`checkout-session` İLE BİREBİR AYNI eşik).
      assertBookingPatientOnlyAccess(booking, { user: request.user, providedToken: request.query.t });

      if (booking.paymentStatus !== "PENDING") {
        throw new BookingNotPayableError();
      }
      // Süpürücü (`lib/booking-expiry.ts`) 5 dakikada bir çalışır — booking süresi dolmuş ama
      // henüz süpürülmemiş olabilir; bu durumu `PENDING` ile KARIŞTIRMAMAK için AYRI bir kod
      // (`checkout-session` İLE BİREBİR AYNI kontrol).
      if (booking.expiresAt.getTime() < Date.now()) {
        throw new BookingExpiredError();
      }

      // **KRİTİK TASARIM KARARI** (§1.4, bağlayıcı) — Stripe SDK'sı/webhook'u YOK; booking/randevu
      // durum geçişi TEK yerde yaşayan `confirmBookingPayment` üzerinden yapılır. `?t=` varsa AYNEN
      // geçirilir (token rotate EDİLMEZ — hastanın mevcut magic-link'i çalışmaya devam eder,
      // Stripe metadata yolunun AYNISI); oturumlu akışta verilmez, token rotate OLUR — rotate
      // edilen ham token YANITA/LOGA KONULMAZ, yalnızca aşağıdaki e-posta bildirimine gider.
      const { booking: paidBooking, appointments, rawAccessToken } = await confirmBookingPayment(app, {
        bookingId: booking.id,
        paidBy: "demo",
        paidNote: "Geliştirme ortamı demo ödemesi — gerçek tahsilat YAPILMAMIŞTIR.",
        knownRawAccessToken: request.query.t,
      });

      // Denetim yerine `app.log.warn` (§1.4, bağlayıcı) — aktör anonim misafir olabilir, audit
      // kaydı kimliklendirilmiş aktör bekler. Hangi ENV'de/hangi booking için tetiklendiği AÇIKÇA
      // loglanır; ham token/hasta PII'si LOGLANMAZ.
      app.log.warn(
        { bookingId: paidBooking.id, nodeEnv: process.env.NODE_ENV },
        "DEMO PAYMENT — gerçek tahsilat yok (geliştirme ortamı demo ödeme simülatörü kullanıldı)"
      );

      // ADMIN `mark-paid` İLE AYNI — best-effort, e-posta gönderimi BAŞARISIZ olsa da bu uç ASLA
      // 500 dönmez (bkz. notifications.ts::triggerAppointmentConfirmationEmail).
      await triggerAppointmentConfirmationEmail(app, { booking: paidBooking, appointments, rawAccessToken });

      // `.claude/architect-scope-guest-account-otp.md` §5.1/§6 Vektör 2 (bağlayıcı, security-review
      // ONAYLANDI — demo-pay üretimde zaten 404 ile erişilemez) — best-effort, ödeme onayını ASLA bozmaz.
      await provisionPatientAccountForBooking(app, paidBooking);

      const withRelations = await app.prisma.appointmentBooking.findUniqueOrThrow({
        where: { id: paidBooking.id },
        include: {
          doctor: { select: { id: true, title: true, fullName: true, slug: true, userId: true } },
          appointments: { orderBy: { startsAt: "asc" } },
          intake: { select: { id: true } },
          documents: { where: { deletedAt: null }, select: { id: true } },
        },
      });

      // ADMIN `mark-paid` İLE BİREBİR AYNI yanıt şekli — yeni bir DTO İCAT EDİLMEDİ.
      return reply.send(ok(toAppointmentBookingDto(withRelations, canAccessBookingHealthData(withRelations, { user: request.user }))));
    }
  );
}
