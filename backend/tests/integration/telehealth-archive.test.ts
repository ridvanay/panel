import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { AppointmentStatus, BookingPaymentStatus } from "@prisma/client";
import { buildTestApp } from "../helpers/build-test-app";
import { resetDatabase } from "../helpers/reset-db";
import { registerTestUser } from "../helpers/auth";
import { hashPassword } from "../../src/lib/password";

/**
 * Paket B2 (doktor arşivi) + B4 (test booking arşivi). Booking/randevu satırları doğrudan DB'ye
 * yazılır — böylece geçmiş tarihli, ödemeli ve COMPLETED randevular booking akışını (kırmızı
 * çizgideki `lib/booking.ts`) çalıştırmadan kurulabilir.
 */

function authHeader(token: string) {
  return { authorization: `Bearer ${token}` };
}

async function enableTelehealth(app: FastifyInstance) {
  await app.prisma.siteModule.upsert({ where: { key: "telehealth" }, create: { key: "telehealth", enabled: true }, update: { enabled: true } });
}

async function createDoctor(app: FastifyInstance, overrides: { specialtyId?: string; userId?: string } = {}) {
  return app.prisma.doctorProfile.create({
    data: {
      title: "Dr.",
      fullName: `Arşiv Doktor ${crypto.randomUUID().slice(0, 8)}`,
      slug: `arsiv-doktor-${crypto.randomUUID()}`,
      bio: "Test",
      languages: ["tr"],
      sessionPriceCents: 10000,
      currency: "EUR",
      isActive: true,
      specialtyId: overrides.specialtyId ?? null,
      userId: overrides.userId ?? null,
    },
  });
}

async function createBookingRow(
  app: FastifyInstance,
  input: {
    doctorId: string;
    startsAt: Date;
    status: AppointmentStatus;
    paymentStatus?: BookingPaymentStatus;
    paidBy?: string | null;
    priceCents?: number;
    patientUserId?: string | null;
  }
) {
  const priceCents = input.priceCents ?? 200000;
  const booking = await app.prisma.appointmentBooking.create({
    data: {
      bookingNumber: `TB-${crypto.randomUUID().slice(0, 8)}`,
      doctorId: input.doctorId,
      patientUserId: input.patientUserId ?? null,
      patientName: "Test Hasta",
      patientEmail: `hasta-${crypto.randomUUID()}@example.com`,
      slotCount: 1,
      unitPriceCents: priceCents,
      subtotalCents: priceCents,
      totalCents: priceCents,
      currency: "EUR",
      paymentStatus: input.paymentStatus ?? "PAID",
      paidAt: (input.paymentStatus ?? "PAID") === "PAID" ? new Date() : null,
      paidBy: input.paidBy === undefined ? "manual" : input.paidBy,
      expiresAt: new Date(input.startsAt.getTime() - 3600_000),
      meetingRoomName: `room_${crypto.randomBytes(16).toString("hex")}`,
      accessTokenHash: crypto.randomBytes(32).toString("hex"),
      consentAt: new Date(),
      consentVersion: "test",
    },
  });
  const appointment = await app.prisma.appointment.create({
    data: {
      doctorId: input.doctorId,
      patientUserId: input.patientUserId ?? null,
      patientName: "Test Hasta",
      patientEmail: booking.patientEmail,
      startsAt: input.startsAt,
      endsAt: new Date(input.startsAt.getTime() + 30 * 60_000),
      status: input.status,
      priceCents,
      currency: "EUR",
      meetingRoomName: `room_${crypto.randomBytes(16).toString("hex")}`,
      accessTokenHash: crypto.randomBytes(32).toString("hex"),
      bookingId: booking.id,
    },
  });
  return { booking, appointment };
}

const PAST = () => new Date(Date.now() - 3 * 24 * 3600_000);
const FUTURE = () => new Date(Date.now() + 3 * 24 * 3600_000);

async function createManagerToken(app: FastifyInstance): Promise<string> {
  const email = `manager-${crypto.randomUUID()}@example.com`;
  await app.prisma.user.create({
    data: { email, name: "Yönetici", passwordHash: await hashPassword("Sifre12345!"), role: "MANAGER", emailVerifiedAt: new Date() },
  });
  const res = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email, password: "Sifre12345!" } });
  return res.json().data.tokens.accessToken as string;
}

describe("Doktor arşivleme (Paket B2)", () => {
  let app: FastifyInstance;
  let adminToken: string;

  beforeEach(async () => {
    app = await buildTestApp();
    await resetDatabase(app.prisma);
    await enableTelehealth(app);
    adminToken = (await registerTestUser(app, { email: `admin-${crypto.randomUUID()}@example.com` })).accessToken;
  });

  afterEach(async () => {
    await resetDatabase(app.prisma);
    await app.close();
  });

  it("geçmişi olan doktor silinemez: 409 DOCTOR_HAS_HISTORY + yeni mesaj; deletion-check arşiv önerir", async () => {
    const doctor = await createDoctor(app);
    await createBookingRow(app, { doctorId: doctor.id, startsAt: PAST(), status: "COMPLETED" });

    const check = await app.inject({ method: "GET", url: `/api/v1/admin/telehealth/doctors/${doctor.id}/deletion-check`, headers: authHeader(adminToken) });
    expect(check.statusCode).toBe(200);
    expect(check.json().data).toMatchObject({ deletable: false, appointmentCount: 1, bookingCount: 1, upcomingAppointmentCount: 0 });

    const res = await app.inject({ method: "DELETE", url: `/api/v1/admin/telehealth/doctors/${doctor.id}`, headers: authHeader(adminToken) });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("DOCTOR_HAS_HISTORY");
    expect(res.json().error.message).toBe("Bu doktorun randevu geçmişi olduğu için kalıcı olarak silinemez; arşivleyebilirsiniz.");
  });

  it("gelecekte açık randevusu olan doktor arşivlenemez (409 DOCTOR_HAS_UPCOMING_APPOINTMENTS)", async () => {
    const doctor = await createDoctor(app);
    await createBookingRow(app, { doctorId: doctor.id, startsAt: FUTURE(), status: "SCHEDULED" });

    const res = await app.inject({ method: "POST", url: `/api/v1/admin/telehealth/doctors/${doctor.id}/archive`, headers: authHeader(adminToken) });

    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("DOCTOR_HAS_UPCOMING_APPOINTMENTS");
  });

  it("arşivlenen doktor public uçlarda görünmez; geçmiş kayıtlar ve id/slug/userId bozulmaz", async () => {
    const specialty = await app.prisma.specialty.create({ data: { name: "Kardiyoloji", slug: `kardiyoloji-${crypto.randomUUID().slice(0, 6)}`, icon: "heart" } });
    const linkedUser = await app.prisma.user.create({
      data: { email: `dr-${crypto.randomUUID()}@example.com`, name: "Dr", passwordHash: "x", emailVerifiedAt: new Date() },
    });
    const doctor = await createDoctor(app, { specialtyId: specialty.id, userId: linkedUser.id });
    const { booking } = await createBookingRow(app, { doctorId: doctor.id, startsAt: PAST(), status: "COMPLETED" });

    const before = await app.inject({ method: "GET", url: `/api/v1/specialties/${specialty.slug}` });
    expect(before.json().data.doctorCount).toBe(1);

    const archive = await app.inject({ method: "POST", url: `/api/v1/admin/telehealth/doctors/${doctor.id}/archive`, headers: authHeader(adminToken) });
    expect(archive.statusCode).toBe(200);
    expect(archive.json().data.isActive).toBe(false);
    expect(archive.json().data.archivedAt).not.toBeNull();

    const list = await app.inject({ method: "GET", url: "/api/v1/doctors" });
    expect(list.json().data.map((d: { id: string }) => d.id)).not.toContain(doctor.id);
    const search = await app.inject({ method: "GET", url: `/api/v1/doctors?search=${encodeURIComponent(doctor.fullName)}` });
    expect(search.json().data).toHaveLength(0);
    expect((await app.inject({ method: "GET", url: `/api/v1/doctors/${doctor.slug}` })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: `/api/v1/doctors/${doctor.slug}/slots?from=2030-01-01&to=2030-01-02` })).statusCode).toBe(404);
    const after = await app.inject({ method: "GET", url: `/api/v1/specialties/${specialty.slug}` });
    expect(after.json().data.doctorCount).toBe(0);

    const row = await app.prisma.doctorProfile.findUniqueOrThrow({ where: { id: doctor.id } });
    expect(row.slug).toBe(doctor.slug);
    expect(row.userId).toBe(linkedUser.id);
    expect(await app.prisma.appointmentBooking.count({ where: { id: booking.id } })).toBe(1);
    const audit = await app.prisma.auditLog.findFirst({ where: { action: "telehealth.doctor.archived", targetId: doctor.id } });
    expect(audit).not.toBeNull();
  });

  it("admin listesi varsayılan arşivsiz; includeArchived=true ile görünür; arşivliyken aktifleştirme 409; arşivden çıkar", async () => {
    const doctor = await createDoctor(app);
    await app.inject({ method: "POST", url: `/api/v1/admin/telehealth/doctors/${doctor.id}/archive`, headers: authHeader(adminToken) });

    const defaultList = await app.inject({ method: "GET", url: "/api/v1/admin/telehealth/doctors", headers: authHeader(adminToken) });
    expect(defaultList.json().data.map((d: { id: string }) => d.id)).not.toContain(doctor.id);
    const withArchived = await app.inject({ method: "GET", url: "/api/v1/admin/telehealth/doctors?includeArchived=true", headers: authHeader(adminToken) });
    expect(withArchived.json().data.map((d: { id: string }) => d.id)).toContain(doctor.id);

    const activate = await app.inject({
      method: "PATCH",
      url: `/api/v1/admin/telehealth/doctors/${doctor.id}`,
      headers: authHeader(adminToken),
      payload: { isActive: true },
    });
    expect(activate.statusCode).toBe(409);

    const again = await app.inject({ method: "POST", url: `/api/v1/admin/telehealth/doctors/${doctor.id}/archive`, headers: authHeader(adminToken) });
    expect(again.statusCode).toBe(409);

    const unarchive = await app.inject({ method: "POST", url: `/api/v1/admin/telehealth/doctors/${doctor.id}/unarchive`, headers: authHeader(adminToken) });
    expect(unarchive.statusCode).toBe(200);
    expect(unarchive.json().data.archivedAt).toBeNull();
    expect(unarchive.json().data.isActive).toBe(false);
  });
});

describe("Test booking arşivleme (Paket B4)", () => {
  let app: FastifyInstance;
  let adminToken: string;

  beforeEach(async () => {
    app = await buildTestApp();
    await resetDatabase(app.prisma);
    await enableTelehealth(app);
    adminToken = (await registerTestUser(app, { email: `admin-${crypto.randomUUID()}@example.com` })).accessToken;
  });

  afterEach(async () => {
    await resetDatabase(app.prisma);
    await app.close();
  });

  it("yalnızca ADMIN; gerekçe zorunlu; açık/gelecek randevusu olan booking arşivlenemez", async () => {
    const doctor = await createDoctor(app);
    const { booking: past } = await createBookingRow(app, { doctorId: doctor.id, startsAt: PAST(), status: "COMPLETED" });
    const { booking: future } = await createBookingRow(app, { doctorId: doctor.id, startsAt: FUTURE(), status: "SCHEDULED" });
    const managerToken = await createManagerToken(app);

    const asManager = await app.inject({
      method: "POST",
      url: `/api/v1/admin/telehealth/bookings/${past.id}/archive`,
      headers: authHeader(managerToken),
      payload: { reason: "Test ödemesi" },
    });
    expect(asManager.statusCode).toBe(403);

    const noReason = await app.inject({ method: "POST", url: `/api/v1/admin/telehealth/bookings/${past.id}/archive`, headers: authHeader(adminToken), payload: {} });
    expect(noReason.statusCode).toBe(422);

    const futureRes = await app.inject({
      method: "POST",
      url: `/api/v1/admin/telehealth/bookings/${future.id}/archive`,
      headers: authHeader(adminToken),
      payload: { reason: "Test ödemesi" },
    });
    expect(futureRes.statusCode).toBe(409);
    expect(futureRes.json().error.code).toBe("BOOKING_NOT_ARCHIVABLE");
  });

  it("arşivlenen booking doktor kazancına, konsol sayaçlarına, analitiğe ve listelere dahil edilmez; veri silinmez", async () => {
    const patient = await registerTestUser(app, { email: `hasta-${crypto.randomUUID()}@example.com` });
    const doctorUser = await registerTestUser(app, { email: `doktor-${crypto.randomUUID()}@example.com` });
    await app.prisma.user.update({ where: { id: doctorUser.userId }, data: { twoFactorEnabled: true } });
    const doctor = await createDoctor(app, { userId: doctorUser.userId });

    const { booking: testBooking } = await createBookingRow(app, {
      doctorId: doctor.id,
      startsAt: PAST(),
      status: "COMPLETED",
      priceCents: 400000,
      patientUserId: patient.userId,
    });
    await createBookingRow(app, { doctorId: doctor.id, startsAt: PAST(), status: "COMPLETED", priceCents: 10000 });

    const archive = await app.inject({
      method: "POST",
      url: `/api/v1/admin/telehealth/bookings/${testBooking.id}/archive`,
      headers: authHeader(adminToken),
      payload: { reason: "Eylül-Ekim test ödemesi" },
    });
    expect(archive.statusCode).toBe(200);
    expect(archive.json().data.archivedReason).toBe("Eylül-Ekim test ödemesi");

    const earnings = await app.inject({ method: "GET", url: "/api/v1/doctor/earnings", headers: authHeader(doctorUser.accessToken) });
    expect(earnings.statusCode).toBe(200);
    expect(earnings.json().data.summary.grossCents).toBe(10000);
    expect(earnings.json().data.summary.completedSessionCount).toBe(1);
    expect(earnings.json().data.sessions.items).toHaveLength(1);

    const overview = await app.inject({ method: "GET", url: "/api/v1/doctor/overview", headers: authHeader(doctorUser.accessToken) });
    expect(overview.json().data.completedConsultationTotal).toBe(1);
    expect(overview.json().data.allBookingTotal).toBe(1);

    const feed = await app.inject({ method: "GET", url: "/api/v1/doctor/portal-feed", headers: authHeader(doctorUser.accessToken) });
    expect(feed.statusCode).toBe(200);
    expect(JSON.stringify(feed.json().data.notifications)).not.toContain(testBooking.bookingNumber);

    const doctorBookings = await app.inject({ method: "GET", url: "/api/v1/doctor/bookings", headers: authHeader(doctorUser.accessToken) });
    expect(doctorBookings.json().data.map((b: { id: string }) => b.id)).not.toContain(testBooking.id);

    const patientBookings = await app.inject({ method: "GET", url: "/api/v1/patient/bookings", headers: authHeader(patient.accessToken) });
    expect(patientBookings.json().data).toHaveLength(0);
    expect(patientBookings.json().meta.counts.all).toBe(0);

    const adminBookings = await app.inject({ method: "GET", url: "/api/v1/admin/telehealth/bookings", headers: authHeader(adminToken) });
    expect(adminBookings.json().data.map((b: { id: string }) => b.id)).not.toContain(testBooking.id);
    const adminBookingsAll = await app.inject({ method: "GET", url: "/api/v1/admin/telehealth/bookings?includeArchived=true", headers: authHeader(adminToken) });
    expect(adminBookingsAll.json().data.map((b: { id: string }) => b.id)).toContain(testBooking.id);

    const adminAppointments = await app.inject({ method: "GET", url: "/api/v1/admin/telehealth/appointments", headers: authHeader(adminToken) });
    expect(adminAppointments.json().data).toHaveLength(1);

    const from = new Date(Date.now() - 10 * 24 * 3600_000).toISOString().slice(0, 10);
    const to = new Date().toISOString().slice(0, 10);
    const analytics = await app.inject({ method: "GET", url: `/api/v1/admin/telehealth/analytics/overview?from=${from}&to=${to}`, headers: authHeader(adminToken) });
    expect(analytics.statusCode).toBe(200);
    expect(analytics.json().data.revenue.grossCents).toBe(10000);
    expect(analytics.json().data.appointments.completed).toBe(1);
    expect(analytics.json().data.bookings.total).toBe(1);
    expect(analytics.json().data.doctors[0].grossCents).toBe(10000);

    // Veri silinmedi, ödeme alanları değişmedi.
    const row = await app.prisma.appointmentBooking.findUniqueOrThrow({ where: { id: testBooking.id } });
    expect(row.paymentStatus).toBe("PAID");
    expect(row.totalCents).toBe(400000);
    expect(await app.prisma.appointment.count({ where: { bookingId: testBooking.id } })).toBe(1);

    const unarchive = await app.inject({ method: "POST", url: `/api/v1/admin/telehealth/bookings/${testBooking.id}/unarchive`, headers: authHeader(adminToken) });
    expect(unarchive.statusCode).toBe(200);
    const restored = await app.inject({ method: "GET", url: "/api/v1/doctor/earnings", headers: authHeader(doctorUser.accessToken) });
    expect(restored.json().data.summary.grossCents).toBe(410000);
  });

  it("arşivli booking'in slotu dolu kalır (slot sorgusu arşivi BİLİNÇLİ yok sayar)", async () => {
    const doctor = await createDoctor(app);
    await app.prisma.doctorAvailability.createMany({
      data: [1, 2, 3, 4, 5, 6, 7].map((dayOfWeek) => ({ doctorId: doctor.id, dayOfWeek, startMinute: 0, endMinute: 1440 })),
    });
    const startsAt = new Date(Date.now() + 5 * 24 * 3600_000);
    startsAt.setUTCHours(12, 0, 0, 0);
    // İptal edilmiş gelecek randevu arşivlenebilir; slot sorgusu durumdan bağımsız tüm satırları dolu sayar.
    const { booking } = await createBookingRow(app, { doctorId: doctor.id, startsAt, status: "CANCELLED" });

    const archive = await app.inject({
      method: "POST",
      url: `/api/v1/admin/telehealth/bookings/${booking.id}/archive`,
      headers: authHeader(adminToken),
      payload: { reason: "Test" },
    });
    expect(archive.statusCode).toBe(200);

    const day = startsAt.toISOString().slice(0, 10);
    const slots = await app.inject({ method: "GET", url: `/api/v1/doctors/${doctor.slug}/slots?from=${day}&to=${day}` });
    expect(slots.statusCode).toBe(200);
    const slot = slots.json().data.find((s: { startsAt: string }) => s.startsAt === startsAt.toISOString());
    expect(slot?.available).toBe(false);
  });
});
