import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";

/**
 * Paket A1 (2026-10-18) — admin randevu iptalinde "Girdi doğrulama hatası" (gövdesiz istek 422)
 * regresyonu + test randevusunu kalıcı silme (`DELETE /admin/telehealth/appointments/{id}`) +
 * Paket A4 admin doktor güncelleme denetimi. `sendTemplateEmail` gerçek SMTP'ye dokunmasın diye
 * mock'lanır (`telehealth-admin-reschedule.test.ts` ile aynı desen). Booking ucunun 5/dk hız
 * sınırı nedeniyle her `it` taze bir `app` ile çalışır.
 */
const sendTemplateEmailMock = vi.fn();
vi.mock("../../src/modules/email-templates/email-templates.service", () => ({
  sendTemplateEmail: (...args: unknown[]) => sendTemplateEmailMock(...args),
}));

import { buildTestApp } from "../helpers/build-test-app";
import { resetDatabase } from "../helpers/reset-db";
import { registerTestUser } from "../helpers/auth";

function authHeader(token: string) {
  return { authorization: `Bearer ${token}` };
}

async function createManagerToken(app: FastifyInstance): Promise<string> {
  const { hashPassword } = await import("../../src/lib/password");
  const email = `telehealth-delete-manager-${crypto.randomUUID()}@example.com`;
  await app.prisma.user.create({
    data: { email, name: "Yönetici", passwordHash: await hashPassword("Sifre12345!"), role: "MANAGER", status: "ACTIVE", emailVerifiedAt: new Date() },
  });
  const res = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email, password: "Sifre12345!" } });
  expect(res.statusCode).toBe(200);
  return res.json().data.tokens.accessToken as string;
}

async function setTelehealthModuleEnabled(app: FastifyInstance) {
  await app.prisma.siteModule.upsert({ where: { key: "telehealth" }, create: { key: "telehealth", enabled: true }, update: { enabled: true } });
}

async function createDoctor(app: FastifyInstance) {
  const doctor = await app.prisma.doctorProfile.create({
    data: {
      title: "Dr.",
      fullName: `Test Doktor ${crypto.randomUUID()}`,
      slug: `test-doktor-${crypto.randomUUID()}`,
      bio: "Test amaçlı doktor profili.",
      languages: ["tr"],
      timeZone: "Europe/Istanbul",
      sessionDurationMin: 30,
      sessionPriceCents: 50000,
      currency: "TRY",
      isActive: true,
    },
  });
  await app.prisma.doctorAvailability.create({ data: { doctorId: doctor.id, dayOfWeek: 1, startMinute: 540, endMinute: 1020, isActive: true } });
  return doctor;
}

function nextMondayNineAmUtc(): Date {
  const now = new Date();
  const daysUntilMonday = (8 - now.getUTCDay()) % 7 || 7;
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + daysUntilMonday, 6, 0, 0));
}

/** Booking + ADMIN `mark-paid` → ödemeli (`PAID/manual`) tek `SCHEDULED` randevu. */
async function createPaidAppointment(app: FastifyInstance, adminToken: string, doctorSlug: string) {
  const created = await app.inject({
    method: "POST",
    url: "/api/v1/appointments/bookings",
    payload: {
      doctorSlug,
      slots: [nextMondayNineAmUtc().toISOString()],
      patientName: "Test Hasta",
      patientEmail: `hasta-${crypto.randomUUID()}@example.com`,
      identity: { citizenshipType: "TR", identityNumber: "10000000146", birthDate: "1990-01-01" },
      consent: true,
    },
  });
  expect(created.statusCode).toBe(201);
  const { bookingId, appointments } = created.json().data;
  const markPaid = await app.inject({
    method: "POST",
    url: `/api/v1/admin/telehealth/bookings/${bookingId}/mark-paid`,
    headers: authHeader(adminToken),
    payload: { reason: "test" },
  });
  expect(markPaid.statusCode).toBe(200);
  return { bookingId: bookingId as string, appointmentId: appointments[0].id as string };
}

/** Ödeme kaydı OLMAYAN (eski tekil akış) test randevusu — doğrudan DB'ye yazılır. */
async function createUnpaidAppointment(app: FastifyInstance, doctorId: string, status: "CANCELLED" | "COMPLETED" | "SCHEDULED", bookingId?: string) {
  const startsAt = new Date(Date.UTC(2026, 0, 5, 6, Math.floor(Math.random() * 1000)));
  return app.prisma.appointment.create({
    data: {
      doctorId,
      patientName: "Test Hasta",
      patientEmail: `silinecek-${crypto.randomUUID()}@example.com`,
      startsAt,
      endsAt: new Date(startsAt.getTime() + 30 * 60_000),
      status,
      priceCents: 0,
      meetingRoomName: `room_${crypto.randomBytes(16).toString("hex")}`,
      accessTokenHash: crypto.randomBytes(32).toString("hex"),
      bookingId: bookingId ?? null,
    },
  });
}

describe("Admin randevu iptali ve kalıcı silme", () => {
  let app: FastifyInstance;
  let adminToken: string;

  beforeEach(async () => {
    app = await buildTestApp();
    await resetDatabase(app.prisma);
    await setTelehealthModuleEnabled(app);
    adminToken = (await registerTestUser(app, { email: `telehealth-delete-admin-${crypto.randomUUID()}@example.com` })).accessToken;
    sendTemplateEmailMock.mockReset().mockResolvedValue(undefined);
  });

  afterEach(async () => {
    await resetDatabase(app.prisma);
    await app.close();
  });

  it("A1 — gerekçesiz iptal (gövde HİÇ yok) 200 döner, gerekçe null yazılır", async () => {
    const doctor = await createDoctor(app);
    const { appointmentId } = await createPaidAppointment(app, adminToken, doctor.slug);

    const res = await app.inject({ method: "POST", url: `/api/v1/appointments/${appointmentId}/cancel`, headers: authHeader(adminToken) });

    expect(res.statusCode).toBe(200);
    expect(res.json().data.status).toBe("CANCELLED");
    const row = await app.prisma.appointment.findUniqueOrThrow({ where: { id: appointmentId } });
    expect(row.cancelReason).toBeNull();
  });

  it("A1 — `{}` gövdesiyle ve gerekçeyle iptal de 200 döner", async () => {
    const doctor = await createDoctor(app);
    const first = await createUnpaidAppointment(app, doctor.id, "SCHEDULED");
    const second = await createUnpaidAppointment(app, doctor.id, "SCHEDULED");

    const empty = await app.inject({ method: "POST", url: `/api/v1/appointments/${first.id}/cancel`, headers: authHeader(adminToken), payload: {} });
    expect(empty.statusCode).toBe(200);

    const withReason = await app.inject({
      method: "POST",
      url: `/api/v1/appointments/${second.id}/cancel`,
      headers: authHeader(adminToken),
      payload: { reason: "Hasta talebi" },
    });
    expect(withReason.statusCode).toBe(200);
    expect(withReason.json().data.cancelReason).toBe("Hasta talebi");
  });

  it("ödemeli iptal edilmiş randevu silinemez — uygunluk nedeni döner, DELETE 409", async () => {
    const doctor = await createDoctor(app);
    const { appointmentId } = await createPaidAppointment(app, adminToken, doctor.slug);
    await app.inject({ method: "POST", url: `/api/v1/appointments/${appointmentId}/cancel`, headers: authHeader(adminToken) });

    const check = await app.inject({ method: "GET", url: `/api/v1/admin/telehealth/appointments/${appointmentId}/deletion-check`, headers: authHeader(adminToken) });
    expect(check.statusCode).toBe(200);
    expect(check.json().data.deletable).toBe(false);
    expect(check.json().data.blockers.map((b: { code: string }) => b.code)).toContain("HAS_PAYMENT");

    const del = await app.inject({
      method: "DELETE",
      url: `/api/v1/admin/telehealth/appointments/${appointmentId}`,
      headers: authHeader(adminToken),
      payload: { confirm: true },
    });
    expect(del.statusCode).toBe(409);
    expect(del.json().error.code).toBe("APPOINTMENT_NOT_DELETABLE");
    expect(await app.prisma.appointment.findUnique({ where: { id: appointmentId } })).not.toBeNull();
  });

  it("planlanmış randevu silinemez (STATUS_NOT_FINAL)", async () => {
    const doctor = await createDoctor(app);
    const appointment = await createUnpaidAppointment(app, doctor.id, "SCHEDULED");
    const check = await app.inject({ method: "GET", url: `/api/v1/admin/telehealth/appointments/${appointment.id}/deletion-check`, headers: authHeader(adminToken) });
    expect(check.json().data.blockers.map((b: { code: string }) => b.code)).toEqual(["STATUS_NOT_FINAL"]);
  });

  it("ödemesiz iptal edilmiş test randevusu: onay gövdesi zorunlu, MANAGER 403, ADMIN siler ve audit yazılır", async () => {
    const doctor = await createDoctor(app);
    const appointment = await createUnpaidAppointment(app, doctor.id, "CANCELLED");
    const url = `/api/v1/admin/telehealth/appointments/${appointment.id}`;

    const check = await app.inject({ method: "GET", url: `${url}/deletion-check`, headers: authHeader(adminToken) });
    expect(check.json().data).toEqual({ deletable: true, blockers: [] });

    const noConfirm = await app.inject({ method: "DELETE", url, headers: authHeader(adminToken), payload: {} });
    expect(noConfirm.statusCode).toBe(422);

    const managerToken = await createManagerToken(app);
    const asManager = await app.inject({ method: "DELETE", url, headers: authHeader(managerToken), payload: { confirm: true } });
    expect(asManager.statusCode).toBe(403);
    const managerCheck = await app.inject({ method: "GET", url: `${url}/deletion-check`, headers: authHeader(managerToken) });
    expect(managerCheck.statusCode).toBe(403);

    const res = await app.inject({ method: "DELETE", url, headers: authHeader(adminToken), payload: { confirm: true } });
    expect(res.statusCode).toBe(204);
    expect(await app.prisma.appointment.findUnique({ where: { id: appointment.id } })).toBeNull();

    const audit = await app.prisma.auditLog.findFirst({ where: { action: "telehealth.appointment.deleted", targetId: appointment.id } });
    expect(audit).not.toBeNull();
    expect(audit!.metadata).toMatchObject({ status: "CANCELLED", doctorId: doctor.id, bookingId: null, bookingDeleted: false });
    // Silinen hasta PII'si audit'e kopyalanmaz.
    expect(JSON.stringify(audit!.metadata)).not.toContain(appointment.patientEmail);
  });

  it("booking'in son randevusu silinince ödemesiz booking de silinir; tamamlanmış ama başlamış görüşme silinemez", async () => {
    const doctor = await createDoctor(app);
    const booking = await app.prisma.appointmentBooking.create({
      data: {
        bookingNumber: `TEST-${crypto.randomUUID().slice(0, 8)}`,
        doctorId: doctor.id,
        patientName: "Test Hasta",
        patientEmail: "test@example.com",
        slotCount: 1,
        unitPriceCents: 0,
        subtotalCents: 0,
        totalCents: 0,
        paymentStatus: "EXPIRED",
        expiresAt: new Date(),
        meetingRoomName: `room_${crypto.randomBytes(16).toString("hex")}`,
        accessTokenHash: crypto.randomBytes(32).toString("hex"),
        consentAt: new Date(),
        consentVersion: "test",
      },
    });
    const appointment = await createUnpaidAppointment(app, doctor.id, "COMPLETED", booking.id);

    const res = await app.inject({
      method: "DELETE",
      url: `/api/v1/admin/telehealth/appointments/${appointment.id}`,
      headers: authHeader(adminToken),
      payload: { confirm: true },
    });
    expect(res.statusCode).toBe(204);
    expect(await app.prisma.appointmentBooking.findUnique({ where: { id: booking.id } })).toBeNull();

    const held = await createUnpaidAppointment(app, doctor.id, "COMPLETED");
    await app.prisma.appointment.update({ where: { id: held.id }, data: { startedAt: new Date() } });
    const blocked = await app.inject({
      method: "DELETE",
      url: `/api/v1/admin/telehealth/appointments/${held.id}`,
      headers: authHeader(adminToken),
      payload: { confirm: true },
    });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().error.details.blockers).toEqual(["CONSULTATION_HELD"]);
  });

  it("A4 — admin doktor CV alanlarını günceller: aboutHtml sanitize edilir, audit'e yalnızca alan adları yazılır, geçersiz saat dilimi 422", async () => {
    const doctor = await createDoctor(app);
    const url = `/api/v1/admin/telehealth/doctors/${doctor.id}`;

    const res = await app.inject({
      method: "PATCH",
      url,
      headers: authHeader(adminToken),
      payload: {
        subSpecialty: "Girişimsel Kardiyoloji",
        aboutHtml: "<p>Uzun biyografi</p><script>alert(1)</script>",
        practiceStartYear: 2005,
        cvEntries: [{ kind: "EDUCATION", title: "Tıp Fakültesi", organization: "İÜ", startYear: 1998, endYear: 2004 }],
        publications: [{ kind: "NATIONAL_ARTICLE", title: "Bir makale", venue: "Türk Kardiyoloji Dergisi", year: 2020 }],
        languages: ["tr", "en"],
        timeZone: "Europe/Berlin",
      },
    });
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data.subSpecialty).toBe("Girişimsel Kardiyoloji");
    expect(data.aboutHtml).toContain("Uzun biyografi");
    expect(data.aboutHtml).not.toContain("<script");
    expect(data.cvEntries).toHaveLength(1);
    expect(data.publications).toHaveLength(1);
    expect(data.timeZone).toBe("Europe/Berlin");

    const audit = await app.prisma.auditLog.findFirst({ where: { action: "telehealth.doctor.updated", targetId: doctor.id } });
    expect(audit).not.toBeNull();
    expect((audit!.metadata as { fields: string[] }).fields).toEqual(
      expect.arrayContaining(["aboutHtml", "cvEntries", "practiceStartYear", "publications", "subSpecialty"])
    );
    expect(JSON.stringify(audit!.metadata)).not.toContain("Uzun biyografi");

    const badTz = await app.inject({ method: "PATCH", url, headers: authHeader(adminToken), payload: { timeZone: "UTC+3" } });
    expect(badTz.statusCode).toBe(422);
  });
});
