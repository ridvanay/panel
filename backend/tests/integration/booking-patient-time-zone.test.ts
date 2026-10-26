import crypto from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestApp } from "../helpers/build-test-app";
import { resetDatabase } from "../helpers/reset-db";
import { registerTestUser } from "../helpers/auth";

/**
 * Paket P (İş 1) — hastanın saat dilimi: randevu anındaki dilim booking'e yazılır (yalnızca gösterim;
 * rezervasyon kuralları değişmez), DTO'da döner, geçersiz IANA 422; profil tercihi `PATCH /users/me`.
 */
const VALID_TEST_IDENTITY = { citizenshipType: "TR" as const, identityNumber: "10000000146", birthDate: "1990-01-01" };

function nextMondayNineAmUtc(): Date {
  const now = new Date();
  const daysUntilMonday = (8 - now.getUTCDay()) % 7 || 7;
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + daysUntilMonday, 6, 0, 0));
}

describe("Paket P — hasta saat dilimi", () => {
  let app: FastifyInstance;
  let doctorSlug: string;

  beforeAll(async () => {
    app = await buildTestApp();
    await resetDatabase(app.prisma);
    await app.prisma.siteModule.upsert({ where: { key: "telehealth" }, create: { key: "telehealth", enabled: true }, update: { enabled: true } });
    const doctor = await app.prisma.doctorProfile.create({
      data: {
        title: "Dr.",
        fullName: "Saat Dilimi Doktoru",
        slug: `tz-doktor-${crypto.randomUUID()}`,
        bio: "Test",
        languages: ["en"],
        timeZone: "Europe/Istanbul",
        sessionDurationMin: 30,
        sessionPriceCents: 50000,
        isActive: true,
      },
    });
    await app.prisma.doctorAvailability.create({ data: { doctorId: doctor.id, dayOfWeek: 1, startMinute: 540, endMinute: 1020, isActive: true } });
    doctorSlug = doctor.slug;
  });

  afterAll(async () => {
    await resetDatabase(app.prisma);
    await app.close();
  });

  const payload = (slot: Date, extra: Record<string, unknown> = {}) => ({
    doctorSlug,
    slots: [slot.toISOString()],
    patientName: "Hasta",
    patientEmail: `hasta-${crypto.randomUUID()}@example.com`,
    identity: VALID_TEST_IDENTITY,
    consent: true,
    ...extra,
  });

  it("booking oluşturulurken gönderilen dilim kaydedilir ve DTO'da döner; kurallar/fiyat değişmez", async () => {
    const res = await app.inject({ method: "POST", url: "/api/v1/appointments/bookings", payload: payload(nextMondayNineAmUtc(), { patientTimeZone: "Europe/Berlin" }) });
    expect(res.statusCode).toBe(201);
    const body = res.json().data;
    expect(body.totalCents).toBe(50000);
    const row = await app.prisma.appointmentBooking.findUniqueOrThrow({ where: { id: body.bookingId } });
    expect(row.patientTimeZone).toBe("Europe/Berlin");

    const detail = await app.inject({ method: "GET", url: `/api/v1/appointments/bookings/${body.bookingId}?t=${body.accessToken}` });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().data.patientTimeZone).toBe("Europe/Berlin");
  });

  it("dilim gönderilmezse null; geçersiz IANA 422 (randevu oluşmaz)", async () => {
    const slot = new Date(nextMondayNineAmUtc().getTime() + 30 * 60_000);
    const bad = await app.inject({ method: "POST", url: "/api/v1/appointments/bookings", payload: payload(slot, { patientTimeZone: "Mars/Olympus" }) });
    expect(bad.statusCode).toBe(422);
    expect(await app.prisma.appointment.count({ where: { startsAt: slot } })).toBe(0);

    const ok = await app.inject({ method: "POST", url: "/api/v1/appointments/bookings", payload: payload(slot) });
    expect(ok.statusCode).toBe(201);
    const row = await app.prisma.appointmentBooking.findUniqueOrThrow({ where: { id: ok.json().data.bookingId } });
    expect(row.patientTimeZone).toBeNull();
  });

  it("profil tercihi: PATCH /users/me { timeZone } kaydedilir, null ile kaldırılır, geçersiz 422", async () => {
    const { accessToken } = await registerTestUser(app);
    const auth = { authorization: `Bearer ${accessToken}` };
    const set = await app.inject({ method: "PATCH", url: "/api/v1/users/me", headers: auth, payload: { timeZone: "America/New_York" } });
    expect(set.statusCode).toBe(200);
    expect(set.json().data.timeZone).toBe("America/New_York");
    const bad = await app.inject({ method: "PATCH", url: "/api/v1/users/me", headers: auth, payload: { timeZone: "Not/AZone" } });
    expect(bad.statusCode).toBe(422);
    const cleared = await app.inject({ method: "PATCH", url: "/api/v1/users/me", headers: auth, payload: { timeZone: null } });
    expect(cleared.json().data.timeZone).toBeNull();
  });
});
