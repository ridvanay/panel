import crypto from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestApp } from "../helpers/build-test-app";
import { resetDatabase } from "../helpers/reset-db";
import {
  QA_LISTENER_MAX_REMOVE_ATTEMPTS,
  QA_LISTENER_STRAY_REMOVED_ACTION,
  runQaListenerSweep,
  type QaListenerSweepDeps,
} from "../../src/modules/telehealth/lib/qa-listener-sweeper";

/**
 * Paket G (2026-10-19) — QA dinleyici temizleyicisi. LiveKit Server API sahte bağımlılıklarla
 * (`deps`) değiştirilir; oturumlar `telehealth.qa_listener.joined` audit satırlarıyla kurulur.
 * EN KRİTİK kural: hasta (`patient:`) ve doktor (`doctor:`) katılımcıları ASLA atılmaz.
 */

const JOINED = "telehealth.qa_listener.joined";
const LEFT = "telehealth.qa_listener.left";

describe("QA dinleyici temizleyicisi (Paket G)", () => {
  let app: FastifyInstance;
  let roomParticipants: Map<string, string[]>;
  let removeCalls: Array<{ roomName: string; identity: string }>;
  let deps: QaListenerSweepDeps;

  async function createAdmin(opts: { twoFactor?: boolean; status?: "ACTIVE" | "SUSPENDED"; role?: "ADMIN" | "MANAGER" } = {}) {
    return app.prisma.user.create({
      data: {
        email: `sweeper-${crypto.randomUUID()}@example.com`,
        name: "Admin",
        passwordHash: "x",
        role: opts.role ?? "ADMIN",
        status: opts.status ?? "ACTIVE",
        emailVerifiedAt: new Date(),
        twoFactorEnabled: opts.twoFactor ?? true,
      },
    });
  }

  async function createAppointment(status: "IN_PROGRESS" | "COMPLETED" = "IN_PROGRESS") {
    const specialty = await app.prisma.specialty.create({
      data: { name: `Uzmanlık ${crypto.randomUUID()}`, slug: `uzmanlik-${crypto.randomUUID()}`, icon: "heart-pulse" },
    });
    const doctor = await app.prisma.doctorProfile.create({
      data: {
        title: "Dr.",
        fullName: `Doktor ${crypto.randomUUID()}`,
        slug: `doktor-${crypto.randomUUID()}`,
        bio: "Test",
        languages: ["tr"],
        timeZone: "Europe/Istanbul",
        specialtyId: specialty.id,
        sessionDurationMin: 30,
        sessionPriceCents: 50000,
        currency: "TRY",
        isActive: true,
      },
    });
    return app.prisma.appointment.create({
      data: {
        doctorId: doctor.id,
        patientName: "Hasta",
        patientEmail: `hasta-${crypto.randomUUID()}@example.com`,
        startsAt: new Date(),
        endsAt: new Date(Date.now() + 30 * 60_000),
        priceCents: 50000,
        currency: "TRY",
        meetingRoomName: `room_${crypto.randomBytes(8).toString("hex")}`,
        accessTokenHash: crypto.randomBytes(16).toString("hex"),
        status,
      },
    });
  }

  async function openSession(admin: { id: string; email: string }, appointment: { id: string; meetingRoomName: string }, minutesAgo = 5) {
    const sessionId = crypto.randomUUID();
    const identity = `qa-listener-${admin.id}-${sessionId.slice(0, 8)}`;
    await app.prisma.auditLog.create({
      data: {
        actorId: admin.id,
        actorEmail: admin.email,
        action: JOINED,
        targetType: "Appointment",
        targetId: appointment.id,
        metadata: { sessionId, reason: "Test gerekçesi", identity, roomName: appointment.meetingRoomName },
        createdAt: new Date(Date.now() - minutesAgo * 60_000),
      },
    });
    const list = roomParticipants.get(appointment.meetingRoomName) ?? [];
    roomParticipants.set(appointment.meetingRoomName, [...list, identity]);
    return { sessionId, identity };
  }

  function leftRow(sessionId: string) {
    return app.prisma.auditLog.findFirst({ where: { action: LEFT, metadata: { path: ["sessionId"], equals: sessionId } } });
  }

  beforeAll(async () => {
    app = await buildTestApp();
    await resetDatabase(app.prisma);
  });

  afterAll(async () => {
    await resetDatabase(app.prisma);
    await app.close();
  });

  beforeEach(async () => {
    await app.prisma.auditLog.deleteMany({ where: { action: { in: [JOINED, LEFT, QA_LISTENER_STRAY_REMOVED_ACTION] } } });
    roomParticipants = new Map();
    removeCalls = [];
    deps = {
      listParticipants: vi.fn(async (roomName: string) => roomParticipants.get(roomName) ?? []),
      removeParticipant: vi.fn(async (roomName: string, identity: string) => {
        removeCalls.push({ roomName, identity });
        roomParticipants.set(roomName, (roomParticipants.get(roomName) ?? []).filter((id) => id !== identity));
        return true;
      }),
    };
  });

  it("geçerli oturuma dokunulmaz", async () => {
    const admin = await createAdmin();
    const appointment = await createAppointment();
    const { sessionId } = await openSession(admin, appointment, 10);
    const result = await runQaListenerSweep(app, { deps });
    expect(result.closed).toEqual([]);
    expect(removeCalls).toEqual([]);
    expect(await leftRow(sessionId)).toBeNull();
  });

  it.each([
    ["auto:max_duration", { minutesAgo: 61 }],
    ["auto:appointment_ended", { appointmentStatus: "COMPLETED" as const }],
    ["auto:actor_revoked", { twoFactor: false }],
    ["auto:actor_revoked", { status: "SUSPENDED" as const }],
    ["auto:actor_revoked", { role: "MANAGER" as const }],
  ])("%s — dinleyici odadan atılır ve left kaydı yazılır", async (reason, opts) => {
    const admin = await createAdmin({ twoFactor: opts.twoFactor, status: opts.status, role: opts.role });
    const appointment = await createAppointment(opts.appointmentStatus);
    const { sessionId, identity } = await openSession(admin, appointment, opts.minutesAgo ?? 5);

    const result = await runQaListenerSweep(app, { deps });
    expect(result.closed).toEqual([{ sessionId, reason, removed: true }]);
    expect(removeCalls).toEqual([{ roomName: appointment.meetingRoomName, identity }]);
    const left = await leftRow(sessionId);
    expect(left?.metadata).toMatchObject({ sessionId, reason, removed: true, adminId: admin.id });

    // İdempotent: ikinci tur yeni kayıt yazmaz.
    await runQaListenerSweep(app, { deps });
    expect(await app.prisma.auditLog.count({ where: { action: LEFT, metadata: { path: ["sessionId"], equals: sessionId } } })).toBe(1);
  });

  it("KRİTİK — hasta ve doktor katılımcıları ASLA atılmaz; yalnızca geçerli oturumu olmayan qa-listener- kaçakları atılır", async () => {
    const admin = await createAdmin();
    const appointment = await createAppointment();
    const valid = await openSession(admin, appointment, 5);
    const strayIdentity = `qa-listener-${admin.id}-deadbeef`;
    roomParticipants.set(appointment.meetingRoomName, [`patient:${appointment.id}`, "doctor:d1", valid.identity, strayIdentity]);

    const result = await runQaListenerSweep(app, { deps });
    expect(removeCalls).toEqual([{ roomName: appointment.meetingRoomName, identity: strayIdentity }]);
    expect(result.strayRemoved).toEqual([{ roomName: appointment.meetingRoomName, identity: strayIdentity }]);
    expect(roomParticipants.get(appointment.meetingRoomName)).toEqual([`patient:${appointment.id}`, "doctor:d1", valid.identity]);
    const stray = await app.prisma.auditLog.findFirst({ where: { action: QA_LISTENER_STRAY_REMOVED_ACTION, targetId: appointment.id } });
    expect(stray?.metadata).toMatchObject({ identity: strayIdentity });
  });

  it("KRİTİK — biten görüşmede bile hasta/doktor atılmaz, yalnızca dinleyici", async () => {
    const admin = await createAdmin();
    const appointment = await createAppointment("COMPLETED");
    const { identity } = await openSession(admin, appointment, 5);
    roomParticipants.set(appointment.meetingRoomName, [`patient:${appointment.id}`, "doctor:d1", identity]);
    await runQaListenerSweep(app, { deps });
    expect(removeCalls.map((c) => c.identity)).toEqual([identity]);
  });

  it("atma başarısızsa left yazılmaz, tekrar denenir; deneme sınırında removed:false ile kapanır", async () => {
    const admin = await createAdmin();
    const appointment = await createAppointment("COMPLETED");
    const { sessionId } = await openSession(admin, appointment, 5);
    deps.removeParticipant = vi.fn(async () => {
      throw new Error("LiveKit erişilemiyor");
    });
    const removeFailures = new Map<string, number>();

    for (let i = 1; i < QA_LISTENER_MAX_REMOVE_ATTEMPTS; i += 1) {
      await runQaListenerSweep(app, { deps, removeFailures });
      expect(await leftRow(sessionId)).toBeNull();
    }
    await runQaListenerSweep(app, { deps, removeFailures });
    expect((await leftRow(sessionId))?.metadata).toMatchObject({ reason: "auto:appointment_ended", removed: false });
  });

  it("dinleyici zaten odada değilse (absent) atma çağrılmadan kayıt kapanır; istemci ayrıldıysa dokunulmaz", async () => {
    const admin = await createAdmin();
    const appointment = await createAppointment("COMPLETED");
    const { sessionId } = await openSession(admin, appointment, 5);
    roomParticipants.set(appointment.meetingRoomName, []);
    await runQaListenerSweep(app, { deps });
    expect(removeCalls).toEqual([]);
    expect((await leftRow(sessionId))?.metadata).toMatchObject({ removed: true });

    const second = await openSession(admin, appointment, 5);
    await app.prisma.auditLog.create({
      data: { actorId: admin.id, action: LEFT, targetType: "Appointment", targetId: appointment.id, metadata: { sessionId: second.sessionId } },
    });
    const result = await runQaListenerSweep(app, { deps });
    expect(result.closed).toEqual([]);
  });

  it("LiveKit Server API yapılandırılmamışsa (null) kayıt removed:false ile kapanır, hiçbir şey atılmaz", async () => {
    const admin = await createAdmin();
    const appointment = await createAppointment("COMPLETED");
    const { sessionId } = await openSession(admin, appointment, 5);
    deps.listParticipants = vi.fn(async () => null);
    await runQaListenerSweep(app, { deps });
    expect(removeCalls).toEqual([]);
    expect((await leftRow(sessionId))?.metadata).toMatchObject({ removed: false });
  });
});
