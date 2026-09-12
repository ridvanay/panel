import crypto from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { resetDatabase } from "../helpers/reset-db";
import { buildTestApp } from "../helpers/build-test-app";
import { registerTestUser } from "../helpers/auth";

/**
 * `.claude/architect-scope-telehealth-template.md` §9.7.1 KARAR G / §9.7.9 / §9.7.10 —
 * integration-agent'ın TEK SAHASI: `POST /appointments/bookings/{bookingId}/checkout-session`.
 *
 * `../../src/lib/stripe` TAMAMEN mock'lanır (`tests/integration/checkout.test.ts` İLE AYNI
 * yaklaşım — `stripe.checkout.sessions.create` gerçek bir ağ çağrısıdır, test ortamında sahte
 * `STRIPE_SECRET_KEY` ile gerçek Stripe API'sine ASLA ulaşılmamalı). `STRIPE_SECRET_KEY`
 * `.env.test`'te TANIMSIZDIR (bu bilinçlidir — `PAYMENTS_NOT_CONFIGURED` testi VARSAYILAN test
 * app'iyle çalışır); "yapılandırılmışken" davranışı test etmek için `process.env.STRIPE_SECRET_KEY`
 * + `vi.resetModules()` + dinamik `import("../../src/app")` kullanılır
 * (`tests/integration/telehealth-livekit.test.ts::LIVEKIT_*` İLE AYNI, bu depoda YERLEŞİK desen).
 */

const stripeSessionsCreateMock = vi.hoisted(() => vi.fn());
const stripeSessionsRetrieveMock = vi.hoisted(() => vi.fn());

vi.mock("../../src/lib/stripe", () => ({
  stripe: {
    checkout: {
      sessions: {
        create: stripeSessionsCreateMock,
        retrieve: stripeSessionsRetrieveMock,
      },
    },
  },
}));

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
  return res.json().data as { bookingId: string; accessToken: string; totalCents: number; slotCount: number; currency: string };
}

describe("telehealth checkout — Stripe YAPILANDIRILMAMIŞKEN (§9.7.1 madde 6, varsayılan test env)", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
    await resetDatabase(app.prisma);
    await setTelehealthModuleEnabled(app, true);
  });

  afterAll(async () => {
    await resetDatabase(app.prisma);
    await app.close();
  });

  it("§9.7.1 madde 6 — 503 PAYMENTS_NOT_CONFIGURED döner (booking var olsa dahi, Stripe'a HİÇ dokunulmaz)", async () => {
    const { doctor } = await createDoctorWithAvailability(app);
    const booking = await createBooking(app, doctor.slug, [nextMondayNineAmUtc()]);

    const res = await app.inject({
      method: "POST",
      url: `/api/v1/appointments/bookings/${booking.bookingId}/checkout-session?t=${booking.accessToken}`,
    });
    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe("PAYMENTS_NOT_CONFIGURED");
    expect(stripeSessionsCreateMock).not.toHaveBeenCalled();
  });

  it("modül KAPALIYKEN 404 döner (yapılandırma kontrolünden ÖNCE)", async () => {
    await setTelehealthModuleEnabled(app, false);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/appointments/bookings/00000000-0000-0000-0000-000000000000/checkout-session",
    });
    expect(res.statusCode).toBe(404);
    await setTelehealthModuleEnabled(app, true);
  });
});

describe("telehealth checkout — Stripe YAPILANDIRILMIŞKEN (sahte config)", () => {
  let app: FastifyInstance;
  let buildApp: () => FastifyInstance;

  beforeAll(async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_fake_key_for_tests_only";
    vi.resetModules();
    ({ buildApp } = await import("../../src/app"));
  });

  // `POST /appointments/bookings`'in 5/dk route-level hız sınırı (bkz. `telehealth-bookings.test.ts`
  // üstündeki AYNI gerekçe) — bu describe'daki BİRÇOK test booking oluşturur; paylaşılan TEK bir
  // app örneği toplam çağrı sayısını 5'i AŞARDI. HER test TAZE bir app alır (`buildApp` fabrikası
  // BİR KEZ, `STRIPE_SECRET_KEY` set edilip `resetModules()` çağrıldıktan SONRA elde edilir —
  // her `buildApp()` çağrısı AYNI (zaten yapılandırılmış) modül grafiğinden YENİ bir Fastify
  // örneği üretir, `env` yeniden PARSE edilmez).
  beforeEach(async () => {
    app = buildApp();
    await app.ready();
    await resetDatabase(app.prisma);
    await setTelehealthModuleEnabled(app, true);
  });

  afterEach(async () => {
    stripeSessionsCreateMock.mockReset();
    stripeSessionsRetrieveMock.mockReset();
    await resetDatabase(app.prisma);
    await app.close();
  });

  afterAll(() => {
    delete process.env.STRIPE_SECRET_KEY;
    vi.resetModules();
  });

  it("misafir (?t=) hasta için Checkout oturumu oluşturur; totalCents/slotCount Stripe'a doğru taşınır; bookingId/rawAccessToken metadata'da", async () => {
    const { doctor } = await createDoctorWithAvailability(app, 75000);
    const startsAt = nextMondayNineAmUtc();
    const secondSlot = new Date(startsAt.getTime() + 30 * 60 * 1000);
    const booking = await createBooking(app, doctor.slug, [startsAt, secondSlot]);

    stripeSessionsCreateMock.mockResolvedValue({
      id: "cs_test_booking_1",
      url: "https://checkout.stripe.test/cs_test_booking_1",
    });

    const res = await app.inject({
      method: "POST",
      url: `/api/v1/appointments/bookings/${booking.bookingId}/checkout-session?t=${booking.accessToken}`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.checkoutUrl).toBe("https://checkout.stripe.test/cs_test_booking_1");
    expect(res.json().data.sessionId).toBe("cs_test_booking_1");

    expect(stripeSessionsCreateMock).toHaveBeenCalledTimes(1);
    const callArgs = stripeSessionsCreateMock.mock.calls[0]![0];
    expect(callArgs.mode).toBe("payment");
    expect(callArgs.metadata).toMatchObject({
      kind: "telehealth_booking",
      bookingId: booking.bookingId,
      rawAccessToken: booking.accessToken,
    });
    expect(callArgs.payment_intent_data.metadata).toMatchObject({ bookingId: booking.bookingId });
    expect(callArgs.line_items[0].price_data.unit_amount).toBe(75000);
    expect(callArgs.line_items[0].quantity).toBe(2);
    // §9.7.5 madde 8 disiplini — uzmanlık/doktor adı Stripe'a giden satır adına YAZILMAZ.
    expect(callArgs.line_items[0].price_data.product_data.name).not.toContain(doctor.fullName);

    const updatedBooking = await app.prisma.appointmentBooking.findUniqueOrThrow({ where: { id: booking.bookingId } });
    expect(updatedBooking.stripeCheckoutSessionId).toBe("cs_test_booking_1");
  });

  it("aynı booking için tekrar çağrılırsa (oturum hâlâ 'open') Stripe'a YENİDEN oturum AÇILMAZ — mevcudu döner (idempotent)", async () => {
    const { doctor } = await createDoctorWithAvailability(app);
    const booking = await createBooking(app, doctor.slug, [nextMondayNineAmUtc()]);

    stripeSessionsCreateMock.mockResolvedValue({ id: "cs_test_idem", url: "https://checkout.stripe.test/cs_test_idem" });
    const first = await app.inject({
      method: "POST",
      url: `/api/v1/appointments/bookings/${booking.bookingId}/checkout-session?t=${booking.accessToken}`,
    });
    expect(first.statusCode).toBe(200);

    stripeSessionsRetrieveMock.mockResolvedValue({
      id: "cs_test_idem",
      url: "https://checkout.stripe.test/cs_test_idem",
      status: "open",
      expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
    });

    const second = await app.inject({
      method: "POST",
      url: `/api/v1/appointments/bookings/${booking.bookingId}/checkout-session?t=${booking.accessToken}`,
    });
    expect(second.statusCode).toBe(200);
    expect(second.json().data.sessionId).toBe("cs_test_idem");

    expect(stripeSessionsCreateMock).toHaveBeenCalledTimes(1); // ikinci çağrıda YENİ oturum AÇILMADI.
    expect(stripeSessionsRetrieveMock).toHaveBeenCalledTimes(1);
  });

  it("yanlış/eksik `?t=` ile 404 döner (varlık sızdırılmaz)", async () => {
    const { doctor } = await createDoctorWithAvailability(app);
    const booking = await createBooking(app, doctor.slug, [nextMondayNineAmUtc()]);

    const noToken = await app.inject({ method: "POST", url: `/api/v1/appointments/bookings/${booking.bookingId}/checkout-session` });
    expect(noToken.statusCode).toBe(404);

    const wrongToken = await app.inject({
      method: "POST",
      url: `/api/v1/appointments/bookings/${booking.bookingId}/checkout-session?t=yanlis-token`,
    });
    expect(wrongToken.statusCode).toBe(404);
  });

  it("oturum açmış hasta (Bearer, `?t=` OLMADAN) da kullanabilir — Stripe metadata'sında bu durumda `rawAccessToken` YOKTUR", async () => {
    const patient = await registerTestUser(app, { email: `telehealth-checkout-patient-${crypto.randomUUID()}@example.com` });
    const { doctor } = await createDoctorWithAvailability(app);

    const createRes = await app.inject({
      method: "POST",
      url: "/api/v1/appointments/bookings",
      headers: { authorization: `Bearer ${patient.accessToken}` },
      payload: {
        doctorSlug: doctor.slug,
        slots: [nextMondayNineAmUtc().toISOString()],
        patientName: "Test Hasta",
        patientEmail: patient.email,
        consent: true,
      },
    });
    expect(createRes.statusCode).toBe(201);
    const bookingId = createRes.json().data.bookingId as string;

    stripeSessionsCreateMock.mockResolvedValue({ id: "cs_test_session_patient", url: "https://checkout.stripe.test/cs_test_session_patient" });

    const res = await app.inject({
      method: "POST",
      url: `/api/v1/appointments/bookings/${bookingId}/checkout-session`,
      headers: { authorization: `Bearer ${patient.accessToken}` },
    });
    expect(res.statusCode).toBe(200);

    const callArgs = stripeSessionsCreateMock.mock.calls[0]![0];
    expect(callArgs.metadata.bookingId).toBe(bookingId);
    expect(callArgs.metadata.rawAccessToken).toBeUndefined();
  });

  it("ADMIN bu ucu KULLANAMAZ (yalnızca hasta — manuel akış için ayrı mark-paid ucu vardır)", async () => {
    const admin = await registerTestUser(app, { email: `telehealth-checkout-admin-${crypto.randomUUID()}@example.com` });
    await app.prisma.user.update({ where: { id: admin.userId }, data: { role: "ADMIN" } });
    const { doctor } = await createDoctorWithAvailability(app);
    const booking = await createBooking(app, doctor.slug, [nextMondayNineAmUtc()]);

    const res = await app.inject({
      method: "POST",
      url: `/api/v1/appointments/bookings/${booking.bookingId}/checkout-session`,
      headers: { authorization: `Bearer ${admin.accessToken}` },
    });
    expect(res.statusCode).toBe(404);
    expect(stripeSessionsCreateMock).not.toHaveBeenCalled();
  });

  it("booking zaten PAID ise 409 BOOKING_NOT_PAYABLE döner", async () => {
    const admin = await registerTestUser(app, { email: `telehealth-checkout-paid-admin-${crypto.randomUUID()}@example.com` });
    await app.prisma.user.update({ where: { id: admin.userId }, data: { role: "ADMIN" } });
    const patient = await registerTestUser(app, { email: `telehealth-checkout-paid-patient-${crypto.randomUUID()}@example.com` });
    const { doctor } = await createDoctorWithAvailability(app);

    // Oturumlu (Bearer) hasta olarak booking oluşturulur — `POST /admin/.../mark-paid`
    // `knownRawAccessToken` GEÇİRMEDİĞİ için booking'in `accessTokenHash`'ini ROTATE EDER
    // (bkz. `lib/booking.ts::confirmBookingPayment` yorumu); guest `?t=` token'ı bu senaryoda
    // STALE olurdu — bu yüzden `patientUserId` eşleşmesiyle (oturum) erişim doğrulanır.
    const createRes = await app.inject({
      method: "POST",
      url: "/api/v1/appointments/bookings",
      headers: { authorization: `Bearer ${patient.accessToken}` },
      payload: {
        doctorSlug: doctor.slug,
        slots: [nextMondayNineAmUtc().toISOString()],
        patientName: "Test Hasta",
        patientEmail: patient.email,
        consent: true,
      },
    });
    expect(createRes.statusCode).toBe(201);
    const bookingId = createRes.json().data.bookingId as string;

    const markPaid = await app.inject({
      method: "POST",
      url: `/api/v1/admin/telehealth/bookings/${bookingId}/mark-paid`,
      headers: { authorization: `Bearer ${admin.accessToken}` },
      payload: { reason: "Test — ofis içi ödeme simülasyonu" },
    });
    expect(markPaid.statusCode).toBe(200);

    const res = await app.inject({
      method: "POST",
      url: `/api/v1/appointments/bookings/${bookingId}/checkout-session`,
      headers: { authorization: `Bearer ${patient.accessToken}` },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("BOOKING_NOT_PAYABLE");
    expect(stripeSessionsCreateMock).not.toHaveBeenCalled();
  });

  it("booking'in slot tutma süresi (`expiresAt`) dolmuşsa 409 BOOKING_EXPIRED döner (süpürücü henüz çalışmamış olsa dahi)", async () => {
    const { doctor } = await createDoctorWithAvailability(app);
    const booking = await createBooking(app, doctor.slug, [nextMondayNineAmUtc()]);

    // Süpürücüyü BEKLEMEDEN doğrudan geçmişe çek — bu uç `paymentStatus` ZATEN `PENDING`
    // olsa da `expiresAt < now` ise AYRI bir kodla (`BOOKING_EXPIRED`) reddetmelidir.
    await app.prisma.appointmentBooking.update({
      where: { id: booking.bookingId },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });

    const res = await app.inject({
      method: "POST",
      url: `/api/v1/appointments/bookings/${booking.bookingId}/checkout-session?t=${booking.accessToken}`,
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("BOOKING_EXPIRED");
    expect(stripeSessionsCreateMock).not.toHaveBeenCalled();
  });
});
