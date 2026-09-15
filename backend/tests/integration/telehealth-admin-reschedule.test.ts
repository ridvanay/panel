import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";

/**
 * NOT — 2026-09-15 (backend-agent görev notu, "Admin randevu yeniden planlama") —
 * `PATCH /admin/telehealth/appointments/{id}/reschedule`. `sendTemplateEmail` gerçek SMTP/DB'ye
 * DOKUNMASIN diye mock'lanır (`tests/unit/telehealth-notifications.test.ts` İLE AYNI desen, ama
 * BU dosyada `buildTestApp()` GERÇEK bir Fastify+Prisma örneği kurduğu için modül-seviyesi mock
 * TÜM app graph'ına uygulanır). `POST /appointments/bookings`'in 5/dk route-level hız sınırı
 * (`telehealth-bookings.test.ts` yorumu İLE AYNI gerekçe) — her `it` TAZE bir `app` ile çalışır
 * (`beforeEach`/`afterEach`), aksi halde bu dosyadaki testlerin TOPLAM booking çağrısı 5'i aşar.
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

async function createUserDirect(app: FastifyInstance, role: "ADMIN" | "MANAGER" | "EDITOR" | "USER") {
  const { hashPassword } = await import("../../src/lib/password");
  const passwordHash = await hashPassword("Sifre12345!");
  return app.prisma.user.create({
    data: {
      email: `telehealth-reschedule-user-${crypto.randomUUID()}@example.com`,
      name: "Test Kullanıcı",
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

/** Europe/Istanbul (2016'dan beri DST GÖZETMEZ, sabit UTC+3) — Pazartesi 09:00-17:00, 30dk seans. */
async function createDoctorWithAvailability(app: FastifyInstance) {
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
      sessionPriceCents: 50000,
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

/** Booking oluşturur + hemen ADMIN ile `mark-paid` çağırır → tek `Appointment` `SCHEDULED` döner. */
async function createScheduledAppointment(app: FastifyInstance, adminToken: string, doctorSlug: string, startsAt: Date) {
  const created = await app.inject({
    method: "POST",
    url: "/api/v1/appointments/bookings",
    payload: bookingPayload(doctorSlug, [startsAt]),
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

  return { bookingId, appointmentId: appointments[0].id as string };
}

describe("PATCH /admin/telehealth/appointments/:id/reschedule", () => {
  let app: FastifyInstance;
  let adminToken: string;

  beforeEach(async () => {
    app = await buildTestApp();
    await resetDatabase(app.prisma);
    await setTelehealthModuleEnabled(app, true);
    const admin = await registerTestUser(app, { email: `telehealth-reschedule-admin-${crypto.randomUUID()}@example.com` });
    adminToken = admin.accessToken;
    sendTemplateEmailMock.mockReset().mockResolvedValue(undefined);
  });

  afterEach(async () => {
    await resetDatabase(app.prisma);
    await app.close();
  });

  it("ADMIN başarıyla reschedule eder — startsAt/endsAt doğru UTC'ye çevrilir (Europe/Istanbul = UTC+3, süre KORUNUR)", async () => {
    const { doctor } = await createDoctorWithAvailability(app);
    const { appointmentId } = await createScheduledAppointment(app, adminToken, doctor.slug, nextMondayNineAmUtc());
    sendTemplateEmailMock.mockClear();

    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/admin/telehealth/appointments/${appointmentId}/reschedule`,
      headers: authHeader(adminToken),
      payload: { newDate: "2026-12-15", newStartTime: "14:30", reason: "Doktorun programı nedeniyle" },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json().data;
    // Europe/Istanbul sabit UTC+3 — 14:30 duvar saati → 11:30 UTC.
    expect(body.startsAt).toBe("2026-12-15T11:30:00.000Z");
    // Süre KORUNUR (30 dk seans).
    expect(body.endsAt).toBe("2026-12-15T12:00:00.000Z");
    expect(body.id).toBe(appointmentId);

    const audit = await app.prisma.auditLog.findFirst({ where: { action: "telehealth.appointment.rescheduled", targetId: appointmentId } });
    expect(audit).not.toBeNull();
    expect(audit?.metadata).toMatchObject({ newStartsAt: "2026-12-15T11:30:00.000Z", reason: "Doktorun programı nedeniyle" });

    // Doktorun bağlı bir User'ı YOK (demo doktor deseni) → e-posta yalnızca hastaya gider.
    expect(sendTemplateEmailMock).toHaveBeenCalledTimes(1);
    const [, purpose, to, values] = sendTemplateEmailMock.mock.calls[0]!;
    expect(purpose).toBe("APPOINTMENT_RESCHEDULED");
    expect(to).toBe(body.patientEmail);
    expect(values.old_slot_summary).toEqual(expect.stringContaining("09:00"));
    expect(values.new_slot_summary).toBe("15.12.2026 14:30");
    expect(values.reason).toBe("Doktorun programı nedeniyle");
  });

  it("doktorun bağlı bir User'ı VARSA e-posta İKİ KEZ gönderilir (hasta + doktor)", async () => {
    const { doctor } = await createDoctorWithAvailability(app);
    const doctorUser = await createUserDirect(app, "USER");
    await app.inject({
      method: "PATCH",
      url: `/api/v1/admin/telehealth/doctors/${doctor.id}`,
      headers: authHeader(adminToken),
      payload: { userId: doctorUser.id },
    });

    const { appointmentId } = await createScheduledAppointment(app, adminToken, doctor.slug, nextMondayNineAmUtc());
    sendTemplateEmailMock.mockClear();

    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/admin/telehealth/appointments/${appointmentId}/reschedule`,
      headers: authHeader(adminToken),
      payload: { newDate: "2026-12-16", newStartTime: "10:00" },
    });
    expect(res.statusCode).toBe(200);

    expect(sendTemplateEmailMock).toHaveBeenCalledTimes(2);
    const recipients = sendTemplateEmailMock.mock.calls.map((call) => call[2]);
    expect(recipients).toContain(doctorUser.email);
    // `reason` gönderilmediyse boş string ("" — undefined DEĞİL) basılır.
    const doctorCall = sendTemplateEmailMock.mock.calls.find((call) => call[2] === doctorUser.email)!;
    expect(doctorCall[3].reason).toBe("");
  });

  it("SMTP/şablon gönderimi BAŞARISIZ olsa da uç YİNE DE 200 döner (best-effort)", async () => {
    const { doctor } = await createDoctorWithAvailability(app);
    const { appointmentId } = await createScheduledAppointment(app, adminToken, doctor.slug, nextMondayNineAmUtc());
    sendTemplateEmailMock.mockClear().mockRejectedValue(new Error("smtp down"));

    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/admin/telehealth/appointments/${appointmentId}/reschedule`,
      headers: authHeader(adminToken),
      payload: { newDate: "2026-12-17", newStartTime: "11:00" },
    });
    expect(res.statusCode).toBe(200);
    expect(sendTemplateEmailMock).toHaveBeenCalledTimes(1);
  });

  it("ÇAKIŞAN bir aktif randevu VARSA 409 APPOINTMENT_RESCHEDULE_CONFLICT, appointment DEĞİŞMEZ", async () => {
    const { doctor } = await createDoctorWithAvailability(app);
    const startsAt = nextMondayNineAmUtc();
    const otherSlot = new Date(startsAt.getTime() + 60 * 60 * 1000); // +1 saat, aynı Pazartesi

    const { appointmentId } = await createScheduledAppointment(app, adminToken, doctor.slug, startsAt);
    const { appointmentId: otherAppointmentId } = await createScheduledAppointment(app, adminToken, doctor.slug, otherSlot);

    const otherAppointment = await app.prisma.appointment.findUniqueOrThrow({ where: { id: otherAppointmentId } });
    // `otherAppointment.startsAt`'ı Europe/Istanbul duvar saatine çevirip AYNI ana reschedule dene.
    const wallHourUtc = otherAppointment.startsAt.getUTCHours() + 3; // sabit UTC+3
    const newDate = otherAppointment.startsAt.toISOString().slice(0, 10);
    const newStartTime = `${String(wallHourUtc).padStart(2, "0")}:${String(otherAppointment.startsAt.getUTCMinutes()).padStart(2, "0")}`;
    sendTemplateEmailMock.mockClear();

    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/admin/telehealth/appointments/${appointmentId}/reschedule`,
      headers: authHeader(adminToken),
      payload: { newDate, newStartTime },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("APPOINTMENT_RESCHEDULE_CONFLICT");

    const unchanged = await app.prisma.appointment.findUniqueOrThrow({ where: { id: appointmentId } });
    expect(unchanged.startsAt).toEqual(startsAt);
    expect(sendTemplateEmailMock).not.toHaveBeenCalled();
  });

  it("kendisiyle çakışma engellenmez — AYNI randevuyu KENDİ orijinal saatine 'reschedule' etmek 409 vermez", async () => {
    const { doctor } = await createDoctorWithAvailability(app);
    const startsAt = nextMondayNineAmUtc();
    const { appointmentId } = await createScheduledAppointment(app, adminToken, doctor.slug, startsAt);

    const newDate = startsAt.toISOString().slice(0, 10);
    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/admin/telehealth/appointments/${appointmentId}/reschedule`,
      headers: authHeader(adminToken),
      payload: { newDate, newStartTime: "09:00" },
    });
    expect(res.statusCode).toBe(200);
  });

  it("MANAGER/EDITOR/USER → 403 (`mark-paid` İLE AYNI eşik, randevu hareketi beyanı)", async () => {
    const managerToken = await loginAs(app, (await createUserDirect(app, "MANAGER")).email);
    const editorToken = await loginAs(app, (await createUserDirect(app, "EDITOR")).email);
    const userToken = await loginAs(app, (await createUserDirect(app, "USER")).email);

    const { doctor } = await createDoctorWithAvailability(app);
    const { appointmentId } = await createScheduledAppointment(app, adminToken, doctor.slug, nextMondayNineAmUtc());

    for (const token of [managerToken, editorToken, userToken]) {
      const res = await app.inject({
        method: "PATCH",
        url: `/api/v1/admin/telehealth/appointments/${appointmentId}/reschedule`,
        headers: authHeader(token),
        payload: { newDate: "2026-12-18", newStartTime: "12:00" },
      });
      expect(res.statusCode).toBe(403);
    }
  });

  it("var olmayan appointment → 404", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/admin/telehealth/appointments/${crypto.randomUUID()}/reschedule`,
      headers: authHeader(adminToken),
      payload: { newDate: "2026-12-18", newStartTime: "12:00" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("geçersiz body (biçim/regex ihlali) → 422", async () => {
    const { doctor } = await createDoctorWithAvailability(app);
    const { appointmentId } = await createScheduledAppointment(app, adminToken, doctor.slug, nextMondayNineAmUtc());

    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/admin/telehealth/appointments/${appointmentId}/reschedule`,
      headers: authHeader(adminToken),
      payload: { newDate: "2026/12/18", newStartTime: "25:99" },
    });
    expect(res.statusCode).toBe(422);
  });
});
