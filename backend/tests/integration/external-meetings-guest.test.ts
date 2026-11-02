import crypto from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { TokenVerifier } from "livekit-server-sdk";

/**
 * Paket AG (İş 3) — herkese açık misafir uçları (/meet/guest/*): sızıntısız tek tip 404, bekleme kapısı,
 * kapasite (ev sahibi dahil), oturum, audit (ad/IP yok), oran sınırı. LiveKit Server API `lk` ile taklit edilir.
 */
const lk = vi.hoisted(() => {
  process.env.LIVEKIT_URL = "wss://fake-project.livekit.cloud";
  process.env.LIVEKIT_API_KEY = "fake-api-key";
  process.env.LIVEKIT_API_SECRET = "fake-api-secret-for-tests-only";
  return { rooms: new Map<string, string[]>(), removed: [] as Array<[string, string]>, unavailable: false, failList: false };
});

vi.mock("../../src/modules/telehealth/lib/livekit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/modules/telehealth/lib/livekit")>();
  return {
    ...actual,
    listRoomParticipantIdentities: vi.fn(async (room: string) => {
      if (lk.failList) throw new Error("livekit down");
      return lk.unavailable ? null : [...(lk.rooms.get(room) ?? [])];
    }),
    removeRoomParticipant: vi.fn(async (room: string, identity: string) => {
      lk.removed.push([room, identity]);
      lk.rooms.set(room, (lk.rooms.get(room) ?? []).filter((id) => id !== identity));
      return true;
    }),
  };
});

import { buildTestApp } from "../helpers/build-test-app";
import { resetDatabase } from "../helpers/reset-db";
import { signAccessToken } from "../../src/lib/jwt";
import { env } from "../../src/config/env";
import { generateGuestToken, issueGuestSession } from "../../src/modules/meetings/meeting-tokens";

let app: FastifyInstance;
let ipCounter = 0;
const nextIp = () => `10.30.${Math.floor(++ipCounter / 250)}.${(ipCounter % 250) + 1}`;

let host: { id: string; email: string; name: string };

async function seed(opts: { startsInMin?: number; durationMin?: number; status?: "SCHEDULED" | "CANCELLED"; max?: number; autoAdmit?: boolean; hostUserId?: string } = {}) {
  const startsAt = new Date(Date.now() + (opts.startsInMin ?? 0) * 60_000);
  const durationMin = opts.durationMin ?? 30;
  const { token, hash } = generateGuestToken();
  const meeting = await app.prisma.externalMeeting.create({
    data: {
      hostUserId: opts.hostUserId ?? host.id,
      title: "Koordinasyon görüşmesi",
      note: "ÇOK-GİZLİ-NOT",
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

function post(path: "preflight" | "join", body: Record<string, unknown>, ip?: string) {
  return app.inject({ method: "POST", url: `/api/v1/meet/guest/${path}`, payload: body, remoteAddress: ip ?? nextIp() });
}

function join(token: string, extra: Record<string, unknown> = {}, ip?: string) {
  return post("join", { t: token, ...extra }, ip);
}

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
  lk.unavailable = false;
  lk.failList = false;
  await app.prisma.externalMeeting.deleteMany();
  await app.prisma.auditLog.deleteMany();
  await app.prisma.user.deleteMany();
  host = await app.prisma.user.create({
    data: { email: `host-${crypto.randomUUID()}@example.com`, name: "Ev Sahibi Hesap", passwordHash: "x", role: "EDITOR", status: "ACTIVE", emailVerifiedAt: new Date(), meetingHostGrantedAt: new Date() },
  });
});

describe("tek tip 404 (sızıntısızlık)", () => {
  it("geçersiz biçim, bilinmeyen, yenilenmiş eski, iptal edilmiş bağlantı/toplantı, bitmiş toplantı ve çıkarılmış oturum: gövde + durum + başlıklar bayt bayt aynı", async () => {
    const live = await seed({ startsInMin: 0 });
    const regenerated = await seed({ startsInMin: 0 });
    const oldToken = regenerated.token;
    const fresh = generateGuestToken();
    await app.prisma.externalMeeting.update({ where: { id: regenerated.meeting.id }, data: { guestTokenHash: fresh.hash } });
    const cancelled = await seed({ startsInMin: 0, status: "CANCELLED" });
    const revoked = await seed({ startsInMin: 0 });
    await app.prisma.externalMeeting.update({ where: { id: revoked.meeting.id }, data: { guestTokenHash: null } });
    const ended = await seed({ startsInMin: -40, durationMin: 30 });
    const suspendedHost = await app.prisma.user.create({ data: { email: `s-${crypto.randomUUID()}@example.com`, name: "S", passwordHash: "x", role: "EDITOR", status: "SUSPENDED" } });
    const orphan = await seed({ startsInMin: 0, hostUserId: suspendedHost.id });

    // çıkarılmış misafir oturumu ve kurcalanmış / başka toplantı / süresi dolmuş oturumlar
    const removedGuest = await app.prisma.externalMeetingGuest.create({ data: { meetingId: live.meeting.id, displayName: "Çıkarılan", removedAt: new Date() } });
    const removedSession = issueGuestSession(removedGuest.id, live.meeting.id, live.meeting.endsAt);
    const okGuest = await app.prisma.externalMeetingGuest.create({ data: { meetingId: live.meeting.id, displayName: "Normal" } });
    const okSession = issueGuestSession(okGuest.id, live.meeting.id, live.meeting.endsAt);
    const tampered = okSession.slice(0, -3) + (okSession.endsWith("aaa") ? "bbb" : "aaa");
    const foreignSession = issueGuestSession(okGuest.id, cancelled.meeting.id, live.meeting.endsAt);
    const expiredSession = issueGuestSession(okGuest.id, live.meeting.id, new Date(Date.now() - 20 * 60_000));

    const cases: Array<Record<string, unknown>> = [
      { t: "bozuk" },
      { t: "" },
      { t: `mg_${"A".repeat(43)}` },
      { t: oldToken },
      { t: cancelled.token },
      { t: revoked.token },
      { t: ended.token },
      { t: orphan.token },
      { t: live.token, guestSession: removedSession },
      { t: live.token, guestSession: tampered },
      { t: live.token, guestSession: foreignSession },
      { t: live.token, guestSession: expiredSession },
      { t: live.token, guestSession: "gs_v1.a.b.c" },
    ];
    const responses = [];
    for (const body of cases) {
      const res = await join(String(body.t), body.guestSession ? { guestSession: body.guestSession } : { name: "Ada" });
      responses.push(res);
    }
    for (const body of cases.filter((c) => !c.guestSession)) {
      responses.push(await post("preflight", { t: body.t }));
    }
    const first = responses[0]!;
    expect(first.statusCode).toBe(404);
    expect(first.json().error.code).toBe("MEETING_LINK_INVALID");
    for (const res of responses) {
      expect(res.statusCode).toBe(404);
      expect(res.body).toBe(first.body);
      expect(res.headers["cache-control"]).toBe("no-store");
      expect(res.headers["x-robots-tag"]).toBe("noindex, nofollow");
    }
  });

  it("belirteç URL/query'de değil: GET /meet/guest/join yok (404/405), query ile verilen belirteç işe yaramaz", async () => {
    const live = await seed({ startsInMin: 0 });
    const res = await app.inject({ method: "GET", url: `/api/v1/meet/guest/join?t=${live.token}`, remoteAddress: nextIp() });
    expect(res.statusCode).toBe(404);
    const viaQuery = await app.inject({ method: "POST", url: `/api/v1/meet/guest/join?t=${live.token}`, payload: { t: "x", name: "Ada" }, remoteAddress: nextIp() });
    expect(viaQuery.statusCode).toBe(404);
  });

  it("modül kapalıyken 404", async () => {
    const live = await seed({ startsInMin: 0 });
    await app.prisma.siteModule.update({ where: { key: "telehealth" }, data: { enabled: false } });
    try {
      expect((await join(live.token, { name: "Ada" })).statusCode).toBe(404);
    } finally {
      await app.prisma.siteModule.update({ where: { key: "telehealth" }, data: { enabled: true } });
    }
  });
});

describe("preflight", () => {
  it("yalnızca başlık, ev sahibi görünen adı, zamanlar ve faz döner (not, e-posta, meetingId, oda yok)", async () => {
    const live = await seed({ startsInMin: 60 });
    const res = await post("preflight", { t: live.token });
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(Object.keys(data).sort()).toEqual(["endsAt", "hostName", "phase", "startsAt", "title"]);
    expect(data).toMatchObject({ title: "Koordinasyon görüşmesi", hostName: "Ev Sahibi Hesap", phase: "upcoming" });
    expect(res.body).not.toMatch(/ÇOK-GİZLİ|example\.com|meet_|mg_|"id"/);
    expect((await post("preflight", { t: (await seed({ startsInMin: 5 })).token })).json().data.phase).toBe("open");
    // preflight misafir kaydı oluşturmaz
    expect(await app.prisma.externalMeetingGuest.count()).toBe(0);
  });

  it("doktor ev sahibinde unvansız kısaltılmış ad", async () => {
    const specialty = await app.prisma.specialty.create({ data: { name: `U ${crypto.randomUUID()}`, slug: `u-${crypto.randomUUID()}`, icon: "heart-pulse" } });
    await app.prisma.doctorProfile.create({
      data: { title: "Op. Dr.", fullName: "Mehmet DEMİR", slug: `d-${crypto.randomUUID()}`, bio: "t", languages: ["tr"], timeZone: "Europe/Istanbul", specialtyId: specialty.id, sessionDurationMin: 30, sessionPriceCents: 1, currency: "TRY", isActive: true, userId: host.id },
    });
    const live = await seed({ startsInMin: 0 });
    expect((await post("preflight", { t: live.token })).json().data.hostName).toBe("M. Demir");
  });
});

describe("join — pencere, bekleme, kapasite, token", () => {
  it("pencere öncesi 409 MEETING_NOT_OPEN (opensAt); misafir kaydı oluşmaz; 15 dk kala açılır", async () => {
    const early = await seed({ startsInMin: 60 });
    const res = await join(early.token, { name: "Ada" });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("MEETING_NOT_OPEN");
    expect(Date.parse(res.json().error.details.opensAt[0])).toBe(early.meeting.startsAt.getTime() - 15 * 60_000);
    expect(await app.prisma.externalMeetingGuest.count()).toBe(0);
    expect((await join((await seed({ startsInMin: 14, autoAdmit: true })).token, { name: "Ada" })).statusCode).toBe(200);
    expect((await join((await seed({ startsInMin: 16, autoAdmit: true })).token, { name: "Ada" })).statusCode).toBe(409);
  });

  it("ev sahibi odada değilken waiting (token yok); ev sahibi gelince aynı oturumla ready", async () => {
    const { meeting, token } = await seed({ startsInMin: 0 });
    const first = await join(token, { name: "Zeynep Kaya" });
    expect(first.statusCode).toBe(200);
    expect(first.json().data).toMatchObject({ status: "waiting", pollAfterSec: 5 });
    expect(first.json().data.token).toBeUndefined();
    const session = first.json().data.guestSession as string;
    expect(session).toMatch(/^gs_v1\./);
    const guest = await app.prisma.externalMeetingGuest.findFirstOrThrow({ where: { meetingId: meeting.id } });
    expect(guest.displayName).toBe("Zeynep Kaya");
    expect(guest.lastSeenAt).not.toBeNull();
    expect(guest.admittedAt).toBeNull();

    // yoklama: hâlâ bekler, yeni misafir kaydı oluşmaz
    const poll = await join(token, { guestSession: session });
    expect(poll.json().data.status).toBe("waiting");
    expect(await app.prisma.externalMeetingGuest.count()).toBe(1);

    // yalnızca misafirler odadaysa ev sahibi yok sayılır
    lk.rooms.set(meeting.roomName, ["meet-guest:baska"]);
    expect((await join(token, { guestSession: session })).json().data.status).toBe("waiting");

    lk.rooms.set(meeting.roomName, [`meet-host:${host.id}`]);
    const ready = await join(token, { guestSession: session });
    expect(ready.statusCode).toBe(200);
    expect(ready.json().data.status).toBe("ready");
    expect(ready.json().data.guestSession).toBe(session);
    expect(ready.json().data.roomName).toBe(meeting.roomName);

    const claims = await new TokenVerifier(env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET).verify(ready.json().data.token);
    expect(claims.sub).toBe(`meet-guest:${guest.id}`);
    expect(claims.name).toBe("Zeynep Kaya");
    const video = claims.video as Record<string, unknown>;
    expect(video.room).toBe(meeting.roomName);
    expect([...(video.canPublishSources as string[])].sort()).toEqual(["camera", "microphone"]);
    for (const grant of ["roomAdmin", "roomRecord", "roomCreate", "roomList", "hidden"]) expect(video[grant]).toBeUndefined();
    expect(video.canPublishData).toBe(false);
    expect(video.canUpdateOwnMetadata).toBe(false);
    expect(Date.parse(ready.json().data.expiresAt)).toBeLessThanOrEqual(meeting.endsAt.getTime() + 10 * 60_000 + 2000);
    expect((await app.prisma.externalMeetingGuest.findUniqueOrThrow({ where: { id: guest.id } })).admittedAt).not.toBeNull();
  });

  it("autoAdmitGuests açıkken ev sahibini beklemeden ready; LiveKit okuması bozuksa (autoAdmit kapalı) güvenli tarafta waiting", async () => {
    const auto = await seed({ startsInMin: 0, autoAdmit: true });
    expect((await join(auto.token, { name: "Ada" })).json().data.status).toBe("ready");
    const closed = await seed({ startsInMin: 0 });
    lk.failList = true;
    expect((await join(closed.token, { name: "Ada" })).json().data.status).toBe("waiting");
  });

  it("Server API yapılandırılmamışsa (LIVEKIT_INTERNAL_URL boş) yedek: hostJoinedAt dolu mu", async () => {
    const { meeting, token } = await seed({ startsInMin: 0 });
    lk.unavailable = true;
    expect((await join(token, { name: "Ada" })).json().data.status).toBe("waiting");
    await app.prisma.externalMeeting.update({ where: { id: meeting.id }, data: { hostJoinedAt: new Date() } });
    expect((await join(token, { name: "Bob" })).json().data.status).toBe("ready");
  });

  it("kapasite ev sahibi DAHİL: max 2 → yalnızca 1 misafir; ikinci misafir 409 MEETING_FULL; mevcut misafir yeniden bağlanabilir", async () => {
    const { meeting, token } = await seed({ startsInMin: 0, max: 2 });
    lk.rooms.set(meeting.roomName, [`meet-host:${host.id}`]);
    const a = await join(token, { name: "Ada" });
    expect(a.json().data.status).toBe("ready");
    const guestA = await app.prisma.externalMeetingGuest.findFirstOrThrow({ where: { meetingId: meeting.id } });
    lk.rooms.set(meeting.roomName, [`meet-host:${host.id}`, `meet-guest:${guestA.id}`]);

    const b = await join(token, { name: "Bob" });
    expect(b.statusCode).toBe(409);
    expect(b.json().error.code).toBe("MEETING_FULL");

    // A'nın aynı oturumla yeniden bağlanması kendi kimliğini saymaz
    const again = await join(token, { guestSession: a.json().data.guestSession });
    expect(again.statusCode).toBe(200);
    expect(again.json().data.status).toBe("ready");
  });

  it("kapasite: varsayılan 4 → 3 misafir girer, 4. dolu; doğrudan alma açıkken ev sahibi gelmemiş olsa da son koltuk ayrılır", async () => {
    const { meeting, token } = await seed({ startsInMin: 0, autoAdmit: true });
    for (let i = 0; i < 3; i += 1) {
      const res = await join(token, { name: `Misafir ${i}` });
      expect(res.json().data.status).toBe("ready");
      const guests = await app.prisma.externalMeetingGuest.findMany({ where: { meetingId: meeting.id } });
      lk.rooms.set(meeting.roomName, guests.filter((g) => g.admittedAt).map((g) => `meet-guest:${g.id}`));
    }
    const fourth = await join(token, { name: "Dördüncü" });
    expect(fourth.statusCode).toBe(409);
    expect(fourth.json().error.code).toBe("MEETING_FULL");
  });

  it("toplantı başına en çok 50 misafir oturumu → 409 MEETING_FULL", async () => {
    const { meeting, token } = await seed({ startsInMin: 0, autoAdmit: true });
    await app.prisma.externalMeetingGuest.createMany({ data: Array.from({ length: 50 }, (_, i) => ({ meetingId: meeting.id, displayName: `Bot ${i}` })) });
    const res = await join(token, { name: "Yeni" });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("MEETING_FULL");
    expect(await app.prisma.externalMeetingGuest.count({ where: { meetingId: meeting.id } })).toBe(50);
  });

  it("ad zorunlu ve doğrulanır (422); toplantı bitişinde (endsAt) yeni katılım kapanır (404)", async () => {
    const { token } = await seed({ startsInMin: 0, autoAdmit: true });
    expect((await join(token)).statusCode).toBe(422);
    for (const bad of ["A", "<script>", "Ali‮evil", "meet-host:x", "A".repeat(41)]) {
      const res = await join(token, { name: bad });
      expect(res.statusCode, bad).toBe(422);
      expect(res.json().error.code).toBe("VALIDATION_ERROR");
      expect(res.json().error.details.name).toBeDefined();
    }
    expect(await app.prisma.externalMeetingGuest.count()).toBe(0);
    expect((await join(token, { name: "  José   María  " })).statusCode).toBe(200);
    expect((await app.prisma.externalMeetingGuest.findFirstOrThrow()).displayName).toBe("José María");

    const justEnded = await seed({ startsInMin: -30, durationMin: 30 });
    await app.prisma.externalMeeting.update({ where: { id: justEnded.meeting.id }, data: { endsAt: new Date(Date.now() - 1000) } });
    expect((await join(justEnded.token, { name: "Geç" })).statusCode).toBe(404);
  });

  it("LiveKit yapılandırılmamışsa: geçerli belirteç 503, geçersiz belirteç hâlâ 404 (yapılandırma bilgisi sızmaz)", async () => {
    const { token } = await seed({ startsInMin: 0 });
    const saved = env.LIVEKIT_URL;
    env.LIVEKIT_URL = "";
    try {
      const ok = await join(token, { name: "Ada" });
      expect(ok.statusCode).toBe(503);
      expect(ok.json().error.code).toBe("LIVEKIT_NOT_CONFIGURED");
      expect((await join(`mg_${"B".repeat(43)}`, { name: "Ada" })).statusCode).toBe(404);
    } finally {
      env.LIVEKIT_URL = saved;
    }
  });

  it("çıkarılan misafir aynı oturumla token alamaz (404)", async () => {
    const { meeting, token } = await seed({ startsInMin: 0, autoAdmit: true });
    const first = await join(token, { name: "Ada" });
    const guest = await app.prisma.externalMeetingGuest.findFirstOrThrow({ where: { meetingId: meeting.id } });
    await app.prisma.externalMeetingGuest.update({ where: { id: guest.id }, data: { removedAt: new Date() } });
    const again = await join(token, { guestSession: first.json().data.guestSession });
    expect(again.statusCode).toBe(404);
    expect(again.json().error.code).toBe("MEETING_LINK_INVALID");
  });
});

describe("ziyaretçiye dönen hata mesajları Türkçe değil", () => {
  it("geçersiz bağlantı, pencere öncesi, dolu, ad doğrulaması: mesajlar İngilizce (Türkçe harf yok)", async () => {
    const TURKISH = /[ğĞıİşŞçÇöÖüÜ]/;
    const bodies: string[] = [];
    bodies.push((await join("mg_" + "x".repeat(43), { name: "Ada" })).body);
    const early = await seed({ startsInMin: 120 });
    bodies.push((await join(early.token, { name: "Ada" })).body);
    const open = await seed({ startsInMin: 0, max: 2, autoAdmit: true });
    lk.rooms.set(open.meeting.roomName, [`meet-host:${host.id}`]);
    bodies.push((await join(open.token)).body);
    bodies.push((await join(open.token, { name: "A" })).body);
    bodies.push((await join(open.token, { name: "<b>" })).body);
    bodies.push((await join(open.token, { name: "Ali​X" })).body);
    bodies.push((await join(open.token, { name: "meet-x" })).body);
    lk.rooms.set(open.meeting.roomName, [`meet-host:${host.id}`, "meet-guest:other"]);
    const full = await join(open.token, { name: "Bob" });
    expect(full.statusCode).toBe(409);
    bodies.push(full.body);
    for (const body of bodies) expect(body).not.toMatch(TURKISH);
  });
});

describe("audit", () => {
  it("meeting.guest.joined yalnızca ilk ready anında; actor yok, IP null, metadata yalnız guestId (ad / belirteç yok)", async () => {
    const { meeting, token } = await seed({ startsInMin: 0, autoAdmit: true });
    const first = await join(token, { name: "Gizli Ad Soyad" });
    await join(token, { guestSession: first.json().data.guestSession });
    await join(token, { guestSession: first.json().data.guestSession });
    const guest = await app.prisma.externalMeetingGuest.findFirstOrThrow({ where: { meetingId: meeting.id } });

    const rows = await app.prisma.auditLog.findMany({ where: { action: "meeting.guest.joined" } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actorId: null, actorEmail: null, ipAddress: null, targetType: "ExternalMeeting", targetId: meeting.id });
    expect(rows[0]!.metadata).toEqual({ guestId: guest.id });
    const dump = JSON.stringify(await app.prisma.auditLog.findMany());
    expect(dump).not.toMatch(/Gizli Ad|mg_|gs_v1|10\.30\./);
  });

  it("bekleyen misafir için audit yazılmaz (token verilmedi)", async () => {
    const { token } = await seed({ startsInMin: 0 });
    await join(token, { name: "Bekleyen" });
    expect(await app.prisma.auditLog.count({ where: { action: "meeting.guest.joined" } })).toBe(0);
  });
});

describe("oran sınırı", () => {
  it("join: 30/dk IP (31. istek 429 RATE_LIMITED + Retry-After); başka IP etkilenmez", async () => {
    const { token } = await seed({ startsInMin: 0 });
    const ip = nextIp();
    for (let i = 0; i < 30; i += 1) expect((await join(token, { name: "Ada" }, ip)).statusCode).toBe(200);
    const blocked = await join(token, { name: "Ada" }, ip);
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json().error.code).toBe("RATE_LIMITED");
    expect(blocked.headers["retry-after"]).toBeDefined();
    expect((await join(token, { name: "Ada" }, nextIp())).statusCode).toBe(200);
  });

  it("preflight: 30/dk IP (geçersiz belirteçle de sayılır)", async () => {
    const ip = nextIp();
    for (let i = 0; i < 30; i += 1) expect((await post("preflight", { t: "bozuk" }, ip)).statusCode).toBe(404);
    const blocked = await post("preflight", { t: "bozuk" }, ip);
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json().error.code).toBe("RATE_LIMITED");
  });
});

describe("ev sahibi çıkarınca ve iptalde bağlantı", () => {
  it("iptal edilen toplantının bağlantısı anında 404; ev sahibi bağlantıyı iptal edince de 404", async () => {
    const { meeting, token } = await seed({ startsInMin: 0, autoAdmit: true });
    expect((await join(token, { name: "Ada" })).statusCode).toBe(200);
    const bearer = { authorization: `Bearer ${signAccessToken({ sub: host.id, email: host.email }).token}` };
    const cancel = await app.inject({ method: "POST", url: `/api/v1/meetings/${meeting.id}/cancel`, headers: bearer, remoteAddress: nextIp() });
    expect(cancel.statusCode).toBe(200);
    expect((await join(token, { name: "Bob" })).statusCode).toBe(404);
    expect((await post("preflight", { t: token })).statusCode).toBe(404);

    const other = await seed({ startsInMin: 0, autoAdmit: true });
    const del = await app.inject({ method: "DELETE", url: `/api/v1/meetings/${other.meeting.id}/guest-link`, headers: bearer, remoteAddress: nextIp() });
    expect(del.statusCode).toBe(204);
    expect((await join(other.token, { name: "Ada" })).statusCode).toBe(404);
  });
});
