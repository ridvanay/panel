import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestApp } from "../helpers/build-test-app";
import { resetDatabase } from "../helpers/reset-db";

/**
 * `.claude/architect-scope-demo-payment-doctor-counters.md` İstek 2 (BAĞLAYICI) —
 * `GET /doctor/overview`'a eklenen `upcomingBookingTotal`/`allBookingTotal` sayaçları.
 * Semantik: sekmeler BOOKING listeler → sayaçlar da BOOKING sayısıdır (`appointmentBooking.count`),
 * randevu sayısı DEĞİL. `GET /doctor/bookings?scope=upcoming`/varsayılan `scope=all` İLE BİREBİR
 * AYNI filtreyi kullanır (`lib/doctor-booking-scope.ts`, kod tekrarı yasak) — bu testler her iki
 * ucun da AYNI sayıyı ÜRETTİĞİNİ doğrular (saf refactor, `/bookings`'in davranışı SIFIR değişir).
 */

function authHeader(token: string) {
  return { authorization: `Bearer ${token}` };
}

async function createUserDirect(app: FastifyInstance, role: "ADMIN" | "MANAGER" | "EDITOR" | "USER") {
  const { hashPassword } = await import("../../src/lib/password");
  const passwordHash = await hashPassword("Sifre12345!");
  return app.prisma.user.create({
    data: {
      email: `overview-counters-user-${crypto.randomUUID()}@example.com`,
      name: "Test Kullanıcı",
      passwordHash,
      role,
      status: "ACTIVE",
      // `.claude/architect-scope-guest-account-otp.md` §2.3 — `login()` artık `emailVerifiedAt`
      // gerektiriyor; bu doğrudan-oluşturma yardımcısı GRANDFATHERED bir hesabı temsil eder.
      emailVerifiedAt: new Date(),
    },
  });
}

async function loginAs(app: FastifyInstance, email: string, password = "Sifre12345!"): Promise<string> {
  const res = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email, password } });
  expect(res.statusCode).toBe(200);
  return res.json().data.tokens.accessToken as string;
}

async function setTelehealthModuleEnabled(app: FastifyInstance, enabled: boolean) {
  await app.prisma.siteModule.upsert({
    where: { key: "telehealth" },
    create: { key: "telehealth", enabled },
    update: { enabled },
  });
}

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

async function makeDoctorSession(app: FastifyInstance, doctorId: string) {
  const doctorUser = await createUserDirect(app, "USER");
  const doctorUserToken = await loginAs(app, doctorUser.email);
  await app.prisma.user.update({ where: { id: doctorUser.id }, data: { twoFactorEnabled: true } });
  await app.prisma.doctorProfile.update({ where: { id: doctorId }, data: { userId: doctorUser.id } });
  return { doctorUser, doctorUserToken };
}

async function createBooking(app: FastifyInstance, doctorSlug: string, slots: Date[]) {
  const res = await app.inject({ method: "POST", url: "/api/v1/appointments/bookings", payload: bookingPayload(doctorSlug, slots) });
  expect(res.statusCode).toBe(201);
  return res.json().data as { bookingId: string; accessToken: string };
}

describe("telehealth — GET /doctor/overview upcomingBookingTotal/allBookingTotal (İstek 2, §2.2/§2.3)", () => {
  let app: FastifyInstance;

  // `AUTH_RATE_LIMIT_MAX` (5/dk, `auth.routes.ts`) — bu describe'daki testler HER BİRİ birden
  // fazla `loginAs` çağrısı yapar; paylaşılan TEK bir app örneği toplamda 5'i AŞARDI. HER test
  // TAZE bir app alır (`telehealth-checkout.test.ts` İLE AYNI, bu depoda YERLEŞİK desen).
  beforeEach(async () => {
    app = await buildTestApp();
    await resetDatabase(app.prisma);
    await setTelehealthModuleEnabled(app, true);
  });

  afterEach(async () => {
    await resetDatabase(app.prisma);
    await app.close();
  });

  it("booking YOKKEN her iki sayaç da 0'dır", async () => {
    const { doctor } = await createDoctorWithAvailability(app);
    const { doctorUserToken } = await makeDoctorSession(app, doctor.id);

    const res = await app.inject({ method: "GET", url: "/api/v1/doctor/overview", headers: authHeader(doctorUserToken) });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.upcomingBookingTotal).toBe(0);
    expect(res.json().data.allBookingTotal).toBe(0);
  });

  it("PENDING_PAYMENT booking `allBookingTotal`'a SAYILIR ama `upcomingBookingTotal`'a SAYILMAZ (ödenmemiş tutma gelecek onaylı randevu DEĞİLDİR)", async () => {
    const { doctor } = await createDoctorWithAvailability(app);
    const { doctorUserToken } = await makeDoctorSession(app, doctor.id);

    await createBooking(app, doctor.slug, [nextMondayNineAmUtc()]);

    const res = await app.inject({ method: "GET", url: "/api/v1/doctor/overview", headers: authHeader(doctorUserToken) });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.allBookingTotal).toBe(1);
    expect(res.json().data.upcomingBookingTotal).toBe(0);
  });

  it("booking PAID olup randevuları SCHEDULED'a geçince `upcomingBookingTotal` 1 artar (booking BAŞINA bir, randevu sayısı DEĞİL)", async () => {
    const { doctor } = await createDoctorWithAvailability(app);
    const { doctorUserToken } = await makeDoctorSession(app, doctor.id);

    const startsAt = nextMondayNineAmUtc();
    const secondSlot = new Date(startsAt.getTime() + 30 * 60 * 1000);
    const booking = await createBooking(app, doctor.slug, [startsAt, secondSlot]);

    // `confirmBookingPayment` İLE AYNI durum geçişini doğrudan simüle eder (bu test, ucun
    // KENDİSİNİ değil, SAYAÇ mantığını doğrular).
    await app.prisma.appointmentBooking.update({ where: { id: booking.bookingId }, data: { paymentStatus: "PAID", paidAt: new Date() } });
    await app.prisma.appointment.updateMany({ where: { bookingId: booking.bookingId }, data: { status: "SCHEDULED" } });

    const res = await app.inject({ method: "GET", url: "/api/v1/doctor/overview", headers: authHeader(doctorUserToken) });
    expect(res.statusCode).toBe(200);
    // 2 randevu satırı olsa dahi TEK booking → sayaç 1 (appointment sayısı DEĞİL).
    expect(res.json().data.upcomingBookingTotal).toBe(1);
    expect(res.json().data.allBookingTotal).toBe(1);

    // `GET /doctor/bookings?scope=upcoming` İLE BİREBİR AYNI sayı (paylaşılan filtre kaynağı).
    const bookingsRes = await app.inject({
      method: "GET",
      url: "/api/v1/doctor/bookings?scope=upcoming",
      headers: authHeader(doctorUserToken),
    });
    expect(bookingsRes.statusCode).toBe(200);
    expect(bookingsRes.json().data.length).toBe(res.json().data.upcomingBookingTotal);
  });

  it("'hayalet' booking (appointmentsiz, EXPIRED) `allBookingTotal`'a SAYILMAZ (booking-expiry süpürücüsü sonrası kalan satır)", async () => {
    const { doctor } = await createDoctorWithAvailability(app);
    const { doctorUserToken } = await makeDoctorSession(app, doctor.id);

    const booking = await createBooking(app, doctor.slug, [nextMondayNineAmUtc()]);
    // `booking-expiry.ts::runBookingExpirySweep` İLE AYNI SONUÇ — appointment'lar HARD DELETE,
    // booking `EXPIRED` olarak KALIR.
    await app.prisma.appointment.deleteMany({ where: { bookingId: booking.bookingId } });
    await app.prisma.appointmentBooking.update({ where: { id: booking.bookingId }, data: { paymentStatus: "EXPIRED" } });

    const res = await app.inject({ method: "GET", url: "/api/v1/doctor/overview", headers: authHeader(doctorUserToken) });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.allBookingTotal).toBe(0);
    expect(res.json().data.upcomingBookingTotal).toBe(0);

    // `GET /doctor/bookings` (varsayılan `scope=all`) İLE BİREBİR AYNI davranış — hayalet satır YOK SAYILIR.
    const bookingsRes = await app.inject({ method: "GET", url: "/api/v1/doctor/bookings", headers: authHeader(doctorUserToken) });
    expect(bookingsRes.statusCode).toBe(200);
    expect(bookingsRes.json().data.length).toBe(0);
  });

  it("`doctorId` sorgu parametresi YOKTUR — yalnızca oturumun KENDİ DoctorProfile'ı sayılır (IDOR)", async () => {
    const { doctor: doctorA } = await createDoctorWithAvailability(app);
    const { doctor: doctorB } = await createDoctorWithAvailability(app);
    const { doctorUserToken: tokenA } = await makeDoctorSession(app, doctorA.id);
    await makeDoctorSession(app, doctorB.id);

    const bookingB = await createBooking(app, doctorB.slug, [nextMondayNineAmUtc()]);
    await app.prisma.appointmentBooking.update({ where: { id: bookingB.bookingId }, data: { paymentStatus: "PAID", paidAt: new Date() } });
    await app.prisma.appointment.updateMany({ where: { bookingId: bookingB.bookingId }, data: { status: "SCHEDULED" } });

    // doctorA'nın overview'i doctorB'nin booking'ini SAYMAMALI.
    const res = await app.inject({ method: "GET", url: "/api/v1/doctor/overview", headers: authHeader(tokenA) });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.upcomingBookingTotal).toBe(0);
    expect(res.json().data.allBookingTotal).toBe(0);
  });
});
