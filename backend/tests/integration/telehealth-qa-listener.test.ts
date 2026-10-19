import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { resetDatabase } from "../helpers/reset-db";

/**
 * Paket C (2026-10-18) — ADMIN kalite kontrol dinleyicisi:
 * `POST /admin/telehealth/appointments/{id}/listener-token`, `.../listener-sessions/{sessionId}/leave`,
 * `GET .../listener-history`. LiveKit sahte config ile (`telehealth-livekit.test.ts` İLE AYNI desen —
 * token imzalama yereldir, ağ çağrısı yoktur; `LIVEKIT_INTERNAL_URL` boş olduğundan
 * `removeRoomParticipant` sessizce atlanır).
 */

const FAKE_SECRET = "fake-api-secret-for-tests-only";

// Uç başına IP bazlı hız sınırı (5/dk) testler arasında birikmesin — `contact-page.test.ts` deseni.
let ipCounter = 0;
function nextIp() {
  ipCounter += 1;
  return `10.20.${Math.floor(ipCounter / 250)}.${(ipCounter % 250) + 1}`;
}

function authHeader(token: string) {
  return { authorization: `Bearer ${token}` };
}

type ListenerClaims = {
  sub: string;
  name?: string;
  metadata?: string;
  exp: number;
  nbf?: number;
  video: { roomJoin?: boolean; room?: string; canSubscribe?: boolean; canPublish?: boolean; canPublishData?: boolean; hidden?: boolean };
};

describe("telehealth/qa-listener — ADMIN kalite kontrol dinleyicisi", () => {
  let app: FastifyInstance;

  async function createUserDirect(role: "ADMIN" | "MANAGER" | "USER") {
    const { hashPassword } = await import("../../src/lib/password");
    return app.prisma.user.create({
      data: {
        email: `qa-listener-${crypto.randomUUID()}@example.com`,
        name: "Test Kullanıcı",
        passwordHash: await hashPassword("Sifre12345!"),
        role,
        status: "ACTIVE",
        emailVerifiedAt: new Date(),
      },
    });
  }

  /** `/auth/login`'in hız sınırına takılmamak için access token doğrudan imzalanır (`authenticate` kullanıcıyı yine DB'den okur). */
  async function loginAs(user: { id: string; email: string }): Promise<string> {
    const { signAccessToken } = await import("../../src/lib/jwt");
    return signAccessToken({ sub: user.id, email: user.email }).token;
  }

  /** Giriş 2FA'sız yapılır, ardından bayrak DB'de açılır — `authenticate` ve rota kontrolü DB'den taze okur. */
  async function createAdmin({ twoFactor }: { twoFactor: boolean }) {
    const user = await createUserDirect("ADMIN");
    const token = await loginAs(user);
    if (twoFactor) await app.prisma.user.update({ where: { id: user.id }, data: { twoFactorEnabled: true } });
    return { user, token };
  }

  async function createAppointment(status: "SCHEDULED" | "IN_PROGRESS" | "COMPLETED", doctorUserId: string | null = null) {
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
        userId: doctorUserId,
      },
    });
    const rawAccessToken = generateOpaqueToken();
    const startsAt = new Date();
    const startedAt = status === "SCHEDULED" ? null : new Date(startsAt.getTime() - 60_000);
    const appointment = await app.prisma.appointment.create({
      data: {
        doctorId: doctor.id,
        patientName: "Test Hasta",
        patientEmail: `hasta-${crypto.randomUUID()}@example.com`,
        startsAt,
        endsAt: new Date(startsAt.getTime() + 30 * 60_000),
        priceCents: 50000,
        currency: "TRY",
        meetingRoomName: `room_${crypto.randomBytes(16).toString("hex")}`,
        accessTokenHash: hashToken(rawAccessToken),
        status,
        startedAt,
      },
    });
    return { appointment, doctor, rawAccessToken };
  }

  function requestListenerToken(appointmentId: string, token: string, reason = "Rutin kalite kontrol örneklemi") {
    return app.inject({
      method: "POST",
      url: `/api/v1/admin/telehealth/appointments/${appointmentId}/listener-token`,
      headers: authHeader(token),
      remoteAddress: nextIp(),
      payload: { reason },
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

  it("2FA'lı ADMIN, IN_PROGRESS görüşme için yalnızca dinleme yetkili, görünür bir token alır", async () => {
    const admin = await createAdmin({ twoFactor: true });
    const { appointment } = await createAppointment("IN_PROGRESS");

    const res = await requestListenerToken(appointment.id, admin.token);
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data.roomName).toBe(appointment.meetingRoomName);
    expect(data.sessionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.stringify(res.json())).not.toContain(FAKE_SECRET);

    const claims = jwt.verify(data.token, FAKE_SECRET) as ListenerClaims;
    expect(claims.sub).toBe(`qa-listener-${admin.user.id}`);
    expect(claims.name).toBe("WM Health – Kalite Kontrol");
    expect(JSON.parse(claims.metadata ?? "{}")).toEqual({ role: "qa_listener" });
    expect(claims.video.roomJoin).toBe(true);
    expect(claims.video.room).toBe(appointment.meetingRoomName);
    expect(claims.video.canSubscribe).toBe(true);
    expect(claims.video.canPublish).toBe(false);
    expect(claims.video.canPublishData).toBe(false);
    // Gizli katılım YOK.
    expect(claims.video.hidden).toBeUndefined();
    // Kısa TTL — 10 dk.
    expect(claims.exp - Math.floor(Date.now() / 1000)).toBeLessThanOrEqual(10 * 60);
  });

  it("dinleyici token'ı görüşme durumunu/başlangıç zamanını değiştirmez (katılım mantığı dinleyiciyi saymaz)", async () => {
    const admin = await createAdmin({ twoFactor: true });
    const { appointment } = await createAppointment("IN_PROGRESS");

    const res = await requestListenerToken(appointment.id, admin.token);
    expect(res.statusCode).toBe(200);

    const after = await app.prisma.appointment.findUniqueOrThrow({ where: { id: appointment.id } });
    expect(after.status).toBe("IN_PROGRESS");
    expect(after.startedAt?.toISOString()).toBe(appointment.startedAt?.toISOString());
    expect(after.endedAt).toBeNull();
    // Hasta/doktor token audit'i yazılmaz — dinleyici "katılımcı" olarak sayılmaz.
    const meetingAudit = await app.prisma.auditLog.count({ where: { action: "telehealth.meeting_token.issued", targetId: appointment.id } });
    expect(meetingAudit).toBe(0);
  });

  it("IN_PROGRESS dışındaki görüşmeler için 409 QA_LISTENER_NOT_ALLOWED döner", async () => {
    const admin = await createAdmin({ twoFactor: true });
    for (const status of ["SCHEDULED", "COMPLETED"] as const) {
      const { appointment } = await createAppointment(status);
      const res = await requestListenerToken(appointment.id, admin.token);
      expect(res.statusCode).toBe(409);
      expect(res.json().error.code).toBe("QA_LISTENER_NOT_ALLOWED");
      const unchanged = await app.prisma.appointment.findUniqueOrThrow({ where: { id: appointment.id } });
      expect(unchanged.status).toBe(status);
    }
  });

  it("2FA'sı kapalı ADMIN 403 TWO_FACTOR_REQUIRED alır", async () => {
    const admin = await createAdmin({ twoFactor: false });
    const { appointment } = await createAppointment("IN_PROGRESS");
    const res = await requestListenerToken(appointment.id, admin.token);
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("TWO_FACTOR_REQUIRED");
  });

  it("MANAGER ve doktor (2FA'lı olsalar bile) dinleyici token'ı alamaz; anonim 401", async () => {
    const manager = await createUserDirect("MANAGER");
    const managerToken = await loginAs(manager);
    await app.prisma.user.update({ where: { id: manager.id }, data: { twoFactorEnabled: true } });

    const doctorUser = await createUserDirect("USER");
    const doctorToken = await loginAs(doctorUser);
    await app.prisma.user.update({ where: { id: doctorUser.id }, data: { twoFactorEnabled: true } });
    const { appointment } = await createAppointment("IN_PROGRESS", doctorUser.id);

    expect((await requestListenerToken(appointment.id, managerToken)).statusCode).toBe(403);
    expect((await requestListenerToken(appointment.id, doctorToken)).statusCode).toBe(403);
    const anon = await app.inject({
      method: "POST",
      url: `/api/v1/admin/telehealth/appointments/${appointment.id}/listener-token`,
      payload: { reason: "Rutin kalite kontrol örneklemi" },
    });
    expect(anon.statusCode).toBe(401);

    const history = await app.inject({
      method: "GET",
      url: `/api/v1/admin/telehealth/appointments/${appointment.id}/listener-history`,
      headers: authHeader(managerToken),
    });
    expect(history.statusCode).toBe(403);
    expect(await app.prisma.auditLog.count({ where: { action: "telehealth.qa_listener.joined", targetId: appointment.id } })).toBe(0);
  });

  it("gerekçe zorunlu (en az 10 karakter); yoksa 422/400 ve token üretilmez", async () => {
    const admin = await createAdmin({ twoFactor: true });
    const { appointment } = await createAppointment("IN_PROGRESS");
    const res = await requestListenerToken(appointment.id, admin.token, "   kısa   ");
    expect([400, 422]).toContain(res.statusCode);
    expect(await app.prisma.auditLog.count({ where: { action: "telehealth.qa_listener.joined", targetId: appointment.id } })).toBe(0);
  });

  it("katılım ve ayrılış audit log'a yazılır (admin, randevu, gerekçe, giriş/çıkış); ayrılış idempotent; geçmiş döner", async () => {
    const admin = await createAdmin({ twoFactor: true });
    const otherAdmin = await createAdmin({ twoFactor: true });
    const { appointment } = await createAppointment("IN_PROGRESS");

    const tokenRes = await requestListenerToken(appointment.id, admin.token, "Şikâyet sonrası ses kalitesi kontrolü");
    expect(tokenRes.statusCode).toBe(200);
    const { sessionId } = tokenRes.json().data as { sessionId: string };

    const joined = await app.prisma.auditLog.findFirstOrThrow({ where: { action: "telehealth.qa_listener.joined", targetId: appointment.id } });
    expect(joined.actorId).toBe(admin.user.id);
    expect(joined.actorEmail).toBe(admin.user.email);
    expect(joined.targetType).toBe("Appointment");
    const joinedMeta = joined.metadata as Record<string, unknown>;
    expect(joinedMeta.sessionId).toBe(sessionId);
    expect(joinedMeta.reason).toBe("Şikâyet sonrası ses kalitesi kontrolü");
    // Token/secret audit'e yazılmaz.
    expect(JSON.stringify(joined)).not.toContain(tokenRes.json().data.token);
    expect(JSON.stringify(joined)).not.toContain(FAKE_SECRET);

    const leaveUrl = `/api/v1/admin/telehealth/appointments/${appointment.id}/listener-sessions/${sessionId}/leave`;
    // Başka bir admin bu oturumu kapatamaz.
    expect((await app.inject({ method: "POST", url: leaveUrl, headers: authHeader(otherAdmin.token) })).statusCode).toBe(404);

    expect((await app.inject({ method: "POST", url: leaveUrl, headers: authHeader(admin.token) })).statusCode).toBe(204);
    expect((await app.inject({ method: "POST", url: leaveUrl, headers: authHeader(admin.token) })).statusCode).toBe(204);
    const left = await app.prisma.auditLog.findMany({ where: { action: "telehealth.qa_listener.left", targetId: appointment.id } });
    expect(left).toHaveLength(1);
    expect((left[0]!.metadata as Record<string, unknown>).sessionId).toBe(sessionId);

    const history = await app.inject({
      method: "GET",
      url: `/api/v1/admin/telehealth/appointments/${appointment.id}/listener-history`,
      headers: authHeader(admin.token),
    });
    expect(history.statusCode).toBe(200);
    const entries = history.json().data as Array<{ sessionId: string; adminEmail: string; reason: string; joinedAt: string; leftAt: string | null }>;
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ sessionId, adminEmail: admin.user.email, reason: "Şikâyet sonrası ses kalitesi kontrolü" });
    expect(entries[0]!.leftAt).not.toBeNull();
  });

  it("audit kaydı yazılamazsa token DÖNMEZ (kayıtsız dinleme yok — fail-closed)", async () => {
    const admin = await createAdmin({ twoFactor: true });
    const { appointment } = await createAppointment("IN_PROGRESS");
    const spy = vi.spyOn(app.prisma.auditLog, "create").mockRejectedValueOnce(new Error("db down"));
    try {
      const res = await requestListenerToken(appointment.id, admin.token);
      expect(res.statusCode).toBe(500);
      expect(res.body).not.toContain("eyJ");
    } finally {
      spy.mockRestore();
    }
  });

  it("KIRMIZI ÇİZGİ — hasta meeting-token'ı DEĞİŞMEDİ: yayın yetkili, `patient:` kimlikli, dinleyici metadata'sı yok", async () => {
    const { appointment, rawAccessToken } = await createAppointment("IN_PROGRESS");
    const res = await app.inject({ method: "POST", url: `/api/v1/appointments/${appointment.id}/meeting-token?t=${rawAccessToken}` });
    expect(res.statusCode).toBe(200);
    const claims = jwt.verify(res.json().data.token, FAKE_SECRET) as ListenerClaims;
    expect(claims.sub).toBe(`patient:${appointment.id}`);
    expect(claims.video.canPublish).toBe(true);
    expect(claims.video.canPublishData).toBe(true);
    expect(claims.metadata ?? "").not.toContain("qa_listener");
  });
});
