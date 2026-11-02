import crypto from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { TokenVerifier } from "livekit-server-sdk";

/**
 * Paket AG (İş 3) — harici görüntülü toplantı: yetki, ev sahibi uçları, ADMIN gözetimi, host-token, davet.
 * LiveKit yapılandırılmış (sahte anahtar; ağ çağrısı yok) ve Server API (`listParticipants`/`removeParticipant`)
 * `lk` durumu üzerinden taklit edilir. `vi.hoisted` ortam değişkenlerini `config/env` import edilmeden ÖNCE kurar
 * (her test dosyası kendi modül kaydına sahiptir).
 */
const lk = vi.hoisted(() => {
  process.env.LIVEKIT_URL = "wss://fake-project.livekit.cloud";
  process.env.LIVEKIT_API_KEY = "fake-api-key";
  process.env.LIVEKIT_API_SECRET = "fake-api-secret-for-tests-only";
  return { rooms: new Map<string, string[]>(), removed: [] as Array<[string, string]>, unavailable: false, mail: [] as Array<Record<string, unknown>>, mailFails: false };
});

vi.mock("../../src/modules/telehealth/lib/livekit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/modules/telehealth/lib/livekit")>();
  return {
    ...actual,
    listRoomParticipantIdentities: vi.fn(async (room: string) => (lk.unavailable ? null : [...(lk.rooms.get(room) ?? [])])),
    removeRoomParticipant: vi.fn(async (room: string, identity: string) => {
      lk.removed.push([room, identity]);
      lk.rooms.set(room, (lk.rooms.get(room) ?? []).filter((id) => id !== identity));
      return true;
    }),
  };
});

vi.mock("../../src/lib/branded-mail", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/lib/branded-mail")>();
  return {
    ...actual,
    sendBrandedMail: vi.fn(async (_app: unknown, input: Record<string, unknown>) => {
      if (lk.mailFails) throw new Error("smtp down");
      lk.mail.push(input);
      return { messageId: "m1" };
    }),
  };
});

import { buildTestApp } from "../helpers/build-test-app";
import { resetDatabase } from "../helpers/reset-db";
import { signAccessToken } from "../../src/lib/jwt";
import { env } from "../../src/config/env";
import { hashToken } from "../../src/lib/tokens";

let app: FastifyInstance;
let ipCounter = 0;

function nextIp() {
  ipCounter += 1;
  return `10.20.${Math.floor(ipCounter / 250)}.${(ipCounter % 250) + 1}`;
}

async function mkUser(role: "ADMIN" | "MANAGER" | "EDITOR" | "CUSTOMER" | "USER" | "INTERPRETER", extra: Record<string, unknown> = {}) {
  return app.prisma.user.create({
    data: {
      email: `meet-${crypto.randomUUID()}@example.com`,
      name: `Kullanıcı ${role}`,
      passwordHash: "x",
      role,
      status: "ACTIVE",
      emailVerifiedAt: new Date(),
      ...extra,
    },
  });
}

function bearer(user: { id: string; email: string }) {
  return { authorization: `Bearer ${signAccessToken({ sub: user.id, email: user.email }).token}` };
}

async function call(method: "GET" | "POST" | "PATCH" | "DELETE", url: string, user: { id: string; email: string }, payload?: unknown, ip?: string) {
  return app.inject({ method, url: `/api/v1${url}`, headers: bearer(user), ...(payload !== undefined ? { payload: payload as object } : {}), remoteAddress: ip ?? nextIp() });
}

async function grantHost(user: { id: string }) {
  return app.prisma.user.update({ where: { id: user.id }, data: { meetingHostGrantedAt: new Date() } });
}

function inMinutes(minutes: number) {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

async function createMeeting(host: { id: string; email: string }, overrides: Record<string, unknown> = {}) {
  const res = await call("POST", "/meetings", host, { title: "Haftalık koordinasyon", startsAt: inMinutes(60), durationMin: 30, ...overrides });
  return res;
}

/** Penceresi zaten açık (başlangıçtan 15 dk içinde) bir toplantı doğrudan DB'ye yazılır. */
async function seedMeeting(hostUserId: string, opts: { startsInMin?: number; durationMin?: number; status?: "SCHEDULED" | "CANCELLED"; max?: number; autoAdmit?: boolean } = {}) {
  const startsAt = new Date(Date.now() + (opts.startsInMin ?? 0) * 60_000);
  const durationMin = opts.durationMin ?? 30;
  const { generateGuestToken } = await import("../../src/modules/meetings/meeting-tokens");
  const { token, hash } = generateGuestToken();
  const meeting = await app.prisma.externalMeeting.create({
    data: {
      hostUserId,
      title: "Hazır toplantı",
      note: "gizli not",
      startsAt,
      endsAt: new Date(startsAt.getTime() + durationMin * 60_000),
      durationMin,
      maxParticipants: opts.max ?? 4,
      autoAdmitGuests: opts.autoAdmit ?? false,
      roomName: `meet_${crypto.randomBytes(16).toString("hex")}`,
      guestTokenHash: hash,
      guestTokenCreatedAt: new Date(),
      status: opts.status ?? "SCHEDULED",
    },
  });
  return { meeting, token };
}

async function mkDoctorProfile(userId: string) {
  const specialty = await app.prisma.specialty.create({ data: { name: `Uzmanlık ${crypto.randomUUID()}`, slug: `uzmanlik-${crypto.randomUUID()}`, icon: "heart-pulse" } });
  return app.prisma.doctorProfile.create({
    data: {
      title: "Op. Dr.",
      fullName: "Mehmet DEMİR",
      slug: `doktor-${crypto.randomUUID()}`,
      bio: "Test",
      languages: ["tr"],
      timeZone: "Europe/Istanbul",
      specialtyId: specialty.id,
      sessionDurationMin: 30,
      sessionPriceCents: 50000,
      currency: "TRY",
      isActive: true,
      userId,
    },
  });
}

let admin: Awaited<ReturnType<typeof mkUser>>;
let editor: Awaited<ReturnType<typeof mkUser>>;

beforeAll(async () => {
  app = await buildTestApp();
  await resetDatabase(app.prisma);
  await app.prisma.siteModule.upsert({ where: { key: "telehealth" }, create: { key: "telehealth", enabled: true }, update: { enabled: true } });
});

afterAll(async () => {
  await resetDatabase(app.prisma);
  await app.close();
  delete process.env.LIVEKIT_URL;
  delete process.env.LIVEKIT_API_KEY;
  delete process.env.LIVEKIT_API_SECRET;
});

beforeEach(async () => {
  lk.rooms.clear();
  lk.removed.length = 0;
  lk.mail.length = 0;
  lk.unavailable = false;
  lk.mailFails = false;
  await app.prisma.externalMeeting.deleteMany();
  await app.prisma.auditLog.deleteMany();
  await app.prisma.doctorProfile.deleteMany();
  await app.prisma.user.deleteMany();
  admin = await mkUser("ADMIN", { twoFactorEnabled: true });
  editor = await grantHost(await mkUser("EDITOR")).then((u) => u);
});

describe("yetki verme / geri alma (PATCH /admin/users/:id/meeting-host)", () => {
  it("ADMIN verir ve geri alır; alan ve audit (from/to) doğru", async () => {
    const target = await mkUser("MANAGER");
    const grant = await call("PATCH", `/admin/users/${target.id}/meeting-host`, admin, { enabled: true });
    expect(grant.statusCode).toBe(200);
    expect(grant.json().data.canHostMeetings).toBe(true);
    expect((await app.prisma.user.findUniqueOrThrow({ where: { id: target.id } })).meetingHostGrantedAt).not.toBeNull();
    expect((await app.prisma.user.findUniqueOrThrow({ where: { id: target.id } })).meetingHostGrantedById).toBe(admin.id);

    const revoke = await call("PATCH", `/admin/users/${target.id}/meeting-host`, admin, { enabled: false });
    expect(revoke.statusCode).toBe(200);
    expect(revoke.json().data.canHostMeetings).toBe(false);
    expect((await app.prisma.user.findUniqueOrThrow({ where: { id: target.id } })).meetingHostGrantedAt).toBeNull();

    const audits = await app.prisma.auditLog.findMany({ where: { targetId: target.id, action: { startsWith: "user.meeting_host_" } }, orderBy: { seq: "asc" } });
    expect(audits.map((a) => a.action)).toEqual(["user.meeting_host_granted", "user.meeting_host_revoked"]);
    expect(audits[0]!.metadata).toEqual({ from: false, to: true });
    expect(audits[1]!.metadata).toMatchObject({ from: true, to: false });
  });

  it("MANAGER ve EDITOR bu ucu çağıramaz (403)", async () => {
    const target = await mkUser("USER");
    const manager = await mkUser("MANAGER");
    expect((await call("PATCH", `/admin/users/${target.id}/meeting-host`, manager, { enabled: true })).statusCode).toBe(403);
    expect((await call("PATCH", `/admin/users/${target.id}/meeting-host`, editor, { enabled: true })).statusCode).toBe(403);
  });

  it.each(["CUSTOMER", "INTERPRETER", "USER"] as const)("uygun olmayan rol %s → 422 MEETING_HOST_NOT_ELIGIBLE", async (role) => {
    const target = await mkUser(role);
    const res = await call("PATCH", `/admin/users/${target.id}/meeting-host`, admin, { enabled: true });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("MEETING_HOST_NOT_ELIGIBLE");
  });

  it("doktor profiline bağlı USER uygundur; DELETED kullanıcı 404; ADMIN hedefi no-op 200", async () => {
    const doctorUser = await mkUser("USER");
    await mkDoctorProfile(doctorUser.id);
    const ok = await call("PATCH", `/admin/users/${doctorUser.id}/meeting-host`, admin, { enabled: true });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().data.canHostMeetings).toBe(true);

    const deleted = await mkUser("EDITOR", { status: "DELETED", deletedAt: new Date() });
    expect((await call("PATCH", `/admin/users/${deleted.id}/meeting-host`, admin, { enabled: true })).statusCode).toBe(404);

    const otherAdmin = await mkUser("ADMIN");
    const noop = await call("PATCH", `/admin/users/${otherAdmin.id}/meeting-host`, admin, { enabled: false });
    expect(noop.statusCode).toBe(200);
    expect(noop.json().data.canHostMeetings).toBe(true);
    expect(await app.prisma.auditLog.count({ where: { targetId: otherAdmin.id, action: { startsWith: "user.meeting_host_" } } })).toBe(0);
  });

  it("GET /users/me → canHostMeetings: ADMIN true, yetkili true, diğerleri false", async () => {
    const plain = await mkUser("USER");
    const flag = async (u: { id: string; email: string }) => (await call("GET", "/users/me", u)).json().data.canHostMeetings;
    expect(await flag(admin)).toBe(true);
    expect(await flag(editor)).toBe(true);
    expect(await flag(plain)).toBe(false);
    expect(await flag(await mkUser("MANAGER"))).toBe(false);
  });

  it("yetki geri alınınca kullanıcının gelecekteki toplantıları aynı işlemde iptal edilir (audit dahil); geçmiş toplantıya dokunulmaz", async () => {
    const future = await seedMeeting(editor.id, { startsInMin: 120 });
    const open = await seedMeeting(editor.id, { startsInMin: -5 });
    const past = await seedMeeting(editor.id, { startsInMin: -120, durationMin: 30 });
    const otherHost = await grantHost(await mkUser("EDITOR"));
    const others = await seedMeeting(otherHost.id, { startsInMin: 120 });
    // Açık odadaki ev sahibi + misafir ve başka toplantının odası (dokunulmamalı)
    lk.rooms.set(open.meeting.roomName, [`meet-host:${editor.id}`, "meet-guest:g1", "patient:p1"]);
    lk.rooms.set(others.meeting.roomName, [`meet-host:${otherHost.id}`]);

    const res = await call("PATCH", `/admin/users/${editor.id}/meeting-host`, admin, { enabled: false });
    expect(res.statusCode).toBe(200);
    // Açık oda hemen boşaltılır (yalnızca meet-* kimlikleri), başkasının odasına dokunulmaz
    expect(lk.removed.filter(([room]) => room === open.meeting.roomName).map(([, id]) => id).sort()).toEqual([`meet-guest:g1`, `meet-host:${editor.id}`].sort());
    expect(lk.removed.some(([room]) => room === others.meeting.roomName)).toBe(false);

    const rows = await app.prisma.externalMeeting.findMany({ where: { id: { in: [future.meeting.id, open.meeting.id, past.meeting.id, others.meeting.id] } } });
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get(future.meeting.id)).toMatchObject({ status: "CANCELLED", guestTokenHash: null, cancelledById: admin.id });
    expect(byId.get(open.meeting.id)).toMatchObject({ status: "CANCELLED", guestTokenHash: null });
    expect(byId.get(past.meeting.id)!.status).toBe("SCHEDULED");
    expect(byId.get(others.meeting.id)!.status).toBe("SCHEDULED");

    const cancelledAudits = await app.prisma.auditLog.findMany({ where: { action: "meeting.cancelled" } });
    expect(cancelledAudits.map((a) => a.targetId).sort()).toEqual([future.meeting.id, open.meeting.id].sort());
    expect(cancelledAudits[0]!.metadata).toEqual({ source: "host_revoked" });
    const revoked = await app.prisma.auditLog.findFirstOrThrow({ where: { action: "user.meeting_host_revoked" } });
    expect(revoked.metadata).toEqual({ from: true, to: false, cancelledMeetings: 2 });
  });
});

describe("ev sahibi kapısı (/meetings)", () => {
  it("yetkisiz kullanıcı 403 MEETING_HOST_FORBIDDEN; geri alındıktan sonraki ilk istek de 403 (taze okuma)", async () => {
    const plain = await mkUser("EDITOR");
    const denied = await call("GET", "/meetings", plain);
    expect(denied.statusCode).toBe(403);
    expect(denied.json().error.code).toBe("MEETING_HOST_FORBIDDEN");

    expect((await call("GET", "/meetings", editor)).statusCode).toBe(200);
    await call("PATCH", `/admin/users/${editor.id}/meeting-host`, admin, { enabled: false });
    const after = await call("GET", "/meetings", editor);
    expect(after.statusCode).toBe(403);
    expect(after.json().error.code).toBe("MEETING_HOST_FORBIDDEN");
  });

  it("kimliksiz istek 401; askıya alınmış ev sahibi 403", async () => {
    expect((await app.inject({ method: "GET", url: "/api/v1/meetings", remoteAddress: nextIp() })).statusCode).toBe(401);
    const suspended = await grantHost(await mkUser("EDITOR", { status: "SUSPENDED" }));
    expect((await call("GET", "/meetings", suspended)).statusCode).toBe(403);
  });

  it("2FA'sız ev sahibi çalışır; 2FA durumu yanıtta döner (bilgilendirme için)", async () => {
    expect(editor.twoFactorEnabled).toBe(false);
    const created = await createMeeting(editor);
    expect(created.statusCode).toBe(201);
    expect(created.json().data.host).toEqual({ twoFactorEnabled: false });

    const list = await call("GET", "/meetings", editor);
    expect(list.statusCode).toBe(200);
    expect(list.json().meta.host).toEqual({ twoFactorEnabled: false });

    const status = await call("GET", "/meetings/host-status", editor);
    expect(status.json().data).toEqual({ canHostMeetings: true, twoFactorEnabled: false });

    const withTwoFactor = await grantHost(await mkUser("EDITOR", { twoFactorEnabled: true }));
    expect((await call("GET", "/meetings", withTwoFactor)).json().meta.host).toEqual({ twoFactorEnabled: true });
    expect((await call("GET", "/meetings/host-status", await mkUser("USER"))).json().data).toEqual({ canHostMeetings: false, twoFactorEnabled: false });
  });

  it("telehealth modülü kapalıyken 404", async () => {
    await app.prisma.siteModule.update({ where: { key: "telehealth" }, data: { enabled: false } });
    try {
      expect((await call("GET", "/meetings", editor)).statusCode).toBe(404);
    } finally {
      await app.prisma.siteModule.update({ where: { key: "telehealth" }, data: { enabled: true } });
    }
  });
});

describe("toplantı oluşturma", () => {
  it("varsayılanlar: 4 katılımcı, otomatik kabul kapalı; yanıt guestTokenHash taşımaz; guestLink düz yalnız burada", async () => {
    const res = await createMeeting(editor, { note: "gizli", locale: "tr" });
    expect(res.statusCode).toBe(201);
    const { meeting, guestLink } = res.json().data;
    expect(meeting).toMatchObject({ title: "Haftalık koordinasyon", note: "gizli", maxParticipants: 4, autoAdmitGuests: false, status: "SCHEDULED", phase: "upcoming", guestLinkActive: true, durationMin: 30 });
    expect(Date.parse(meeting.endsAt) - Date.parse(meeting.startsAt)).toBe(30 * 60_000);
    expect(JSON.stringify(res.json())).not.toMatch(/guestTokenHash|roomName|meet_/);
    // locale: "tr" gönderilse bile bağlantı en'e düşer (Türkçe ziyaretçiye kapalı)
    expect(guestLink).toMatch(/\/en\/meet\/join#mg_[A-Za-z0-9_-]{43}$/);

    const token = guestLink.slice(guestLink.indexOf("#") + 1);
    const row = await app.prisma.externalMeeting.findUniqueOrThrow({ where: { id: meeting.id } });
    expect(row.guestTokenHash).toBe(hashToken(token));
    expect(JSON.stringify(row)).not.toContain(token);
    expect(row.roomName).toMatch(/^meet_[0-9a-f]{32}$/);

    const detail = await call("GET", `/meetings/${meeting.id}`, editor);
    expect(JSON.stringify(detail.json())).not.toContain(token);
    const list = await call("GET", "/meetings", editor);
    expect(JSON.stringify(list.json())).not.toContain(token);
    expect(JSON.stringify(list.json())).not.toMatch(/guestTokenHash|guestLink"/);
  });

  it.each([
    ["süre 14", { durationMin: 14 }],
    ["süre 121", { durationMin: 121 }],
    ["süre 5'in katı değil", { durationMin: 32 }],
    ["katılımcı 1", { maxParticipants: 1 }],
    ["katılımcı 9", { maxParticipants: 9 }],
    ["geçmiş tarih", { startsAt: new Date(Date.now() - 10 * 60_000).toISOString() }],
    ["180 günden ileri", { startsAt: new Date(Date.now() + 181 * 24 * 3600_000).toISOString() }],
    ["başlık 2 karakter", { title: "ab" }],
    ["başlık 121 karakter", { title: "a".repeat(121) }],
    ["başlıkta kontrol karakteri", { title: "Başlık​gizli" }],
    ["not 1001 karakter", { note: "n".repeat(1001) }],
    ["saat dilimi ofsetli tarih", { startsAt: "2030-01-01T10:00:00+03:00" }],
  ])("doğrulama reddeder: %s", async (_label, overrides) => {
    const res = await createMeeting(editor, overrides);
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
  });

  it("sınırlar kabul edilir: süre 15 ve 120, katılımcı 2 ve 8, başlangıç 5 dk geçmiş payı", async () => {
    expect((await createMeeting(editor, { durationMin: 15, maxParticipants: 2 })).statusCode).toBe(201);
    expect((await createMeeting(editor, { durationMin: 120, maxParticipants: 8 })).statusCode).toBe(201);
    expect((await createMeeting(editor, { startsAt: new Date(Date.now() - 4 * 60_000).toISOString() })).statusCode).toBe(201);
  });

  it("kullanıcı başına en çok 20 gelecek toplantı → 409 MEETING_LIMIT_REACHED (iptal edilen / geçmiş sayılmaz)", async () => {
    for (let i = 0; i < 20; i += 1) await seedMeeting(editor.id, { startsInMin: 60 + i });
    await seedMeeting(editor.id, { startsInMin: 90, status: "CANCELLED" });
    await seedMeeting(editor.id, { startsInMin: -300 });
    const res = await createMeeting(editor);
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("MEETING_LIMIT_REACHED");
  });

  it("oluşturma audit'i: meeting.created + meeting.guest_link.created; metadata'da belirteç/URL/başlık/not yok", async () => {
    const res = await createMeeting(editor, { note: "ÇOK-GİZLİ-NOT" });
    const id = res.json().data.meeting.id;
    const audits = await app.prisma.auditLog.findMany({ where: { targetId: id } });
    expect(audits.map((a) => a.action).sort()).toEqual(["meeting.created", "meeting.guest_link.created"]);
    const dump = JSON.stringify(audits);
    expect(dump).not.toMatch(/mg_|ÇOK-GİZLİ|Haftalık|http/);
  });

  it("oran sınırı: POST /meetings 10/dk (11. istek 429 RATE_LIMITED)", async () => {
    const ip = nextIp();
    for (let i = 0; i < 10; i += 1) {
      const res = await call("POST", "/meetings", editor, { title: "Hızlı toplantı", startsAt: inMinutes(60 + i), durationMin: 15 }, ip);
      expect(res.statusCode).toBe(i < 10 ? 201 : 429);
    }
    const blocked = await call("POST", "/meetings", editor, { title: "Hızlı toplantı", startsAt: inMinutes(200), durationMin: 15 }, ip);
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json().error.code).toBe("RATE_LIMITED");
  });
});

describe("liste, sayfalama ve sahiplik", () => {
  it("upcoming / past kapsamı ve imleçli sayfalama; yalnızca kendi toplantıları", async () => {
    const mine = [] as string[];
    for (let i = 0; i < 5; i += 1) mine.push((await seedMeeting(editor.id, { startsInMin: 60 + i * 10 })).meeting.id);
    const past = await seedMeeting(editor.id, { startsInMin: -300 });
    const cancelled = await seedMeeting(editor.id, { startsInMin: 500, status: "CANCELLED" });
    await seedMeeting((await grantHost(await mkUser("EDITOR"))).id, { startsInMin: 70 });

    const page1 = await call("GET", "/meetings?scope=upcoming&limit=3", editor);
    expect(page1.json().data.map((m: { id: string }) => m.id)).toEqual(mine.slice(0, 3));
    const cursor = page1.json().meta.nextCursor as string;
    expect(cursor).toBeTruthy();
    const page2 = await call("GET", `/meetings?scope=upcoming&limit=3&cursor=${cursor}`, editor);
    expect(page2.json().data.map((m: { id: string }) => m.id)).toEqual(mine.slice(3));
    expect(page2.json().meta.nextCursor).toBeNull();

    const pastList = await call("GET", "/meetings?scope=past", editor);
    expect(pastList.json().data.map((m: { id: string }) => m.id).sort()).toEqual([past.meeting.id, cancelled.meeting.id].sort());
    expect(pastList.json().data.find((m: { id: string }) => m.id === cancelled.meeting.id).phase).toBe("cancelled");
  });

  it("başkasının toplantısı (ADMIN dahil) GET / PATCH / host-token / cancel / guest-link / guests için 404 MEETING_NOT_FOUND", async () => {
    const { meeting } = await seedMeeting(editor.id, { startsInMin: 0 });
    const intruder = await grantHost(await mkUser("MANAGER"));
    for (const who of [intruder, admin]) {
      const probes = [
        await call("GET", `/meetings/${meeting.id}`, who),
        await call("PATCH", `/meetings/${meeting.id}`, who, { title: "ele geçir" }),
        await call("POST", `/meetings/${meeting.id}/host-token`, who),
        await call("POST", `/meetings/${meeting.id}/cancel`, who),
        await call("POST", `/meetings/${meeting.id}/guest-link`, who, {}),
        await call("DELETE", `/meetings/${meeting.id}/guest-link`, who),
        await call("GET", `/meetings/${meeting.id}/guests`, who),
        await call("POST", `/meetings/${meeting.id}/invite-email`, who, { guestLink: `mg_${"a".repeat(43)}`, email: "x@example.com" }),
      ];
      for (const res of probes) {
        expect(res.statusCode).toBe(404);
        expect(res.json().error.code).toBe("MEETING_NOT_FOUND");
      }
    }
    const row = await app.prisma.externalMeeting.findUniqueOrThrow({ where: { id: meeting.id } });
    expect(row.title).toBe("Hazır toplantı");
    expect(row.status).toBe("SCHEDULED");
  });
});

describe("ADMIN gözetimi (/admin/meetings)", () => {
  it("ADMIN tüm toplantıları listeler (ev sahibi adıyla; not ve misafir adı yok) ve iptal eder", async () => {
    const a = await seedMeeting(editor.id, { startsInMin: 60 });
    const other = await grantHost(await mkUser("EDITOR"));
    const b = await seedMeeting(other.id, { startsInMin: 90 });
    await app.prisma.externalMeetingGuest.create({ data: { meetingId: a.meeting.id, displayName: "Gizli Misafir" } });

    const list = await call("GET", "/admin/meetings?scope=all", admin);
    expect(list.statusCode).toBe(200);
    const ids = list.json().data.map((m: { id: string }) => m.id);
    expect(ids).toEqual(expect.arrayContaining([a.meeting.id, b.meeting.id]));
    const dump = JSON.stringify(list.json());
    expect(dump).not.toMatch(/gizli not|Gizli Misafir|guestTokenHash|meet_|mg_/);
    expect(list.json().data.find((m: { id: string }) => m.id === a.meeting.id).host).toEqual({ id: editor.id, name: editor.name });

    const filtered = await call("GET", `/admin/meetings?hostUserId=${other.id}`, admin);
    expect(filtered.json().data.map((m: { id: string }) => m.id)).toEqual([b.meeting.id]);

    lk.rooms.set(b.meeting.roomName, ["meet-host:x", "meet-guest:y", "patient:keep"]);
    const cancel = await call("POST", `/admin/meetings/${b.meeting.id}/cancel`, admin);
    expect(cancel.statusCode).toBe(200);
    expect(cancel.json().data.status).toBe("CANCELLED");
    const row = await app.prisma.externalMeeting.findUniqueOrThrow({ where: { id: b.meeting.id } });
    expect(row).toMatchObject({ status: "CANCELLED", guestTokenHash: null, cancelledById: admin.id });
    expect(lk.removed.map(([, id]) => id).sort()).toEqual(["meet-guest:y", "meet-host:x"]);
    const audit = await app.prisma.auditLog.findFirstOrThrow({ where: { action: "meeting.cancelled", targetId: b.meeting.id } });
    expect(audit.metadata).toEqual({ source: "admin" });
    expect(audit.actorId).toBe(admin.id);
  });

  it("ADMIN başkasının toplantısı için host-token ALAMAZ (404); MANAGER / EDITOR admin uçlarına 403", async () => {
    const { meeting } = await seedMeeting(editor.id, { startsInMin: 0 });
    const res = await call("POST", `/meetings/${meeting.id}/host-token`, admin);
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("MEETING_NOT_FOUND");
    expect((await call("POST", `/admin/meetings/${meeting.id}/host-token`, admin)).statusCode).toBe(404);

    const manager = await mkUser("MANAGER");
    expect((await call("GET", "/admin/meetings", manager)).statusCode).toBe(403);
    expect((await call("GET", "/admin/meetings", editor)).statusCode).toBe(403);
    expect((await call("POST", `/admin/meetings/${meeting.id}/cancel`, editor)).statusCode).toBe(403);
    expect((await call("POST", `/admin/meetings/${meeting.id}/cancel`, await mkUser("USER"))).statusCode).toBe(403);
  });

  it("bitmiş toplantı iptal edilemez (409); iptal idempotent", async () => {
    const ended = await seedMeeting(editor.id, { startsInMin: -120, durationMin: 30 });
    expect((await call("POST", `/admin/meetings/${ended.meeting.id}/cancel`, admin)).statusCode).toBe(409);
    const live = await seedMeeting(editor.id, { startsInMin: 60 });
    expect((await call("POST", `/admin/meetings/${live.meeting.id}/cancel`, admin)).statusCode).toBe(200);
    expect((await call("POST", `/admin/meetings/${live.meeting.id}/cancel`, admin)).statusCode).toBe(200);
    expect(await app.prisma.auditLog.count({ where: { action: "meeting.cancelled", targetId: live.meeting.id } })).toBe(1);
  });
});

describe("host-token", () => {
  async function tokenFor(meetingId: string, user = editor) {
    return call("POST", `/meetings/${meetingId}/host-token`, user);
  }

  it("pencere öncesi 409 (opensAt); 15 dk kala 200; endsAt sonrası 409; iptal sonrası 409", async () => {
    const early = await seedMeeting(editor.id, { startsInMin: 60 });
    const tooEarly = await tokenFor(early.meeting.id);
    expect(tooEarly.statusCode).toBe(409);
    expect(tooEarly.json().error.code).toBe("MEETING_NOT_OPEN");
    expect(tooEarly.json().error.details.reason).toEqual(["not_yet_open"]);
    expect(Date.parse(tooEarly.json().error.details.opensAt[0])).toBe(early.meeting.startsAt.getTime() - 15 * 60_000);

    const open = await seedMeeting(editor.id, { startsInMin: 14 });
    expect((await tokenFor(open.meeting.id)).statusCode).toBe(200);

    const justBefore = await seedMeeting(editor.id, { startsInMin: 16 });
    expect((await tokenFor(justBefore.meeting.id)).statusCode).toBe(409);

    const ended = await seedMeeting(editor.id, { startsInMin: -31, durationMin: 30 });
    const endedRes = await tokenFor(ended.meeting.id);
    expect(endedRes.statusCode).toBe(409);
    expect(endedRes.json().error.details.reason).toEqual(["ended"]);

    const cancelled = await seedMeeting(editor.id, { startsInMin: 0, status: "CANCELLED" });
    const cancelledRes = await tokenFor(cancelled.meeting.id);
    expect(cancelledRes.statusCode).toBe(409);
    expect(cancelledRes.json().error.details.reason).toEqual(["cancelled"]);
  });

  it("token: ev sahibi grant'ları, meet-host kimliği, doktorda unvansız kısaltılmış ad, hostJoinedAt ve audit (token yok)", async () => {
    const doctorUser = await grantHost(await mkUser("USER", { name: "Gerçek Hesap Adı" }));
    await mkDoctorProfile(doctorUser.id);
    const { meeting } = await seedMeeting(doctorUser.id, { startsInMin: 0 });
    const res = await tokenFor(meeting.id, doctorUser);
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(Object.keys(data).sort()).toEqual(["expiresAt", "roomName", "serverUrl", "token"]);
    expect(data.roomName).toBe(meeting.roomName);
    const claims = await new TokenVerifier(env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET).verify(data.token);
    expect(claims.sub).toBe(`meet-host:${doctorUser.id}`);
    expect(claims.name).toBe("M. Demir");
    const video = claims.video as Record<string, unknown>;
    expect(video.room).toBe(meeting.roomName);
    expect([...(video.canPublishSources as string[])].sort()).toEqual(["camera", "microphone", "screen_share", "screen_share_audio"]);
    for (const grant of ["roomAdmin", "roomRecord", "roomCreate", "roomList", "hidden"]) expect(video[grant]).toBeUndefined();
    expect(video.canPublishData).toBe(false);
    expect(Date.parse(data.expiresAt)).toBeLessThanOrEqual(meeting.endsAt.getTime() + 10 * 60_000 + 2000);
    expect(Date.parse(data.expiresAt)).toBeLessThanOrEqual(Date.now() + env.LIVEKIT_TOKEN_TTL_MIN * 60_000 + 2000);

    expect((await app.prisma.externalMeeting.findUniqueOrThrow({ where: { id: meeting.id } })).hostJoinedAt).not.toBeNull();
    const audit = await app.prisma.auditLog.findFirstOrThrow({ where: { action: "meeting.host_token.issued" } });
    expect(audit.targetId).toBe(meeting.id);
    expect(JSON.stringify(audit)).not.toContain(data.token);
    expect(audit.metadata).toBeNull();
  });

  it("LiveKit yapılandırılmamışsa 503 LIVEKIT_NOT_CONFIGURED", async () => {
    const { meeting } = await seedMeeting(editor.id, { startsInMin: 0 });
    const saved = env.LIVEKIT_URL;
    env.LIVEKIT_URL = "";
    try {
      const res = await tokenFor(meeting.id);
      expect(res.statusCode).toBe(503);
      expect(res.json().error.code).toBe("LIVEKIT_NOT_CONFIGURED");
    } finally {
      env.LIVEKIT_URL = saved;
    }
  });

  it("oran sınırı: 10/dk (11. istek 429)", async () => {
    const { meeting } = await seedMeeting(editor.id, { startsInMin: 0 });
    const ip = nextIp();
    for (let i = 0; i < 10; i += 1) expect((await call("POST", `/meetings/${meeting.id}/host-token`, editor, undefined, ip)).statusCode).toBe(200);
    const blocked = await call("POST", `/meetings/${meeting.id}/host-token`, editor, undefined, ip);
    expect(blocked.statusCode).toBe(429);
    expect(blocked.headers["retry-after"]).toBeDefined();
  });

  it("REGRESYON: mevcut POST /appointments/:id/meeting-token hâlâ kayıtlı ve randevusuz 404 verir", async () => {
    const res = await app.inject({ method: "POST", url: `/api/v1/appointments/${crypto.randomUUID()}/meeting-token`, remoteAddress: nextIp() });
    expect(res.statusCode).toBe(404);
  });
});

describe("düzenleme, iptal, bağlantı yönetimi", () => {
  it("PATCH: başlık / not / otomatik kabul her zaman; zaman yalnızca başlamadan; katılımcı sınırı oda açılmadan; bitmiş / iptal 409", async () => {
    const future = await seedMeeting(editor.id, { startsInMin: 120 });
    const ok1 = await call("PATCH", `/meetings/${future.meeting.id}`, editor, { title: "Yeni başlık", note: null, autoAdmitGuests: true, maxParticipants: 6, startsAt: inMinutes(180), durationMin: 45 });
    expect(ok1.statusCode).toBe(200);
    expect(ok1.json().data).toMatchObject({ title: "Yeni başlık", note: null, autoAdmitGuests: true, maxParticipants: 6, durationMin: 45 });
    expect(Date.parse(ok1.json().data.endsAt) - Date.parse(ok1.json().data.startsAt)).toBe(45 * 60_000);
    const audit = await app.prisma.auditLog.findFirstOrThrow({ where: { action: "meeting.updated" } });
    expect((audit.metadata as { fields: string[] }).fields.sort()).toEqual(["autoAdmitGuests", "durationMin", "maxParticipants", "note", "startsAt", "title"]);

    const started = await seedMeeting(editor.id, { startsInMin: -5 });
    const timeChange = await call("PATCH", `/meetings/${started.meeting.id}`, editor, { startsAt: inMinutes(120) });
    expect(timeChange.statusCode).toBe(409);
    expect(timeChange.json().error.code).toBe("MEETING_NOT_EDITABLE");
    expect((await call("PATCH", `/meetings/${started.meeting.id}`, editor, { maxParticipants: 8 })).statusCode).toBe(409);
    expect((await call("PATCH", `/meetings/${started.meeting.id}`, editor, { autoAdmitGuests: true, title: "Sırasında" })).statusCode).toBe(200);

    const windowOpen = await seedMeeting(editor.id, { startsInMin: 10 });
    expect((await call("PATCH", `/meetings/${windowOpen.meeting.id}`, editor, { maxParticipants: 8 })).statusCode).toBe(409);

    const ended = await seedMeeting(editor.id, { startsInMin: -120 });
    expect((await call("PATCH", `/meetings/${ended.meeting.id}`, editor, { title: "Geç kaldın" })).json().error.code).toBe("MEETING_NOT_EDITABLE");
    const cancelled = await seedMeeting(editor.id, { startsInMin: 120, status: "CANCELLED" });
    expect((await call("PATCH", `/meetings/${cancelled.meeting.id}`, editor, { title: "İptal" })).statusCode).toBe(409);

    expect((await call("PATCH", `/meetings/${future.meeting.id}`, editor, {})).statusCode).toBe(422);
  });

  it("iptal: misafir bağlantısı silinir, odadakiler yalnızca meet- kimlikleriyle atılır (patient:/doctor: dokunulmaz), audit", async () => {
    const { meeting } = await seedMeeting(editor.id, { startsInMin: 0 });
    lk.rooms.set(meeting.roomName, ["meet-host:1", "meet-guest:2", "patient:3", "doctor:4"]);
    const res = await call("POST", `/meetings/${meeting.id}/cancel`, editor);
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toMatchObject({ status: "CANCELLED", phase: "cancelled", guestLinkActive: false });
    expect((await app.prisma.externalMeeting.findUniqueOrThrow({ where: { id: meeting.id } })).guestTokenHash).toBeNull();
    expect(lk.removed.map(([, id]) => id).sort()).toEqual(["meet-guest:2", "meet-host:1"]);
    for (const [room] of lk.removed) expect(room).toBe(meeting.roomName);
    expect(await app.prisma.auditLog.count({ where: { action: "meeting.cancelled", targetId: meeting.id } })).toBe(1);
  });

  it("guest-link yenileme eskisini geçersiz kılar (yeni düz bağlantı yalnızca o yanıtta); DELETE bağlantıyı kaldırır; audit", async () => {
    const created = await createMeeting(editor);
    const id = created.json().data.meeting.id as string;
    const oldToken = (created.json().data.guestLink as string).split("#")[1]!;

    const regen = await call("POST", `/meetings/${id}/guest-link`, editor, { locale: "de" });
    expect(regen.statusCode).toBe(200);
    const link = regen.json().data.guestLink as string;
    expect(link).toMatch(/\/de\/meet\/join#mg_/);
    const newToken = link.split("#")[1]!;
    expect(newToken).not.toBe(oldToken);
    const row = await app.prisma.externalMeeting.findUniqueOrThrow({ where: { id } });
    expect(row.guestTokenHash).toBe(hashToken(newToken));
    expect(row.guestTokenHash).not.toBe(hashToken(oldToken));

    // gövdesiz çağrı da çalışır
    expect((await call("POST", `/meetings/${id}/guest-link`, editor)).statusCode).toBe(200);

    const del = await call("DELETE", `/meetings/${id}/guest-link`, editor);
    expect(del.statusCode).toBe(204);
    expect((await app.prisma.externalMeeting.findUniqueOrThrow({ where: { id } })).guestTokenHash).toBeNull();
    expect((await call("GET", `/meetings/${id}`, editor)).json().data.guestLinkActive).toBe(false);

    const actions = (await app.prisma.auditLog.findMany({ where: { targetId: id }, orderBy: { seq: "asc" } })).map((a) => a.action);
    expect(actions).toEqual(["meeting.created", "meeting.guest_link.created", "meeting.guest_link.created", "meeting.guest_link.created", "meeting.guest_link.revoked"]);
    expect(JSON.stringify(await app.prisma.auditLog.findMany())).not.toMatch(/mg_/);
  });

  it("iptal / bitmiş toplantıda guest-link yenilenemez (409)", async () => {
    const cancelled = await seedMeeting(editor.id, { startsInMin: 60, status: "CANCELLED" });
    expect((await call("POST", `/meetings/${cancelled.meeting.id}/guest-link`, editor, {})).statusCode).toBe(409);
    const ended = await seedMeeting(editor.id, { startsInMin: -90 });
    expect((await call("POST", `/meetings/${ended.meeting.id}/guest-link`, editor, {})).statusCode).toBe(409);
  });
});

describe("misafir listesi ve çıkarma", () => {
  it("liste: bekleyen (yoklaması taze), odadaki, çıkarılan; inRoom LiveKit'ten", async () => {
    const { meeting } = await seedMeeting(editor.id, { startsInMin: 0 });
    const now = Date.now();
    const waiting = await app.prisma.externalMeetingGuest.create({ data: { meetingId: meeting.id, displayName: "Bekleyen", lastSeenAt: new Date(now - 3000) } });
    const stale = await app.prisma.externalMeetingGuest.create({ data: { meetingId: meeting.id, displayName: "Terk", lastSeenAt: new Date(now - 120_000) } });
    const inside = await app.prisma.externalMeetingGuest.create({ data: { meetingId: meeting.id, displayName: "İçeride", lastSeenAt: new Date(now), admittedAt: new Date(now) } });
    lk.rooms.set(meeting.roomName, [`meet-guest:${inside.id}`, `meet-host:${editor.id}`]);

    const res = await call("GET", `/meetings/${meeting.id}/guests`, editor);
    expect(res.statusCode).toBe(200);
    const byName = new Map((res.json().data as Array<{ displayName: string; waiting: boolean; inRoom: boolean | null }>).map((g) => [g.displayName, g]));
    expect(byName.get("Bekleyen")).toMatchObject({ waiting: true, inRoom: false });
    expect(byName.get("Terk")).toMatchObject({ waiting: false });
    expect(byName.get("İçeride")).toMatchObject({ waiting: false, inRoom: true });
    expect(waiting.id).toBeDefined();
    expect(stale.id).toBeDefined();

    lk.unavailable = true;
    const unknown = await call("GET", `/meetings/${meeting.id}/guests`, editor);
    expect(unknown.json().data[0].inRoom).toBeNull();
  });

  it("çıkar: removedAt yazılır, yalnızca o misafirin meet-guest kimliği atılır, audit'te yalnız guestId", async () => {
    const { meeting } = await seedMeeting(editor.id, { startsInMin: 0 });
    const guest = await app.prisma.externalMeetingGuest.create({ data: { meetingId: meeting.id, displayName: "Kovulacak", admittedAt: new Date() } });
    const other = await app.prisma.externalMeetingGuest.create({ data: { meetingId: meeting.id, displayName: "Kalacak", admittedAt: new Date() } });
    lk.rooms.set(meeting.roomName, [`meet-guest:${guest.id}`, `meet-guest:${other.id}`, `meet-host:${editor.id}`]);

    const res = await call("POST", `/meetings/${meeting.id}/guests/${guest.id}/remove`, editor);
    expect(res.statusCode).toBe(204);
    expect((await app.prisma.externalMeetingGuest.findUniqueOrThrow({ where: { id: guest.id } })).removedAt).not.toBeNull();
    expect(lk.removed).toEqual([[meeting.roomName, `meet-guest:${guest.id}`]]);
    const audit = await app.prisma.auditLog.findFirstOrThrow({ where: { action: "meeting.guest.removed" } });
    expect(audit.metadata).toEqual({ guestId: guest.id });
    expect(JSON.stringify(audit)).not.toContain("Kovulacak");

    // başka toplantının misafiri → 404
    const foreign = await seedMeeting(editor.id, { startsInMin: 0 });
    expect((await call("POST", `/meetings/${foreign.meeting.id}/guests/${other.id}/remove`, editor)).statusCode).toBe(404);
  });
});

describe("e-postayla davet (yalnızca oluşturma anındaki bağlantıyla)", () => {
  it("özet eşleşirse kurumsal e-posta gönderilir (audience user, bağlantı sunucuda kurulur); adres saklanmaz / audit'e yazılmaz", async () => {
    const created = await createMeeting(editor, { locale: "de" });
    const id = created.json().data.meeting.id as string;
    const guestLink = created.json().data.guestLink as string;
    const res = await call("POST", `/meetings/${id}/invite-email`, editor, { guestLink, email: "Konuk@Example.com", locale: "de" });
    expect(res.statusCode).toBe(202);
    expect(res.json().data).toEqual({ sent: true });
    expect(lk.mail).toHaveLength(1);
    const mail = lk.mail[0] as { to: string; audience: string; locale: string; cta: { url: string }; bodyHtml: string };
    expect(mail.to).toBe("Konuk@Example.com");
    expect(mail.audience).toBe("user");
    expect(mail.locale).toBe("de");
    // Yerel geliştirmede yanıt gövdesinden loopback kaynağı sıyrılır (sanitize-localhost-media-urls); e-posta tam adres taşır.
    expect(mail.cta.url.endsWith(guestLink)).toBe(true);
    expect(mail.cta.url).toMatch(/^https?:\/\/.+\/de\/meet\/join#mg_/);
    expect(mail.bodyHtml).not.toContain(editor.email);

    const audit = await app.prisma.auditLog.findFirstOrThrow({ where: { action: "meeting.invite.sent" } });
    expect(audit.metadata).toEqual({ count: 1 });
    expect(JSON.stringify(await app.prisma.auditLog.findMany())).not.toMatch(/Konuk|mg_/);
    expect(JSON.stringify(await app.prisma.externalMeeting.findMany())).not.toMatch(/Konuk/);
  });

  it("yenilenmiş (eski) bağlantı → 409, e-posta gitmez; bozuk bağlantı → 422; iptal edilmiş bağlantı → 409", async () => {
    const created = await createMeeting(editor);
    const id = created.json().data.meeting.id as string;
    const oldLink = created.json().data.guestLink as string;
    const regen = await call("POST", `/meetings/${id}/guest-link`, editor, {});
    const stale = await call("POST", `/meetings/${id}/invite-email`, editor, { guestLink: oldLink, email: "a@example.com" });
    expect(stale.statusCode).toBe(409);
    expect(lk.mail).toHaveLength(0);
    expect((await call("POST", `/meetings/${id}/invite-email`, editor, { guestLink: "x".repeat(50), email: "a@example.com" })).statusCode).toBe(422);
    expect((await call("POST", `/meetings/${id}/invite-email`, editor, { guestLink: regen.json().data.guestLink, email: "a@example.com" })).statusCode).toBe(202);

    await call("DELETE", `/meetings/${id}/guest-link`, editor);
    expect((await call("POST", `/meetings/${id}/invite-email`, editor, { guestLink: regen.json().data.guestLink, email: "a@example.com" })).statusCode).toBe(409);
  });

  it("gönderim hatası 202'yi bozmaz (sent=false, audit yok); toplantı başına en çok 10 davet", async () => {
    const created = await createMeeting(editor);
    const id = created.json().data.meeting.id as string;
    const guestLink = created.json().data.guestLink as string;

    lk.mailFails = true;
    const failed = await call("POST", `/meetings/${id}/invite-email`, editor, { guestLink, email: "a@example.com" });
    expect(failed.statusCode).toBe(202);
    expect(failed.json().data).toEqual({ sent: false });
    expect(await app.prisma.auditLog.count({ where: { action: "meeting.invite.sent" } })).toBe(0);
    lk.mailFails = false;

    // 1 deneme harcandı; 9 daha → 10; 11. → 409 (5/dk sınırı için IP değiştirilir)
    for (let i = 0; i < 9; i += 1) {
      expect((await call("POST", `/meetings/${id}/invite-email`, editor, { guestLink, email: `k${i}@example.com` })).statusCode).toBe(202);
    }
    const over = await call("POST", `/meetings/${id}/invite-email`, editor, { guestLink, email: "fazla@example.com" });
    expect(over.statusCode).toBe(409);
    expect(over.json().error.code).toBe("MEETING_LIMIT_REACHED");
  });

  it("oran sınırı: 5/dk (6. istek 429)", async () => {
    const created = await createMeeting(editor);
    const id = created.json().data.meeting.id as string;
    const guestLink = created.json().data.guestLink as string;
    const ip = nextIp();
    for (let i = 0; i < 5; i += 1) expect((await call("POST", `/meetings/${id}/invite-email`, editor, { guestLink, email: "a@example.com" }, ip)).statusCode).toBe(202);
    expect((await call("POST", `/meetings/${id}/invite-email`, editor, { guestLink, email: "a@example.com" }, ip)).statusCode).toBe(429);
  });
});
