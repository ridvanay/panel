import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { resetDatabase } from "../helpers/reset-db";

/**
 * Paket E (2026-10-19) — `POST /appointments/{id}/meeting-token`'daki ADMIN kestirmesi kapatıldı.
 * ADMIN rolü tek başına erişim VERMEZ; erişim yalnızca randevunun hastası/doktoru olmak ya da geçerli
 * `?t=` ile. Denetim amaçlı katılım Paket C'nin bildirimli listener-token ucundadır.
 * LiveKit sahte config ile (`telehealth-qa-listener.test.ts` İLE AYNI desen).
 */

const FAKE_SECRET = "fake-api-secret-for-tests-only";

function authHeader(token: string) {
  return { authorization: `Bearer ${token}` };
}

// Uç başına IP bazlı hız sınırı (10/dk) testler arasında birikmesin.
let ipCounter = 0;
function nextIp() {
  ipCounter += 1;
  return `10.30.${Math.floor(ipCounter / 250)}.${(ipCounter % 250) + 1}`;
}

type MeetingClaims = { sub: string; video: { room?: string; canPublish?: boolean; canPublishData?: boolean; canSubscribe?: boolean } };

describe("telehealth/meeting-token — ADMIN kestirmesi kapalı (Paket E)", () => {
  let app: FastifyInstance;

  async function createUser(role: "ADMIN" | "USER") {
    const { hashPassword } = await import("../../src/lib/password");
    const { signAccessToken } = await import("../../src/lib/jwt");
    const user = await app.prisma.user.create({
      data: {
        email: `meeting-admin-${crypto.randomUUID()}@example.com`,
        name: "Test Kullanıcı",
        passwordHash: await hashPassword("Sifre12345!"),
        role,
        status: "ACTIVE",
        emailVerifiedAt: new Date(),
      },
    });
    return { user, token: signAccessToken({ sub: user.id, email: user.email }).token };
  }

  async function createAppointment(overrides: { patientUserId?: string | null; doctorUserId?: string | null } = {}) {
    const { generateOpaqueToken, hashToken } = await import("../../src/lib/tokens");
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
        userId: overrides.doctorUserId ?? null,
      },
    });
    const rawAccessToken = generateOpaqueToken();
    const startsAt = new Date();
    const appointment = await app.prisma.appointment.create({
      data: {
        doctorId: doctor.id,
        patientUserId: overrides.patientUserId ?? null,
        patientName: "Test Hasta",
        patientEmail: `hasta-${crypto.randomUUID()}@example.com`,
        startsAt,
        endsAt: new Date(startsAt.getTime() + 30 * 60_000),
        priceCents: 50000,
        currency: "TRY",
        meetingRoomName: `room_${crypto.randomBytes(16).toString("hex")}`,
        accessTokenHash: hashToken(rawAccessToken),
        status: "SCHEDULED",
      },
    });
    return { appointment, doctor, rawAccessToken };
  }

  function requestMeetingToken(appointmentId: string, opts: { token?: string; t?: string } = {}) {
    return app.inject({
      method: "POST",
      url: `/api/v1/appointments/${appointmentId}/meeting-token${opts.t !== undefined ? `?t=${opts.t}` : ""}`,
      headers: opts.token ? authHeader(opts.token) : {},
      remoteAddress: nextIp(),
    });
  }

  beforeAll(async () => {
    process.env.LIVEKIT_URL = "wss://fake-project.livekit.cloud";
    process.env.LIVEKIT_API_KEY = "fake-api-key";
    process.env.LIVEKIT_API_SECRET = FAKE_SECRET;
    vi.resetModules();

    const { buildApp } = await import("../../src/app");
    app = buildApp();
    await app.ready();
    await resetDatabase(app.prisma);
    await app.prisma.siteModule.upsert({
      where: { key: "telehealth" },
      create: { key: "telehealth", enabled: true },
      update: { enabled: true },
    });
  });

  afterAll(async () => {
    await resetDatabase(app.prisma);
    await app.close();
    delete process.env.LIVEKIT_URL;
    delete process.env.LIVEKIT_API_KEY;
    delete process.env.LIVEKIT_API_SECRET;
    vi.resetModules();
  });

  it("randevuyla ilgisi olmayan ADMIN 404 alır; randevu durumu/startedAt değişmez, token audit'i yazılmaz", async () => {
    const admin = await createUser("ADMIN");
    await app.prisma.user.update({ where: { id: admin.user.id }, data: { twoFactorEnabled: true } });
    const { appointment } = await createAppointment();

    const res = await requestMeetingToken(appointment.id, { token: admin.token });
    expect(res.statusCode).toBe(404);
    expect(JSON.stringify(res.json())).not.toContain("eyJ");

    const after = await app.prisma.appointment.findUniqueOrThrow({ where: { id: appointment.id } });
    expect(after.status).toBe("SCHEDULED");
    expect(after.startedAt).toBeNull();
    expect(await app.prisma.auditLog.count({ where: { action: "telehealth.meeting_token.issued", targetId: appointment.id } })).toBe(0);
  });

  it("randevunun HASTASI olan ADMIN token alır — identity `patient:`, grant'lar değişmedi", async () => {
    const admin = await createUser("ADMIN");
    const { appointment } = await createAppointment({ patientUserId: admin.user.id });

    const res = await requestMeetingToken(appointment.id, { token: admin.token });
    expect(res.statusCode).toBe(200);
    const claims = jwt.verify(res.json().data.token, FAKE_SECRET) as MeetingClaims;
    expect(claims.sub).toBe(`patient:${appointment.id}`);
    expect(claims.video).toMatchObject({ room: appointment.meetingRoomName, canPublish: true, canSubscribe: true, canPublishData: true });

    const audit = await app.prisma.auditLog.findFirstOrThrow({ where: { action: "telehealth.meeting_token.issued", targetId: appointment.id } });
    expect(audit.metadata).toMatchObject({ participantKind: "patient" });
    expect(audit.metadata).not.toHaveProperty("viaAdmin");
  });

  it("randevunun DOKTORU olan kullanıcı (ADMIN olsun olmasın) token alır — identity `doctor:`", async () => {
    for (const role of ["USER", "ADMIN"] as const) {
      const doctorUser = await createUser(role);
      const { appointment, doctor } = await createAppointment({ doctorUserId: doctorUser.user.id });

      const res = await requestMeetingToken(appointment.id, { token: doctorUser.token });
      expect(res.statusCode).toBe(200);
      const claims = jwt.verify(res.json().data.token, FAKE_SECRET) as MeetingClaims;
      expect(claims.sub).toBe(`doctor:${doctor.id}`);
      expect(claims.video.canPublish).toBe(true);
    }
  });

  it("doğru `?t=` ile anonim hasta token alır; yanlış/eksik token 404", async () => {
    const { appointment, rawAccessToken } = await createAppointment();

    const ok = await requestMeetingToken(appointment.id, { t: rawAccessToken });
    expect(ok.statusCode).toBe(200);
    expect((jwt.verify(ok.json().data.token, FAKE_SECRET) as MeetingClaims).sub).toBe(`patient:${appointment.id}`);

    const { appointment: other } = await createAppointment();
    expect((await requestMeetingToken(other.id, { t: "yanlis-token" })).statusCode).toBe(404);
    expect((await requestMeetingToken(other.id)).statusCode).toBe(404);
    // Başka randevunun geçerli token'ı da işe yaramaz.
    expect((await requestMeetingToken(other.id, { t: rawAccessToken })).statusCode).toBe(404);
  });

  it("ilgisiz ADMIN geçerli bir `?t=` taşıyorsa erişim token'dan gelir (rol değil) — davranış korunur", async () => {
    const admin = await createUser("ADMIN");
    const { appointment, rawAccessToken } = await createAppointment();
    const res = await requestMeetingToken(appointment.id, { token: admin.token, t: rawAccessToken });
    expect(res.statusCode).toBe(200);
    expect((jwt.verify(res.json().data.token, FAKE_SECRET) as MeetingClaims).sub).toBe(`patient:${appointment.id}`);
  });
});
