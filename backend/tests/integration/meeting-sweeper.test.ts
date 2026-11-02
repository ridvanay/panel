import crypto from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestApp } from "../helpers/build-test-app";
import { resetDatabase } from "../helpers/reset-db";
import { runMeetingGuestRetention, runMeetingSweep } from "../../src/modules/telehealth/lib/meeting-sweeper";
import type { MeetingRoomDeps } from "../../src/modules/telehealth/lib/meeting-livekit";

/**
 * Paket AG (İş 3) — toplantı süpürücüsü: endsAt + 10 dk'da sunucu tarafında çıkarma, iptal, çıkarılmış misafir,
 * `room_` odalarına DOKUNMAMA, hata durumunda closedAt yazmama, 90 gün misafir adı saklama. LiveKit sahte `deps`.
 */
describe("meeting-sweeper (Paket AG İş 3)", () => {
  let app: FastifyInstance;
  let rooms: Map<string, string[]>;
  let removeCalls: Array<{ roomName: string; identity: string }>;
  let deps: MeetingRoomDeps;
  let hostId: string;
  let unavailable = false;
  let failRemove = false;

  const MIN = 60_000;

  async function seed(opts: { startsMinAgo?: number; durationMin?: number; status?: "SCHEDULED" | "CANCELLED"; roomName?: string; cancelledMinAgo?: number; closedAt?: Date } = {}) {
    const durationMin = opts.durationMin ?? 30;
    const startsAt = new Date(Date.now() - (opts.startsMinAgo ?? 0) * MIN);
    return app.prisma.externalMeeting.create({
      data: {
        hostUserId: hostId,
        title: "Süpürücü toplantısı",
        startsAt,
        endsAt: new Date(startsAt.getTime() + durationMin * MIN),
        durationMin,
        roomName: opts.roomName ?? `meet_${crypto.randomBytes(16).toString("hex")}`,
        status: opts.status ?? "SCHEDULED",
        cancelledAt: opts.status === "CANCELLED" ? new Date(Date.now() - (opts.cancelledMinAgo ?? 1) * MIN) : null,
        closedAt: opts.closedAt ?? null,
      },
    });
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
    await app.prisma.externalMeeting.deleteMany();
    await app.prisma.auditLog.deleteMany();
    await app.prisma.user.deleteMany();
    const host = await app.prisma.user.create({ data: { email: `sw-${crypto.randomUUID()}@example.com`, name: "Host", passwordHash: "x", role: "EDITOR", status: "ACTIVE" } });
    hostId = host.id;
    rooms = new Map();
    removeCalls = [];
    unavailable = false;
    failRemove = false;
    deps = {
      listParticipants: vi.fn(async (roomName: string) => (unavailable ? null : [...(rooms.get(roomName) ?? [])])),
      removeParticipant: vi.fn(async (roomName: string, identity: string) => {
        if (failRemove) throw new Error("livekit down");
        removeCalls.push({ roomName, identity });
        rooms.set(roomName, (rooms.get(roomName) ?? []).filter((id) => id !== identity));
        return true;
      }),
    };
  });

  it("endsAt + 10 dk'dan önce dokunmaz; sonra yalnızca meet-* katılımcılarını atar, closedAt yazar, meeting.closed audit'i düşer", async () => {
    // bitişi 9 dk önce → hâlâ grace içinde
    const withinGrace = await seed({ startsMinAgo: 39, durationMin: 30 });
    rooms.set(withinGrace.roomName, ["meet-host:1", "meet-guest:2"]);
    const noop = await runMeetingSweep(app, { deps });
    expect(noop.closed).toEqual([]);
    expect(removeCalls).toEqual([]);
    expect((await app.prisma.externalMeeting.findUniqueOrThrow({ where: { id: withinGrace.id } })).closedAt).toBeNull();

    // bitişi 11 dk önce → grace aşıldı
    const expired = await seed({ startsMinAgo: 41, durationMin: 30 });
    rooms.set(expired.roomName, ["meet-host:1", "meet-guest:2", "patient:3", "doctor:4", "qa-listener-x"]);
    const result = await runMeetingSweep(app, { deps });
    expect(result.closed).toEqual([{ meetingId: expired.id, reason: "ended", removed: 2, unavailable: false }]);
    expect(removeCalls.map((c) => c.identity).sort()).toEqual(["meet-guest:2", "meet-host:1"]);
    for (const call of removeCalls) expect(call.roomName).toBe(expired.roomName);
    expect(rooms.get(expired.roomName)).toEqual(["patient:3", "doctor:4", "qa-listener-x"]);

    const row = await app.prisma.externalMeeting.findUniqueOrThrow({ where: { id: expired.id } });
    expect(row.closedAt).not.toBeNull();
    const audit = await app.prisma.auditLog.findFirstOrThrow({ where: { action: "meeting.closed", targetId: expired.id } });
    expect(audit).toMatchObject({ actorId: null, ipAddress: null });
    expect(audit.metadata).toMatchObject({ reason: "ended" });

    // ikinci tur: kapalı toplantıya tekrar dokunulmaz
    removeCalls.length = 0;
    await runMeetingSweep(app, { deps });
    expect(removeCalls).toEqual([]);
    expect(await app.prisma.auditLog.count({ where: { action: "meeting.closed", targetId: expired.id } })).toBe(1);
  });

  it("iptal edilen toplantı hemen boşaltılır (reason=cancelled); iptal sonrası eski token'la dönen katılımcı sonraki turda yeniden atılır", async () => {
    const cancelled = await seed({ startsMinAgo: -60, status: "CANCELLED", cancelledMinAgo: 1 });
    rooms.set(cancelled.roomName, ["meet-guest:a"]);
    const first = await runMeetingSweep(app, { deps });
    expect(first.closed).toEqual([{ meetingId: cancelled.id, reason: "cancelled", removed: 1, unavailable: false }]);
    expect((await app.prisma.externalMeeting.findUniqueOrThrow({ where: { id: cancelled.id } })).closedAt).not.toBeNull();

    rooms.set(cancelled.roomName, ["meet-guest:a", "meet-host:b"]);
    removeCalls.length = 0;
    const second = await runMeetingSweep(app, { deps });
    expect(second.closed).toEqual([]);
    expect(second.strayRemoved).toEqual([{ meetingId: cancelled.id, removed: 2 }]);
    expect(removeCalls.map((c) => c.identity).sort()).toEqual(["meet-guest:a", "meet-host:b"]);
    expect(await app.prisma.auditLog.count({ where: { action: "meeting.closed", targetId: cancelled.id } })).toBe(1);

    // token ömrü geçmiş eski iptal: artık taranmaz
    const old = await seed({ startsMinAgo: -600, status: "CANCELLED", cancelledMinAgo: 24 * 60, closedAt: new Date(Date.now() - 23 * 60 * MIN) });
    rooms.set(old.roomName, ["meet-guest:z"]);
    removeCalls.length = 0;
    await runMeetingSweep(app, { deps });
    expect(removeCalls.filter((c) => c.roomName === old.roomName)).toEqual([]);
  });

  it("room_ önekli oda adına HİÇ dokunmaz, hata loglar, closedAt yazmaz", async () => {
    const bad = await seed({ startsMinAgo: 120, roomName: "room_abcdef0123456789" });
    rooms.set(bad.roomName, ["meet-host:1", "patient:2"]);
    const errorSpy = vi.spyOn(app.log, "error");
    const result = await runMeetingSweep(app, { deps });
    expect(result.closed).toEqual([]);
    expect(deps.listParticipants).not.toHaveBeenCalledWith(bad.roomName);
    expect(deps.removeParticipant).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalled();
    expect((await app.prisma.externalMeeting.findUniqueOrThrow({ where: { id: bad.id } })).closedAt).toBeNull();
    errorSpy.mockRestore();
  });

  it("atma hatasında closedAt YAZILMAZ ve audit düşmez; sonraki turda tekrar denenir", async () => {
    const meeting = await seed({ startsMinAgo: 60 });
    rooms.set(meeting.roomName, ["meet-guest:1"]);
    failRemove = true;
    const warnSpy = vi.spyOn(app.log, "warn");
    const failed = await runMeetingSweep(app, { deps });
    expect(failed.closed).toEqual([]);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
    expect((await app.prisma.externalMeeting.findUniqueOrThrow({ where: { id: meeting.id } })).closedAt).toBeNull();
    expect(await app.prisma.auditLog.count({ where: { action: "meeting.closed" } })).toBe(0);

    failRemove = false;
    const retried = await runMeetingSweep(app, { deps });
    expect(retried.closed).toHaveLength(1);
    expect((await app.prisma.externalMeeting.findUniqueOrThrow({ where: { id: meeting.id } })).closedAt).not.toBeNull();
  });

  it("Server API yapılandırılmamışsa (null) toplantı unavailable olarak kapatılır", async () => {
    const meeting = await seed({ startsMinAgo: 60 });
    unavailable = true;
    const result = await runMeetingSweep(app, { deps });
    expect(result.closed).toEqual([{ meetingId: meeting.id, reason: "ended", removed: 0, unavailable: true }]);
  });

  it("çıkarılmış misafir canlı odada kalmışsa / dönmüşse atılır; diğerleri kalır", async () => {
    const live = await seed({ startsMinAgo: 5 });
    const removed = await app.prisma.externalMeetingGuest.create({ data: { meetingId: live.id, displayName: "Çıkarılan", admittedAt: new Date(), removedAt: new Date() } });
    const stays = await app.prisma.externalMeetingGuest.create({ data: { meetingId: live.id, displayName: "Kalan", admittedAt: new Date() } });
    rooms.set(live.roomName, [`meet-guest:${removed.id}`, `meet-guest:${stays.id}`, "meet-host:h"]);
    const result = await runMeetingSweep(app, { deps });
    expect(result.removedGuestsKicked).toEqual([{ meetingId: live.id, guestId: removed.id }]);
    expect(removeCalls).toEqual([{ roomName: live.roomName, identity: `meet-guest:${removed.id}` }]);
    expect(rooms.get(live.roomName)).toEqual([`meet-guest:${stays.id}`, "meet-host:h"]);
  });

  it("misafir adı saklama: bitişten 90 gün sonra misafir satırları silinir (89 gün kalır); toplantı satırı KALIR", async () => {
    const old = await seed({ startsMinAgo: 91 * 24 * 60 });
    const recent = await seed({ startsMinAgo: 89 * 24 * 60 });
    await app.prisma.externalMeetingGuest.createMany({
      data: [
        { meetingId: old.id, displayName: "Eski 1" },
        { meetingId: old.id, displayName: "Eski 2" },
        { meetingId: recent.id, displayName: "Yakın" },
      ],
    });
    const result = await runMeetingGuestRetention(app);
    expect(result.deleted).toBe(2);
    expect(await app.prisma.externalMeetingGuest.count({ where: { meetingId: old.id } })).toBe(0);
    expect(await app.prisma.externalMeetingGuest.count({ where: { meetingId: recent.id } })).toBe(1);
    expect(await app.prisma.externalMeeting.count({ where: { id: { in: [old.id, recent.id] } } })).toBe(2);

    // sınır: tam 90 gün olmayan, ileri tarihli "şimdi" ile
    const later = await runMeetingGuestRetention(app, new Date(Date.now() + 2 * 24 * 60 * MIN));
    expect(later.deleted).toBe(1);
  });
});
