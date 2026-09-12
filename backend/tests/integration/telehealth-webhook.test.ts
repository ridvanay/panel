import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";

/**
 * `.claude/architect-scope-telehealth-template.md` §9.7.1 KARAR G (bağlayıcı) —
 * `POST /webhooks/stripe`'ın telehealth booking dalı (`handleTelehealthBookingPaid`/
 * `handleTelehealthPaymentFailed`, integration-agent'ın sahası). `webhook-order.test.ts` İLE
 * AYNI desen: `../../src/lib/stripe` BİLEREK mock'LANMAZ (`constructEvent`/
 * `generateTestHeaderString` saf yerel HMAC işlemleridir, ağ çağrısı YAPMAZ) — gerçek imza
 * doğrulama kod yolu uçtan uca test edilir. `sendTemplateEmail` mock'lanır (notification-agent'ın
 * şablon/tetikleyici içeriğine BAĞIMLI OLMAMAK için — bu dosyanın odağı booking/randevu durum
 * geçişi + idempotency + accessToken rotasyon KARARIdır, e-posta İÇERİĞİ DEĞİL).
 */
const sendTemplateEmailMock = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("../../src/modules/email-templates/email-templates.service", () => ({
  sendTemplateEmail: sendTemplateEmailMock,
}));

import { buildTestApp } from "../helpers/build-test-app";
import { resetDatabase } from "../helpers/reset-db";
import { stripe } from "../../src/lib/stripe";
import { env } from "../../src/config/env";
import { hashToken } from "../../src/lib/tokens";

async function setTelehealthModuleEnabled(app: FastifyInstance, enabled: boolean) {
  await app.prisma.siteModule.upsert({
    where: { key: "telehealth" },
    create: { key: "telehealth", enabled },
    update: { enabled },
  });
}

/** Europe/Istanbul, Pazartesi 09:00-17:00, 30dk seans — her çağrıda YENİ bir doktor/uzmanlık. */
async function createDoctorWithAvailability(app: FastifyInstance, sessionPriceCents = 50000) {
  const specialty = await app.prisma.specialty.create({
    data: { name: `Kardiyoloji ${crypto.randomUUID()}`, slug: `kardiyoloji-${crypto.randomUUID()}`, icon: "heart-pulse" },
  });
  const doctor = await app.prisma.doctorProfile.create({
    data: {
      title: "Dr.",
      fullName: `Test Doktor ${crypto.randomUUID()}`,
      slug: `test-doktor-${crypto.randomUUID()}`,
      bio: "Test amaçlı doktor profili.",
      languages: ["tr"],
      timeZone: "Europe/Istanbul",
      specialtyId: specialty.id,
      sessionDurationMin: 30,
      sessionPriceCents,
      currency: "TRY",
      isActive: true,
    },
  });
  await app.prisma.doctorAvailability.create({
    data: { doctorId: doctor.id, dayOfWeek: 1, startMinute: 540, endMinute: 1020, isActive: true },
  });
  return { doctor, specialty };
}

/** Bugünden itibaren GELECEKTEKİ ilk Pazartesi'nin 09:00 Europe/Istanbul (= 06:00 UTC) anı. */
function nextMondayNineAmUtc(): Date {
  const now = new Date();
  const daysUntilMonday = (8 - now.getUTCDay()) % 7 || 7;
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + daysUntilMonday));
  return new Date(Date.UTC(monday.getUTCFullYear(), monday.getUTCMonth(), monday.getUTCDate(), 6, 0, 0));
}

async function createBooking(app: FastifyInstance, doctorSlug: string, slots: Date[], patientEmail = `hasta-${crypto.randomUUID()}@example.com`) {
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/appointments/bookings",
    payload: { doctorSlug, slots: slots.map((s) => s.toISOString()), patientName: "Test Hasta", patientEmail, consent: true },
  });
  expect(res.statusCode).toBe(201);
  return res.json().data as { bookingId: string; accessToken: string; totalCents: number; slotCount: number };
}

function buildCheckoutSessionEvent(
  metadata: Record<string, string>,
  opts: { paymentIntentId?: string; mode?: "payment" | "subscription" } = {}
) {
  return {
    id: `evt_${crypto.randomUUID()}`,
    object: "event",
    api_version: "2024-06-20",
    created: Math.floor(Date.now() / 1000),
    type: "checkout.session.completed",
    data: {
      object: {
        id: `cs_test_${crypto.randomUUID()}`,
        object: "checkout.session",
        mode: opts.mode ?? "payment",
        payment_intent: opts.paymentIntentId ?? `pi_test_${crypto.randomUUID()}`,
        metadata,
      },
    },
  };
}

function buildPaymentFailedEvent(bookingId: string, message = "Your card was declined.") {
  return {
    id: `evt_${crypto.randomUUID()}`,
    object: "event",
    api_version: "2024-06-20",
    created: Math.floor(Date.now() / 1000),
    type: "payment_intent.payment_failed",
    data: {
      object: {
        id: `pi_test_${crypto.randomUUID()}`,
        object: "payment_intent",
        metadata: { bookingId },
        last_payment_error: { message },
      },
    },
  };
}

describe("webhooks/stripe — telehealth booking ödeme akışı ([TCT] §9.7.1 KARAR G, KRİTİK)", () => {
  let app: FastifyInstance;

  async function postWebhook(eventBody: unknown, opts: { signed?: boolean } = { signed: true }) {
    const payloadString = JSON.stringify(eventBody);
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (opts.signed !== false) {
      headers["stripe-signature"] = stripe.webhooks.generateTestHeaderString({
        payload: payloadString,
        secret: env.STRIPE_WEBHOOK_SECRET,
      });
    }
    return app.inject({ method: "POST", url: "/api/v1/webhooks/stripe", headers, payload: payloadString });
  }

  // `POST /appointments/bookings`'in 5/dk route-level hız sınırı (bkz. `telehealth-bookings.test.ts`
  // üstündeki AYNI gerekçe) — bu describe'daki HER `it` en az bir booking oluşturur; paylaşılan TEK
  // bir app örneği toplam çağrı sayısını 5'i AŞARDI. `beforeEach` ile HER test TAZE bir app alır
  // (rate-limit sayacı da fastify-rate-limit'in kendi in-memory store'u İLE BİRLİKTE sıfırlanır).
  beforeEach(async () => {
    app = await buildTestApp();
    await resetDatabase(app.prisma);
    await setTelehealthModuleEnabled(app, true);
  });

  afterEach(async () => {
    sendTemplateEmailMock.mockClear();
    await resetDatabase(app.prisma);
    await app.close();
  });

  it("`checkout.session.completed` (metadata.bookingId, rawAccessToken YOK) → booking PAID, randevular SCHEDULED, accessToken ROTATE EDİLİR (ADMIN mark-paid İLE AYNI ilke)", async () => {
    const { doctor } = await createDoctorWithAvailability(app, 75000);
    const startsAt = nextMondayNineAmUtc();
    const secondSlot = new Date(startsAt.getTime() + 30 * 60 * 1000);
    const booking = await createBooking(app, doctor.slug, [startsAt, secondSlot]);
    const originalTokenHash = hashToken(booking.accessToken);

    const res = await postWebhook(buildCheckoutSessionEvent({ kind: "telehealth_booking", bookingId: booking.bookingId }));
    expect(res.statusCode).toBe(200);

    const updatedBooking = await app.prisma.appointmentBooking.findUniqueOrThrow({ where: { id: booking.bookingId } });
    expect(updatedBooking.paymentStatus).toBe("PAID");
    expect(updatedBooking.paidAt).not.toBeNull();
    expect(updatedBooking.paidBy).toBe("stripe");
    expect(updatedBooking.accessTokenHash).not.toBe(originalTokenHash); // ROTATE EDİLDİ.

    const appointments = await app.prisma.appointment.findMany({ where: { bookingId: booking.bookingId } });
    expect(appointments.every((a) => a.status === "SCHEDULED")).toBe(true);

    // Orijinal magic-link ARTIK ÇALIŞMAZ (rotate edildiği için) — booking bulunamadı (404).
    const staleAccess = await app.inject({ method: "GET", url: `/api/v1/appointments/bookings/${booking.bookingId}?t=${booking.accessToken}` });
    expect(staleAccess.statusCode).toBe(404);

    expect(sendTemplateEmailMock).toHaveBeenCalledTimes(1);
    const [, purpose, to] = sendTemplateEmailMock.mock.calls[0] as unknown as [unknown, string, string, unknown];
    expect(purpose).toBe("APPOINTMENT_CONFIRMATION");
    expect(to).toBe(updatedBooking.patientEmail);
  });

  it("**KRİTİK TASARIM KARARI** — `metadata.rawAccessToken` VARSA (checkout-session ucunun misafir `?t=` akışı) accessToken ROTATE EDİLMEZ; hastanın orijinal magic-link'i ödeme SONRASI da ÇALIŞIR", async () => {
    const { doctor } = await createDoctorWithAvailability(app);
    const booking = await createBooking(app, doctor.slug, [nextMondayNineAmUtc()]);
    const originalTokenHash = hashToken(booking.accessToken);

    const res = await postWebhook(
      buildCheckoutSessionEvent({ kind: "telehealth_booking", bookingId: booking.bookingId, rawAccessToken: booking.accessToken })
    );
    expect(res.statusCode).toBe(200);

    const updatedBooking = await app.prisma.appointmentBooking.findUniqueOrThrow({ where: { id: booking.bookingId } });
    expect(updatedBooking.paymentStatus).toBe("PAID");
    expect(updatedBooking.accessTokenHash).toBe(originalTokenHash); // ROTATE EDİLMEDİ — AYNI hash.

    // Orijinal magic-link ödeme SONRASI da ÇALIŞIR.
    const stillWorks = await app.inject({ method: "GET", url: `/api/v1/appointments/bookings/${booking.bookingId}?t=${booking.accessToken}` });
    expect(stillWorks.statusCode).toBe(200);
    expect(stillWorks.json().data.paymentStatus).toBe("PAID");

    expect(sendTemplateEmailMock).toHaveBeenCalledTimes(1);
    const [, , , values] = sendTemplateEmailMock.mock.calls[0] as unknown as [unknown, unknown, unknown, { magic_link: string }];
    expect(new URL(values.magic_link).searchParams.get("t")).toBe(booking.accessToken);
  });

  it("İDEMPOTENCY — AYNI event 2 kez gönderilirse randevular yalnızca 1 kez SCHEDULED'a geçer, e-posta yalnızca 1 kez gider", async () => {
    const { doctor } = await createDoctorWithAvailability(app);
    const booking = await createBooking(app, doctor.slug, [nextMondayNineAmUtc()]);
    const event = buildCheckoutSessionEvent({ kind: "telehealth_booking", bookingId: booking.bookingId });

    const first = await postWebhook(event);
    expect(first.statusCode).toBe(200);
    const second = await postWebhook(event);
    expect(second.statusCode).toBe(200); // idempotent no-op — HATA FIRLATMAZ, yine de 200.

    const updatedBooking = await app.prisma.appointmentBooking.findUniqueOrThrow({ where: { id: booking.bookingId } });
    expect(updatedBooking.paymentStatus).toBe("PAID");

    expect(sendTemplateEmailMock).toHaveBeenCalledTimes(1);
  });

  it("`Order`/`OrderItem` akışı REGRESYONA UĞRAMADI — `metadata.bookingId` YOKSA hâlâ `handleOrderPaid`'e gider", async () => {
    const product = await app.prisma.product.create({
      data: {
        title: `Webhook Regresyon Ürünü ${crypto.randomUUID()}`,
        slug: `webhook-regresyon-urun-${crypto.randomUUID()}`,
        priceCents: 10000,
        currency: "TRY",
        stockQuantity: 5,
        status: "PUBLISHED",
        publishedAt: new Date(),
      },
    });
    const order = await app.prisma.order.create({
      data: {
        orderNumber: `ORD-TEST-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
        customerEmail: `buyer-${crypto.randomUUID()}@example.com`,
        customerName: "Test Müşteri",
        status: "PENDING",
        currency: "TRY",
        subtotalCents: 10000,
        discountCents: 0,
        taxCents: 0,
        totalCents: 10000,
        items: {
          create: [{ productId: product.id, productTitle: product.title, productSku: product.sku, unitPriceCents: 10000, quantity: 1, lineTotalCents: 10000 }],
        },
      },
    });

    const res = await postWebhook(buildCheckoutSessionEvent({ kind: "order", orderId: order.id }));
    expect(res.statusCode).toBe(200);

    const updatedOrder = await app.prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(updatedOrder.status).toBe("PAID");
  });

  it("`payment_intent.payment_failed` → booking `paymentStatus = FAILED` + `errorSummary`; randevu satırları/paymentStatus PENDING'DEN ETKİLENMEZ (silinmez)", async () => {
    const { doctor } = await createDoctorWithAvailability(app);
    const booking = await createBooking(app, doctor.slug, [nextMondayNineAmUtc()]);

    const res = await postWebhook(buildPaymentFailedEvent(booking.bookingId, "Kartınız reddedildi."));
    expect(res.statusCode).toBe(200);

    const updatedBooking = await app.prisma.appointmentBooking.findUniqueOrThrow({ where: { id: booking.bookingId } });
    expect(updatedBooking.paymentStatus).toBe("FAILED");
    expect(updatedBooking.errorSummary).toBe("Kartınız reddedildi.");

    const appointments = await app.prisma.appointment.findMany({ where: { bookingId: booking.bookingId } });
    expect(appointments.every((a) => a.status === "PENDING_PAYMENT")).toBe(true); // SİLİNMEDİ, dokunulmadı.

    expect(sendTemplateEmailMock).not.toHaveBeenCalled();
  });

  it("`payment_intent.payment_failed` booking ZATEN PAID iken gelirse HİÇBİR ŞEYİ DEĞİŞTİRMEZ (idempotent-güvenli)", async () => {
    const { doctor } = await createDoctorWithAvailability(app);
    const booking = await createBooking(app, doctor.slug, [nextMondayNineAmUtc()]);
    await postWebhook(buildCheckoutSessionEvent({ kind: "telehealth_booking", bookingId: booking.bookingId }));

    const res = await postWebhook(buildPaymentFailedEvent(booking.bookingId));
    expect(res.statusCode).toBe(200);

    const updatedBooking = await app.prisma.appointmentBooking.findUniqueOrThrow({ where: { id: booking.bookingId } });
    expect(updatedBooking.paymentStatus).toBe("PAID"); // FAILED'A DÖNMEDİ.
  });

  it("imzasız istek 400 döner (booking ödeme dalı da imza doğrulamasının ARKASINDADIR)", async () => {
    const { doctor } = await createDoctorWithAvailability(app);
    const booking = await createBooking(app, doctor.slug, [nextMondayNineAmUtc()]);

    const res = await postWebhook(buildCheckoutSessionEvent({ kind: "telehealth_booking", bookingId: booking.bookingId }), { signed: false });
    expect(res.statusCode).toBe(400);

    const updatedBooking = await app.prisma.appointmentBooking.findUniqueOrThrow({ where: { id: booking.bookingId } });
    expect(updatedBooking.paymentStatus).toBe("PENDING"); // İşlenmedi.
  });
});
