import crypto from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestApp } from "../helpers/build-test-app";
import { resetDatabase } from "../helpers/reset-db";
import { registerTestUser } from "../helpers/auth";

/**
 * Paket P (İş 2) — doktor izin/istisna günleri:
 *  - izin aralığı public slotlardan düşülür; haftalık kural/dolu/geçmiş kuralları aynen
 *  - onaylı randevu olan aralığa izin eklemek ENGELLENMEZ: yanıtta çakışmalar listelenir, randevuya dokunulmaz
 *  - doktor kendi portalından, admin doktor adına ekler; başka doktorun kaydı 404; EDITOR 403
 *  - iç not public uçlara dönmez
 */
const VALID_TEST_IDENTITY = { citizenshipType: "TR" as const, identityNumber: "10000000146", birthDate: "1990-01-01" };

/** n hafta sonraki Pazartesi (UTC 00:00) — Europe/Istanbul 09:00 = 06:00Z. */
function mondayInWeeks(n: number): Date {
  const now = new Date();
  const daysUntilMonday = (8 - now.getUTCDay()) % 7 || 7;
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + daysUntilMonday + 7 * n));
}
const isoDate = (d: Date) => d.toISOString().slice(0, 10);
const at = (day: Date, hourUtc: number) => new Date(day.getTime() + hourUtc * 3600_000);

describe("Paket P — doktor izinleri", () => {
  let app: FastifyInstance;
  let adminAuth: { authorization: string };
  let doctorId: string;
  let doctorSlug: string;
  let doctorAuth: { authorization: string };
  let otherDoctorTimeOffId: string;

  async function createUser(role: "USER" | "EDITOR", twoFactor = false) {
    const { hashPassword } = await import("../../src/lib/password");
    const user = await app.prisma.user.create({
      data: {
        email: `to-${crypto.randomUUID()}@example.com`,
        name: "Kullanıcı",
        passwordHash: await hashPassword("Sifre12345!"),
        role,
        status: "ACTIVE",
        emailVerifiedAt: new Date(),
      },
    });
    const login = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email: user.email, password: "Sifre12345!" } });
    const token = login.json().data.tokens.accessToken as string;
    if (twoFactor) await app.prisma.user.update({ where: { id: user.id }, data: { twoFactorEnabled: true } });
    return { user, auth: { authorization: `Bearer ${token}` } };
  }

  beforeAll(async () => {
    app = await buildTestApp();
    await resetDatabase(app.prisma);
    await app.prisma.siteModule.upsert({ where: { key: "telehealth" }, create: { key: "telehealth", enabled: true }, update: { enabled: true } });
    const admin = await registerTestUser(app);
    adminAuth = { authorization: `Bearer ${admin.accessToken}` };

    const doctorUser = await createUser("USER", true);
    doctorAuth = doctorUser.auth;
    // Ücretsiz doktor → randevu anında onaylanır (SCHEDULED), çakışma testi için.
    const doctor = await app.prisma.doctorProfile.create({
      data: {
        title: "Dr.",
        fullName: "İzinli Doktor",
        slug: `izinli-${crypto.randomUUID()}`,
        bio: "Test",
        languages: ["en"],
        timeZone: "Europe/Istanbul",
        sessionDurationMin: 30,
        sessionPriceCents: null,
        isActive: true,
        userId: doctorUser.user.id,
      },
    });
    await app.prisma.doctorAvailability.create({ data: { doctorId: doctor.id, dayOfWeek: 1, startMinute: 540, endMinute: 660, isActive: true } });
    doctorId = doctor.id;
    doctorSlug = doctor.slug;

    const other = await app.prisma.doctorProfile.create({
      data: { title: "Dr.", fullName: "Diğer", slug: `diger-${crypto.randomUUID()}`, bio: "x", languages: ["en"], timeZone: "Europe/Istanbul", isActive: true },
    });
    const otherOff = await app.prisma.doctorTimeOff.create({
      data: { doctorId: other.id, startsAt: at(mondayInWeeks(3), 0), endsAt: at(mondayInWeeks(3), 24), kind: "VACATION" },
    });
    otherDoctorTimeOffId = otherOff.id;
  });

  afterAll(async () => {
    await resetDatabase(app.prisma);
    await app.close();
  });

  const slotsFor = async (day: Date) =>
    (await app.inject({ method: "GET", url: `/api/v1/doctors/${doctorSlug}/slots?from=${isoDate(day)}&to=${isoDate(day)}` })).json().data as { startsAt: string }[];

  it("admin doktor adına tam gün izin ekler → o günün slotları düşer, diğer haftaki aynı gün etkilenmez; not public'te yok", async () => {
    const day = mondayInWeeks(1);
    expect((await slotsFor(day)).length).toBe(4); // 09:00–11:00, 30 dk
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/admin/telehealth/doctors/${doctorId}/time-off`,
      headers: adminAuth,
      payload: { startsAt: at(day, -3).toISOString(), endsAt: at(day, 21).toISOString(), kind: "CONGRESS", allDay: true, note: "Kongre — Viyana" },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().data).toMatchObject({ kind: "CONGRESS", allDay: true, note: "Kongre — Viyana", conflicts: [] });
    expect(await slotsFor(day)).toEqual([]);
    expect((await slotsFor(mondayInWeeks(2))).length).toBe(4);

    const publicDoctor = await app.inject({ method: "GET", url: `/api/v1/doctors/${doctorSlug}` });
    expect(JSON.stringify(publicDoctor.json())).not.toContain("Viyana");
    // "En erken uygun randevu": izinli gün atlanır (bu haftaki Pazartesi 09:00 TSİ); liste ucunda da aynı.
    expect(publicDoctor.json().data.earliestAvailableAt).toBe(at(mondayInWeeks(0), 6).toISOString());
    const list = (await app.inject({ method: "GET", url: "/api/v1/doctors" })).json().data as { slug: string; earliestAvailableAt: string | null }[];
    expect(list.find((d) => d.slug === doctorSlug)!.earliestAvailableAt).toBe(at(mondayInWeeks(0), 6).toISOString());
  });

  it("saat aralığı izni yalnızca kesişen slotları düşer", async () => {
    const day = mondayInWeeks(4);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/doctor/time-off",
      headers: doctorAuth,
      payload: { startsAt: at(day, 6.5).toISOString(), endsAt: at(day, 7.5).toISOString(), kind: "SURGERY_DAY" },
    });
    expect(res.statusCode).toBe(201);
    const remaining = (await slotsFor(day)).map((s) => s.startsAt);
    expect(remaining).toEqual([at(day, 6).toISOString(), at(day, 7.5).toISOString()]);
  });

  it("onaylı randevu olan güne izin: kayıt engellenmez, çakışma listelenir, randevuya dokunulmaz", async () => {
    const day = mondayInWeeks(5);
    const booking = await app.inject({
      method: "POST",
      url: "/api/v1/appointments/bookings",
      payload: {
        doctorSlug,
        slots: [at(day, 6).toISOString()],
        patientName: "Ayşe Hasta",
        patientEmail: `hasta-${crypto.randomUUID()}@example.com`,
        identity: VALID_TEST_IDENTITY,
        consent: true,
      },
    });
    expect(booking.statusCode).toBe(201);
    const appointmentId = booking.json().data.appointments[0].id as string;
    expect((await app.prisma.appointment.findUniqueOrThrow({ where: { id: appointmentId } })).status).toBe("SCHEDULED");

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/doctor/time-off",
      headers: doctorAuth,
      payload: { startsAt: at(day, 0).toISOString(), endsAt: at(day, 24).toISOString(), kind: "VACATION", allDay: true },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().data.conflicts).toEqual([expect.objectContaining({ appointmentId, patientName: "Ayşe Hasta" })]);
    const after = await app.prisma.appointment.findUniqueOrThrow({ where: { id: appointmentId } });
    expect(after.status).toBe("SCHEDULED");
    expect(after.startsAt.toISOString()).toBe(at(day, 6).toISOString());

    const list = await app.inject({ method: "GET", url: "/api/v1/doctor/time-off", headers: doctorAuth });
    expect(list.json().data.find((t: { id: string }) => t.id === res.json().data.id).conflicts).toHaveLength(1);
  });

  it("izinli saate API'den doğrudan rezervasyon 409 SLOT_TAKEN (hiçbir kayıt oluşmaz); izin dışı saat çalışır; admin yeniden planlama da izne düşemez", async () => {
    const day = mondayInWeeks(8);
    // 09:00–10:00 TSİ (06:00–07:00Z) izin; slotlar 09:00, 09:30, 10:00, 10:30.
    await app.prisma.doctorTimeOff.create({ data: { doctorId, startsAt: at(day, 6), endsAt: at(day, 7), kind: "SURGERY_DAY", note: "iç not" } });
    const book = (slots: Date[]) =>
      app.inject({
        method: "POST",
        url: "/api/v1/appointments/bookings",
        payload: {
          doctorSlug,
          slots: slots.map((s) => s.toISOString()),
          patientName: "Can Hasta",
          patientEmail: `hasta-${crypto.randomUUID()}@example.com`,
          identity: VALID_TEST_IDENTITY,
          consent: true,
        },
      });
    const bookingsBefore = await app.prisma.appointmentBooking.count();

    const blocked = await book([at(day, 6)]);
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().error.code).toBe("SLOT_TAKEN");
    expect(blocked.json().error.message).not.toContain("iç not");
    // Çoklu slotta biri izinliyse hiçbiri oluşmaz (kısmi rezervasyon yok).
    expect((await book([at(day, 6.5), at(day, 7)])).statusCode).toBe(409);
    expect(await app.prisma.appointmentBooking.count()).toBe(bookingsBefore);

    const okRes = await book([at(day, 7)]);
    expect(okRes.statusCode).toBe(201);
    const appointmentId = okRes.json().data.appointments[0].id as string;

    const reschedule = (newStartTime: string) =>
      app.inject({
        method: "PATCH",
        url: `/api/v1/admin/telehealth/appointments/${appointmentId}/reschedule`,
        headers: adminAuth,
        payload: { newDate: isoDate(day), newStartTime },
      });
    const intoTimeOff = await reschedule("09:30");
    expect(intoTimeOff.statusCode).toBe(409);
    expect(intoTimeOff.json().error.code).toBe("APPOINTMENT_RESCHEDULE_CONFLICT");
    expect((await app.prisma.appointment.findUniqueOrThrow({ where: { id: appointmentId } })).startsAt.toISOString()).toBe(at(day, 7).toISOString());
    expect((await reschedule("10:30")).statusCode).toBe(200);
  });

  it("doğrulama: bitiş ≤ başlangıç, bilinmeyen tür, uzun not → 422; başka doktorun kaydı 404; EDITOR 403", async () => {
    const day = mondayInWeeks(6);
    const base = { startsAt: at(day, 10).toISOString(), endsAt: at(day, 9).toISOString(), kind: "VACATION" };
    expect((await app.inject({ method: "POST", url: "/api/v1/doctor/time-off", headers: doctorAuth, payload: base })).statusCode).toBe(422);
    expect(
      (await app.inject({ method: "POST", url: "/api/v1/doctor/time-off", headers: doctorAuth, payload: { ...base, endsAt: at(day, 11).toISOString(), kind: "PARTY" } })).statusCode
    ).toBe(422);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/v1/doctor/time-off",
          headers: doctorAuth,
          payload: { ...base, endsAt: at(day, 11).toISOString(), note: "x".repeat(501) },
        })
      ).statusCode
    ).toBe(422);
    expect((await app.inject({ method: "DELETE", url: `/api/v1/doctor/time-off/${otherDoctorTimeOffId}`, headers: doctorAuth })).statusCode).toBe(404);
    const editor = await createUser("EDITOR");
    expect(
      (await app.inject({ method: "POST", url: `/api/v1/admin/telehealth/doctors/${doctorId}/time-off`, headers: editor.auth, payload: { ...base, endsAt: at(day, 11).toISOString() } })).statusCode
    ).toBe(403);
  });

  it("doktor portalı haftalık saatleri tek ekranda okur/değiştirir; izin silinince slotlar geri gelir", async () => {
    const put = await app.inject({
      method: "PUT",
      url: "/api/v1/doctor/availability",
      headers: doctorAuth,
      payload: { rules: [{ dayOfWeek: 1, startMinute: 540, endMinute: 600 }] },
    });
    expect(put.statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/api/v1/doctor/availability", headers: doctorAuth })).json().data).toHaveLength(1);
    const day = mondayInWeeks(7);
    expect((await slotsFor(day)).length).toBe(2);
    const off = await app.inject({
      method: "POST",
      url: "/api/v1/doctor/time-off",
      headers: doctorAuth,
      payload: { startsAt: at(day, 0).toISOString(), endsAt: at(day, 24).toISOString(), kind: "OTHER" },
    });
    expect(await slotsFor(day)).toEqual([]);
    expect((await app.inject({ method: "DELETE", url: `/api/v1/doctor/time-off/${off.json().data.id}`, headers: doctorAuth })).statusCode).toBe(204);
    expect((await slotsFor(day)).length).toBe(2);
  });
});
