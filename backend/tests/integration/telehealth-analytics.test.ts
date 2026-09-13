import crypto from "node:crypto";
import type { AppointmentStatus, BookingPaymentStatus } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestApp } from "../helpers/build-test-app";
import { resetDatabase } from "../helpers/reset-db";

/**
 * [TCT] §9.7.7 KARAR K10a — `GET /admin/telehealth/analytics/overview`. Randevu/booking satırları
 * gerçek booking akışı (`POST /appointments/bookings`) yerine DOĞRUDAN Prisma ile, kontrollü
 * `startsAt`/`status`/`currency`/`createdAt` değerleriyle üretilir — analitik toplulaştırmanın
 * DOĞRU aralığı/bucket'ı seçtiğini DETERMİNİSTİK olarak doğrulamak için (booking akışı `startsAt`'i
 * gelecekteki bir Pazartesi'ye kilitler, bu test GEÇMİŞ sabit bir tarih aralığı kullanır).
 */

function authHeader(token: string) {
  return { authorization: `Bearer ${token}` };
}

async function createUserDirect(app: FastifyInstance, role: "ADMIN" | "MANAGER" | "EDITOR" | "CUSTOMER") {
  const { hashPassword } = await import("../../src/lib/password");
  const passwordHash = await hashPassword("Sifre12345!");
  return app.prisma.user.create({
    data: {
      email: `telehealth-analytics-${role.toLowerCase()}-${crypto.randomUUID()}@example.com`,
      name: `Test ${role}`,
      passwordHash,
      role,
      status: "ACTIVE",
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

async function createDoctor(app: FastifyInstance, currency = "TRY") {
  const specialty = await app.prisma.specialty.create({
    data: { name: `Analitik Uzmanlık ${crypto.randomUUID()}`, slug: `analitik-uzmanlik-${crypto.randomUUID()}`, icon: "heart-pulse" },
  });
  return app.prisma.doctorProfile.create({
    data: {
      title: "Dr.",
      fullName: `Analitik Doktor ${crypto.randomUUID()}`,
      slug: `analitik-doktor-${crypto.randomUUID()}`,
      bio: "Analitik regresyon testi için oluşturulmuş doktor profili.",
      languages: ["tr"],
      timeZone: "Europe/Istanbul",
      specialtyId: specialty.id,
      sessionDurationMin: 30,
      sessionPriceCents: 50000,
      currency,
      isActive: true,
    },
  });
}

async function createAppointmentDirect(
  app: FastifyInstance,
  opts: { doctorId: string; status: AppointmentStatus; priceCents: number; currency?: string; startsAt: Date }
) {
  return app.prisma.appointment.create({
    data: {
      doctorId: opts.doctorId,
      patientName: "Test Hasta",
      patientEmail: `hasta-${crypto.randomUUID()}@example.com`,
      startsAt: opts.startsAt,
      endsAt: new Date(opts.startsAt.getTime() + 30 * 60 * 1000),
      status: opts.status,
      priceCents: opts.priceCents,
      currency: opts.currency ?? "TRY",
      meetingRoomName: `room_${crypto.randomUUID()}`,
      accessTokenHash: crypto.randomUUID(),
    },
  });
}

async function createBookingDirect(
  app: FastifyInstance,
  opts: { doctorId: string; paymentStatus: BookingPaymentStatus; createdAt: Date; currency?: string }
) {
  return app.prisma.appointmentBooking.create({
    data: {
      bookingNumber: `BK-${crypto.randomUUID()}`,
      doctorId: opts.doctorId,
      patientName: "Test Hasta",
      patientEmail: `hasta-${crypto.randomUUID()}@example.com`,
      slotCount: 1,
      unitPriceCents: 50000,
      subtotalCents: 50000,
      totalCents: 50000,
      currency: opts.currency ?? "TRY",
      paymentStatus: opts.paymentStatus,
      expiresAt: new Date(opts.createdAt.getTime() + 30 * 60 * 1000),
      meetingRoomName: `room_${crypto.randomUUID()}`,
      accessTokenHash: crypto.randomUUID(),
      consentAt: opts.createdAt,
      consentVersion: "v1",
      createdAt: opts.createdAt,
    },
  });
}

describe("telehealth analytics — GET /admin/telehealth/analytics/overview (§9.7.7 KARAR K10a)", () => {
  let app: FastifyInstance;
  let adminToken: string;
  let managerToken: string;
  let editorToken: string;
  let customerToken: string;

  beforeAll(async () => {
    app = await buildTestApp();
    await resetDatabase(app.prisma);
    await setTelehealthModuleEnabled(app, true);

    adminToken = await loginAs(app, (await createUserDirect(app, "ADMIN")).email);
    managerToken = await loginAs(app, (await createUserDirect(app, "MANAGER")).email);
    editorToken = await loginAs(app, (await createUserDirect(app, "EDITOR")).email);
    customerToken = await loginAs(app, (await createUserDirect(app, "CUSTOMER")).email);
  });

  afterAll(async () => {
    await resetDatabase(app.prisma);
    await app.close();
  });

  it("RBAC — ADMIN/MANAGER 200, EDITOR/CUSTOMER 403", async () => {
    const admin = await app.inject({ method: "GET", url: "/api/v1/admin/telehealth/analytics/overview", headers: authHeader(adminToken) });
    expect(admin.statusCode).toBe(200);

    const manager = await app.inject({ method: "GET", url: "/api/v1/admin/telehealth/analytics/overview", headers: authHeader(managerToken) });
    expect(manager.statusCode).toBe(200);

    const editor = await app.inject({ method: "GET", url: "/api/v1/admin/telehealth/analytics/overview", headers: authHeader(editorToken) });
    expect(editor.statusCode).toBe(403);

    const customer = await app.inject({ method: "GET", url: "/api/v1/admin/telehealth/analytics/overview", headers: authHeader(customerToken) });
    expect(customer.statusCode).toBe(403);
  });

  it("boş aralıkta TÜM sayılar/tutarlar sıfır döner; `series` boş bucket'larla DOLU (SIFIR DEĞİL BOŞ dizi)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/admin/telehealth/analytics/overview?from=2000-01-01&to=2000-01-03&granularity=day",
      headers: authHeader(adminToken),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json().data;

    expect(body.from).toBe("2000-01-01");
    expect(body.to).toBe("2000-01-03");
    expect(body.granularity).toBe("day");
    expect(body.currency).toBe("TRY");
    expect(body.mixedCurrency).toBe(false);
    expect(body.appointments).toEqual({
      total: 0,
      pendingPayment: 0,
      scheduled: 0,
      inProgress: 0,
      completed: 0,
      cancelled: 0,
      noShow: 0,
    });
    expect(body.bookings).toEqual({ total: 0, paid: 0, pending: 0, failed: 0, refunded: 0 });
    expect(body.revenue).toEqual({ grossCents: 0, commissionCents: 0, netCents: 0, completedSessionCount: 0 });
    expect(body.doctors).toEqual([]);

    // 3 günlük aralık → 3 bucket, HEPSİ sıfır (boş bucket'lar SIFIRLA doldurulur, dizi KISALTILMAZ).
    expect(body.series).toHaveLength(3);
    expect(body.series.map((p: { date: string }) => p.date)).toEqual(["2000-01-01", "2000-01-02", "2000-01-03"]);
    for (const point of body.series) {
      expect(point).toMatchObject({ completedCount: 0, cancelledCount: 0, grossCents: 0, commissionCents: 0, netCents: 0 });
    }
  });

  it("appointments/bookings/revenue/series/doctors doğru hesaplanır; mixedCurrency = true (TRY + USD)", async () => {
    const { env } = await import("../../src/config/env");
    const rate = env.PLATFORM_COMMISSION_RATE_PERCENT;

    const doctorTry = await createDoctor(app, "TRY");
    const doctorUsd = await createDoctor(app, "USD");

    const day1 = new Date("2025-06-01T09:00:00.000Z");
    const day2 = new Date("2025-06-02T09:00:00.000Z");
    const day3 = new Date("2025-06-03T09:00:00.000Z");
    const beforeRange = new Date("2025-05-31T09:00:00.000Z");

    // ---- appointments (aralık İÇİNDE) ----
    await createAppointmentDirect(app, { doctorId: doctorTry.id, status: "COMPLETED", priceCents: 100000, currency: "TRY", startsAt: day1 });
    await createAppointmentDirect(app, {
      doctorId: doctorTry.id,
      status: "CANCELLED",
      priceCents: 50000,
      currency: "TRY",
      startsAt: new Date(day1.getTime() + 60 * 60 * 1000),
    });
    await createAppointmentDirect(app, { doctorId: doctorUsd.id, status: "COMPLETED", priceCents: 20000, currency: "USD", startsAt: day2 });
    await createAppointmentDirect(app, {
      doctorId: doctorTry.id,
      status: "SCHEDULED",
      priceCents: 50000,
      currency: "TRY",
      startsAt: new Date(day2.getTime() + 60 * 60 * 1000),
    });
    await createAppointmentDirect(app, { doctorId: doctorTry.id, status: "NO_SHOW", priceCents: 50000, currency: "TRY", startsAt: day3 });
    await createAppointmentDirect(app, {
      doctorId: doctorTry.id,
      status: "PENDING_PAYMENT",
      priceCents: 50000,
      currency: "TRY",
      startsAt: new Date(day3.getTime() + 60 * 60 * 1000),
    });
    await createAppointmentDirect(app, {
      doctorId: doctorUsd.id,
      status: "IN_PROGRESS",
      priceCents: 20000,
      currency: "USD",
      startsAt: new Date(day3.getTime() + 2 * 60 * 60 * 1000),
    });
    // ---- aralık DIŞINDA — HİÇBİR sayaca/tutara girmemeli ----
    await createAppointmentDirect(app, { doctorId: doctorTry.id, status: "COMPLETED", priceCents: 999999, currency: "TRY", startsAt: beforeRange });

    // ---- bookings (aralık İÇİNDE, `createdAt` bazlı) ----
    await createBookingDirect(app, { doctorId: doctorTry.id, paymentStatus: "PAID", createdAt: new Date("2025-06-01T08:00:00.000Z") });
    await createBookingDirect(app, { doctorId: doctorTry.id, paymentStatus: "PENDING", createdAt: new Date("2025-06-02T08:00:00.000Z") });
    await createBookingDirect(app, { doctorId: doctorUsd.id, paymentStatus: "FAILED", createdAt: new Date("2025-06-02T09:00:00.000Z"), currency: "USD" });
    await createBookingDirect(app, { doctorId: doctorTry.id, paymentStatus: "EXPIRED", createdAt: new Date("2025-06-03T08:00:00.000Z") });
    await createBookingDirect(app, { doctorId: doctorUsd.id, paymentStatus: "REFUNDED", createdAt: new Date("2025-06-03T09:00:00.000Z"), currency: "USD" });
    // aralık DIŞINDA
    await createBookingDirect(app, { doctorId: doctorTry.id, paymentStatus: "PAID", createdAt: new Date("2025-05-31T08:00:00.000Z") });

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/admin/telehealth/analytics/overview?from=2025-06-01&to=2025-06-03&granularity=day",
      headers: authHeader(adminToken),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json().data;

    expect(body.appointments).toEqual({
      total: 7,
      pendingPayment: 1,
      scheduled: 1,
      inProgress: 1,
      completed: 2,
      cancelled: 1,
      noShow: 1,
    });
    expect(body.bookings).toEqual({ total: 5, paid: 1, pending: 1, failed: 2, refunded: 1 });

    const commissionTry = Math.round((100000 * rate) / 100);
    const commissionUsd = Math.round((20000 * rate) / 100);
    expect(body.revenue).toEqual({
      grossCents: 120000,
      commissionCents: commissionTry + commissionUsd,
      netCents: 120000 - (commissionTry + commissionUsd),
      completedSessionCount: 2,
    });
    expect(body.mixedCurrency).toBe(true);
    // Alfabetik olarak İLK kod — "TRY" < "USD".
    expect(body.currency).toBe("TRY");
    expect(body.commissionRatePercent).toBe(rate);

    expect(body.series).toHaveLength(3);
    const [s1, s2, s3] = body.series;
    expect(s1).toEqual({ date: "2025-06-01", completedCount: 1, cancelledCount: 1, grossCents: 100000, commissionCents: commissionTry, netCents: 100000 - commissionTry });
    expect(s2).toEqual({ date: "2025-06-02", completedCount: 1, cancelledCount: 0, grossCents: 20000, commissionCents: commissionUsd, netCents: 20000 - commissionUsd });
    expect(s3).toEqual({ date: "2025-06-03", completedCount: 0, cancelledCount: 0, grossCents: 0, commissionCents: 0, netCents: 0 });

    expect(body.doctors).toHaveLength(2);
    const [d1, d2] = body.doctors;
    // netCents DESC — TRY doktoru (net 100000-commission) USD doktorundan (net 20000-commission) BÜYÜK.
    expect(d1.doctorId).toBe(doctorTry.id);
    expect(d1).toMatchObject({ completedCount: 1, cancelledCount: 1, grossCents: 100000, commissionCents: commissionTry, netCents: 100000 - commissionTry });
    expect(d2.doctorId).toBe(doctorUsd.id);
    expect(d2).toMatchObject({ completedCount: 1, cancelledCount: 0, grossCents: 20000, commissionCents: commissionUsd, netCents: 20000 - commissionUsd });
  });

  it("modül KAPALIYKEN 404 döner (`requireModuleEnabled`, diğer `/admin/telehealth/*` uçlarıyla AYNI disiplin)", async () => {
    await setTelehealthModuleEnabled(app, false);
    const res = await app.inject({ method: "GET", url: "/api/v1/admin/telehealth/analytics/overview", headers: authHeader(adminToken) });
    expect(res.statusCode).toBe(404);
    await setTelehealthModuleEnabled(app, true);
  });

  it("aralık > 366 gün → 422 (`resolveStatsRange` PAYLAŞILAN limit)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/admin/telehealth/analytics/overview?from=2020-01-01&to=2022-01-01",
      headers: authHeader(adminToken),
    });
    expect(res.statusCode).toBe(422);
  });
});
