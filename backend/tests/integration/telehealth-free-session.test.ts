import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { resetDatabase } from "../helpers/reset-db";
import { buildTestApp } from "../helpers/build-test-app";

/**
 * Admin panelde "Ücretli Hizmet" toggle'ı kapatılan (`sessionPriceCents: null`) doktorlar için
 * booking akışı — `POST /appointments/bookings` ödeme adımını hiç YOKTUR, booking `lib/booking.ts::
 * confirmBookingPayment` (Stripe webhook/demo-pay/ADMIN mark-paid İLE AYNI fonksiyon, kod tekrarı
 * YASAK) üzerinden `paidBy: "free"` ile ANINDA `PAID`e döner (bkz. `telehealth.routes.ts`).
 *
 * AYRI dosya/app örneği — `POST /appointments/bookings`'in 5/dk route-level hız sınırı
 * (`telehealth-demo-payment.test.ts`/`telehealth-bookings.test.ts` İLE AYNI gerekçe).
 */

const sendTemplateEmailMock = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("../../src/modules/email-templates/email-templates.service", () => ({
  sendTemplateEmail: sendTemplateEmailMock,
}));

async function setTelehealthModuleEnabled(app: FastifyInstance, enabled: boolean) {
  await app.prisma.siteModule.upsert({
    where: { key: "telehealth" },
    create: { key: "telehealth", enabled },
    update: { enabled },
  });
}

async function createDoctorWithAvailability(app: FastifyInstance, sessionPriceCents: number | null) {
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

function nextMondayNineAmUtc(): Date {
  const now = new Date();
  const daysUntilMonday = (8 - now.getUTCDay()) % 7 || 7;
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + daysUntilMonday));
  return new Date(Date.UTC(monday.getUTCFullYear(), monday.getUTCMonth(), monday.getUTCDate(), 6, 0, 0));
}

const VALID_TEST_IDENTITY = { citizenshipType: "TR" as const, identityNumber: "10000000146", birthDate: "1990-01-01" };

function bookingPayload(doctorSlug: string, slots: Date[], patientEmail = `hasta-${crypto.randomUUID()}@example.com`) {
  return {
    doctorSlug,
    slots: slots.map((s) => s.toISOString()),
    patientName: "Test Hasta",
    patientEmail,
    identity: VALID_TEST_IDENTITY,
    consent: true,
  };
}

describe("telehealth — ücretsiz doktor (sessionPriceCents: null) booking akışı", () => {
  let app: FastifyInstance;

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

  it("ücretsiz doktor için booking oluşturulunca ANINDA PAID döner, randevular SCHEDULED olur, paidBy='free', onay e-postası gönderilir", async () => {
    const { doctor } = await createDoctorWithAvailability(app, null);
    const startsAt = nextMondayNineAmUtc();

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/appointments/bookings",
      payload: bookingPayload(doctor.slug, [startsAt]),
    });
    expect(res.statusCode).toBe(201);
    const body = res.json().data;
    expect(body.unitPriceCents).toBe(0);
    expect(body.totalCents).toBe(0);
    expect(body.paymentStatus).toBe("PAID");
    expect(body.appointments.every((a: { status: string }) => a.status === "SCHEDULED")).toBe(true);

    const dbBooking = await app.prisma.appointmentBooking.findUniqueOrThrow({ where: { id: body.bookingId } });
    expect(dbBooking.paymentStatus).toBe("PAID");
    expect(dbBooking.paidBy).toBe("free");
    expect(dbBooking.paidAt).not.toBeNull();
    expect(dbBooking.stripePaymentIntentId).toBeNull();

    const dbAppointments = await app.prisma.appointment.findMany({ where: { bookingId: body.bookingId } });
    expect(dbAppointments.every((a) => a.status === "SCHEDULED")).toBe(true);

    expect(sendTemplateEmailMock).toHaveBeenCalledTimes(1);
    const [, purpose, to] = sendTemplateEmailMock.mock.calls[0] as unknown as [unknown, string, string, unknown];
    expect(purpose).toBe("APPOINTMENT_CONFIRMATION");
    expect(to).toBe(dbBooking.patientEmail);

    // Rotate EDİLMEDİ — misafirin booking oluşturma anında aldığı token HÂLÂ ÇALIŞIR.
    const detail = await app.inject({ method: "GET", url: `/api/v1/appointments/bookings/${body.bookingId}?t=${body.accessToken}` });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().data.paymentStatus).toBe("PAID");
  });

  it("ücretli doktor için booking HÂLÂ PENDING döner (regresyon — ücretsiz akış ücretli akışı BOZMAZ)", async () => {
    const { doctor } = await createDoctorWithAvailability(app, 50000);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/appointments/bookings",
      payload: bookingPayload(doctor.slug, [nextMondayNineAmUtc()]),
    });
    expect(res.statusCode).toBe(201);
    const body = res.json().data;
    expect(body.unitPriceCents).toBe(50000);
    expect(body.totalCents).toBe(50000);
    expect(body.paymentStatus).toBe("PENDING");
    expect(body.appointments.every((a: { status: string }) => a.status === "PENDING_PAYMENT")).toBe(true);
    expect(sendTemplateEmailMock).not.toHaveBeenCalled();
  });
});

/**
 * `checkout-session` ucu `STRIPE_SECRET_KEY` YAPILANDIRILMAMIŞKEN her zaman `503
 * PAYMENTS_NOT_CONFIGURED` döner (bkz. yukarıdaki describe'daki varsayılan test env) — ücretsiz
 * bookingin "zaten PAID" 409'unu GERÇEKTEN kanıtlamak için `telehealth-checkout.test.ts` İLE AYNI
 * desen: `STRIPE_SECRET_KEY` + `vi.resetModules()` + dinamik `import("../../src/app")`.
 */
describe("telehealth — ücretsiz booking + checkout-session ucu (Stripe yapılandırılmış, sahte config)", () => {
  let app: FastifyInstance;
  let buildApp: () => FastifyInstance;

  beforeEach(async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_fake_key_for_tests_only";
    vi.resetModules();
    ({ buildApp } = await import("../../src/app"));
    app = buildApp();
    await app.ready();
    await resetDatabase(app.prisma);
    await setTelehealthModuleEnabled(app, true);
  });

  afterEach(async () => {
    sendTemplateEmailMock.mockClear();
    delete process.env.STRIPE_SECRET_KEY;
    await resetDatabase(app.prisma);
    await app.close();
    vi.resetModules();
  });

  it("ücretsiz booking zaten PAID olduğu için checkout-session ucu 409 BOOKING_NOT_PAYABLE döner", async () => {
    const { doctor } = await createDoctorWithAvailability(app, null);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/appointments/bookings",
      payload: bookingPayload(doctor.slug, [nextMondayNineAmUtc()]),
    });
    const body = res.json().data;

    const checkout = await app.inject({
      method: "POST",
      url: `/api/v1/appointments/bookings/${body.bookingId}/checkout-session?t=${body.accessToken}`,
    });
    expect(checkout.statusCode).toBe(409);
    expect(checkout.json().error.code).toBe("BOOKING_NOT_PAYABLE");
  });
});
