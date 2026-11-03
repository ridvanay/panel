import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { TokenVerifier } from "livekit-server-sdk";

/**
 * Paket AI (Is 3, hizli surum) - koordinator uclari (liste/detay/mesaj/host-token), misafir katilimi (preflight purpose,
 * "Patient Coordinator" adi reddi, bekleme/hazir), /users/me turetilmis alani ve hatirlatma supurucusu.
 */
const mailSpy = vi.hoisted(() => vi.fn());
const lk = vi.hoisted(() => {
  process.env.LIVEKIT_URL = "wss://fake-project.livekit.cloud";
  process.env.LIVEKIT_API_KEY = "fake-api-key";
  process.env.LIVEKIT_API_SECRET = "fake-api-secret-for-tests-only";
  return { rooms: new Map<string, string[]>() };
});
vi.mock("../../src/lib/mail", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/lib/mail")>();
  return { ...actual, sendMail: (...args: unknown[]) => (mailSpy(...args), Promise.resolve({ messageId: "test" })) };
});
vi.mock("../../src/modules/telehealth/lib/livekit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/modules/telehealth/lib/livekit")>();
  return {
    ...actual,
    listRoomParticipantIdentities: vi.fn(async (room: string) => [...(lk.rooms.get(room) ?? [])]),
    removeRoomParticipant: vi.fn(async () => true),
  };
});

import { buildTestApp } from "../helpers/build-test-app";
import { resetDatabase } from "../helpers/reset-db";
import { env } from "../../src/config/env";
import { hashToken } from "../../src/lib/tokens";
import { runServiceConsultationReminderSweep } from "../../src/modules/service-consultations/service-consultation-reminders";
import { bearer, mkCoordinator, mkSpecialty, mkUser, nextIp, openDesk, seedConsultation } from "../helpers/service-desk";

interface SentMail {
  to: string;
  subject: string;
  html: string;
}
const sent = (): SentMail[] => mailSpy.mock.calls.map((c) => c[1] as SentMail);
const inMin = (m: number) => new Date(Date.now() + m * 60_000);

describe("Paket AI - koordinator, misafir katilimi, hatirlatmalar", () => {
  let app: FastifyInstance;
  let c1: Awaited<ReturnType<typeof mkCoordinator>>;

  const api = (method: "GET" | "POST", url: string, payload?: unknown, headers: Record<string, string> = {}) =>
    app.inject({ method, url: `/api/v1${url}`, ...(payload !== undefined ? { payload: payload as object } : {}), headers, remoteAddress: nextIp("10.78") });

  beforeAll(async () => {
    app = await buildTestApp();
  });
  afterAll(async () => {
    await resetDatabase(app.prisma);
    await app.close();
  });
  beforeEach(async () => {
    await resetDatabase(app.prisma);
    lk.rooms.clear();
    mailSpy.mockClear();
    await app.prisma.siteModule.upsert({ where: { key: "telehealth" }, create: { key: "telehealth", enabled: true }, update: { enabled: true } });
    await mkSpecialty(app);
    c1 = await mkCoordinator(app, { displayName: "Ayşe K.", languages: ["en"] });
    await openDesk(app);
  });

  describe("kapi ve liste", () => {
    it("koordinator olmayan EDITOR 403; oturumsuz 401; /users/me isServiceCoordinator turetilir", async () => {
      const editor = await mkUser(app, "EDITOR");
      expect((await api("GET", "/coordinator/consultations", undefined, bearer(editor))).statusCode).toBe(403);
      expect((await api("GET", "/coordinator/consultations")).statusCode).toBe(401);
      expect((await api("GET", "/users/me", undefined, bearer(editor))).json().data.isServiceCoordinator).toBe(false);
      expect((await api("GET", "/users/me", undefined, bearer(c1))).json().data.isServiceCoordinator).toBe(true);
      // Frontend oturum bağlamı /auth/me kullanır (e2e bulgusu B1): bayrak orada da türetilmeli.
      expect((await api("GET", "/auth/me", undefined, bearer(c1))).json().data.user.isServiceCoordinator).toBe(true);
      await app.prisma.coordinatorProfile.update({ where: { id: c1.profileId }, data: { isActive: false } });
      expect((await api("GET", "/users/me", undefined, bearer(c1))).json().data.isServiceCoordinator).toBe(false);
      expect((await api("GET", "/coordinator/consultations", undefined, bearer(c1))).statusCode).toBe(403);
    });

    it("liste: yalniz KENDI gorusmeleri; today/upcoming; alanlar; canJoin penceresi", async () => {
      const c2 = await mkCoordinator(app, { displayName: "Bora T." });
      const open = await seedConsultation(app, { coordinatorProfileId: c1.profileId, coordinatorUserId: c1.id, startsAt: inMin(5), fullName: "Ali Veli", message: "msg", needsInterpreter: true, interpreterLanguage: "ar", contactLanguage: "ar" });
      const later = await seedConsultation(app, { coordinatorProfileId: c1.profileId, coordinatorUserId: c1.id, startsAt: new Date(Date.now() + 3 * 86_400_000) });
      await seedConsultation(app, { coordinatorProfileId: c2.profileId, coordinatorUserId: c2.id, startsAt: inMin(5) });
      const up = await api("GET", "/coordinator/consultations?scope=upcoming", undefined, bearer(c1));
      expect(up.statusCode).toBe(200);
      const rows = up.json().data as Array<Record<string, unknown>>;
      expect(rows.map((r) => r.id)).toEqual([open.consultation.id, later.consultation.id]);
      expect(rows[0]).toMatchObject({
        patientName: "Ali Veli",
        country: "DE",
        contactLanguage: "ar",
        needsInterpreter: true,
        interpreterLanguage: "ar",
        hasMessage: true,
        canJoin: true,
        status: "SCHEDULED",
        serviceName: "Gastroenterology",
      });
      expect(Object.keys(rows[0]!)).not.toContain("email");
      expect(rows[1]!.canJoin).toBe(false);
      const today = await api("GET", "/coordinator/consultations?scope=today", undefined, bearer(c1));
      expect(today.statusCode).toBe(200);
      expect((today.json().data as Array<{ id: string }>).every((r) => r.id !== later.consultation.id)).toBe(true);
    });

    it("detay: e-posta/telefon doner, audit service_consultation.viewed (kisisel veri yok); baskasinin kaydi ve ADMIN 404", async () => {
      const c2 = await mkCoordinator(app, { displayName: "Bora T." });
      const mine = await seedConsultation(app, { coordinatorProfileId: c1.profileId, coordinatorUserId: c1.id, startsAt: inMin(60), email: "pat@example.com" });
      const res = await api("GET", `/coordinator/consultations/${mine.consultation.id}`, undefined, bearer(c1));
      expect(res.statusCode).toBe(200);
      expect(res.json().data).toMatchObject({ email: "pat@example.com", phone: "+491701234567" });
      const audit = await app.prisma.auditLog.findFirstOrThrow({ where: { action: "service_consultation.viewed" } });
      expect(audit.targetId).toBe(mine.consultation.id);
      expect(JSON.stringify(audit)).not.toContain("pat@example.com");
      expect((await api("GET", `/coordinator/consultations/${mine.consultation.id}`, undefined, bearer(c2))).statusCode).toBe(404);
      const admin = await mkUser(app, "ADMIN");
      expect((await api("GET", `/coordinator/consultations/${mine.consultation.id}`, undefined, bearer(admin))).statusCode).toBe(404);
    });
  });

  describe("talep mesaji", () => {
    it("2FA kapaliysa 403 TWO_FACTOR_REQUIRED (mesaj cozulmez, audit yok)", async () => {
      const noTwoFa = await mkCoordinator(app, { displayName: "Cem D.", twoFactorEnabled: false });
      const row = await seedConsultation(app, { coordinatorProfileId: noTwoFa.profileId, coordinatorUserId: noTwoFa.id, startsAt: inMin(60), message: "Gizli mesaj" });
      const res = await api("GET", `/coordinator/consultations/${row.consultation.id}/message`, undefined, bearer(noTwoFa));
      expect(res.statusCode).toBe(403);
      expect(res.json().error.code).toBe("TWO_FACTOR_REQUIRED");
      expect(await app.prisma.auditLog.count({ where: { action: "service_consultation.message_viewed" } })).toBe(0);
    });

    it("2FA aciksa mesaji doner (no-store), HER cagri audit'e yazilir (mesaj icerigi yok); baskasi 404; mesaj yoksa null", async () => {
      const row = await seedConsultation(app, { coordinatorProfileId: c1.profileId, coordinatorUserId: c1.id, startsAt: inMin(60), message: "Gizli mesaj" });
      const empty = await seedConsultation(app, { coordinatorProfileId: c1.profileId, coordinatorUserId: c1.id, startsAt: inMin(120) });
      for (let i = 0; i < 2; i++) {
        const res = await api("GET", `/coordinator/consultations/${row.consultation.id}/message`, undefined, bearer(c1));
        expect(res.statusCode).toBe(200);
        expect(res.headers["cache-control"]).toContain("no-store");
        expect(res.json().data).toEqual({ message: "Gizli mesaj" });
      }
      const audits = await app.prisma.auditLog.findMany({ where: { action: "service_consultation.message_viewed" } });
      expect(audits).toHaveLength(2);
      expect(JSON.stringify(audits)).not.toContain("Gizli mesaj");
      expect((await api("GET", `/coordinator/consultations/${empty.consultation.id}/message`, undefined, bearer(c1))).json().data).toEqual({ message: null });
      const c2 = await mkCoordinator(app, { displayName: "Bora T." });
      expect((await api("GET", `/coordinator/consultations/${row.consultation.id}/message`, undefined, bearer(c2))).statusCode).toBe(404);
    });
  });

  describe("host-token", () => {
    it("atanan koordinator: AG ile ayni yanit bicimi, ad 'Patient Coordinator · Ayşe K.', ekran paylasimi var, kayit/yonetici yetkisi yok; hostJoinedAt + audit", async () => {
      const row = await seedConsultation(app, { coordinatorProfileId: c1.profileId, coordinatorUserId: c1.id, startsAt: inMin(10) });
      const res = await api("POST", `/coordinator/consultations/${row.consultation.id}/host-token`, undefined, bearer(c1));
      expect(res.statusCode).toBe(200);
      const data = res.json().data;
      expect(Object.keys(data).sort()).toEqual(["expiresAt", "roomName", "serverUrl", "token"]);
      expect(data.roomName).toBe(row.meeting.roomName);
      const claims = await new TokenVerifier(env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET).verify(data.token);
      expect(claims.sub).toBe(`meet-host:${c1.id}`);
      expect(claims.name).toBe("Patient Coordinator · Ayşe K.");
      expect(claims.name).not.toMatch(/Dr\.|Prof/);
      const video = claims.video as Record<string, unknown>;
      expect([...(video.canPublishSources as string[])].sort()).toEqual(["camera", "microphone", "screen_share", "screen_share_audio"]);
      for (const grant of ["roomAdmin", "roomRecord", "roomCreate", "roomList", "hidden"]) expect(video[grant]).toBeUndefined();
      expect((await app.prisma.externalMeeting.findUniqueOrThrow({ where: { id: row.meeting.id } })).hostJoinedAt).not.toBeNull();
      const audit = await app.prisma.auditLog.findFirstOrThrow({ where: { action: "service_consultation.host_token.issued" } });
      expect(JSON.stringify(audit)).not.toContain(data.token);
    });

    it("pencere: baslangictan 15 dk once acilir (409 not_yet_open), iptal/bitmis 409; baska koordinator ve ADMIN 404; LiveKit yoksa 503 degil bu ortamda yapili", async () => {
      const early = await seedConsultation(app, { coordinatorProfileId: c1.profileId, coordinatorUserId: c1.id, startsAt: inMin(60) });
      const tooEarly = await api("POST", `/coordinator/consultations/${early.consultation.id}/host-token`, undefined, bearer(c1));
      expect(tooEarly.statusCode).toBe(409);
      expect(tooEarly.json().error.code).toBe("MEETING_NOT_OPEN");
      expect(tooEarly.json().error.details.reason).toEqual(["not_yet_open"]);
      const cancelled = await seedConsultation(app, { coordinatorProfileId: c1.profileId, coordinatorUserId: c1.id, startsAt: inMin(5), status: "CANCELLED" });
      expect((await api("POST", `/coordinator/consultations/${cancelled.consultation.id}/host-token`, undefined, bearer(c1))).json().error.details.reason).toEqual(["cancelled"]);
      const ended = await seedConsultation(app, { coordinatorProfileId: c1.profileId, coordinatorUserId: c1.id, startsAt: inMin(-45) });
      expect((await api("POST", `/coordinator/consultations/${ended.consultation.id}/host-token`, undefined, bearer(c1))).json().error.details.reason).toEqual(["ended"]);
      const open = await seedConsultation(app, { coordinatorProfileId: c1.profileId, coordinatorUserId: c1.id, startsAt: inMin(5) });
      const c2 = await mkCoordinator(app, { displayName: "Bora T." });
      expect((await api("POST", `/coordinator/consultations/${open.consultation.id}/host-token`, undefined, bearer(c2))).statusCode).toBe(404);
      const admin = await mkUser(app, "ADMIN");
      expect((await api("POST", `/coordinator/consultations/${open.consultation.id}/host-token`, undefined, bearer(admin))).statusCode).toBe(404);
      // ADMIN ayni zamanda koordinator profili sahibi olsa da baskasinin kaydi 404
      const adminCoord = await mkCoordinator(app, { displayName: "Ada Y.", role: "ADMIN" });
      expect((await api("POST", `/coordinator/consultations/${open.consultation.id}/host-token`, undefined, bearer(adminCoord))).statusCode).toBe(404);
      const outsider = await mkUser(app, "EDITOR");
      expect((await api("POST", `/coordinator/consultations/${open.consultation.id}/host-token`, undefined, bearer(outsider))).statusCode).toBe(403);
    });
  });

  describe("misafir katilimi (AG uclari, hizmet gorusmesi)", () => {
    it("preflight: purpose=service_consultation ve hostName 'Patient Coordinator · Ayşe K.'; genel toplantida purpose=general", async () => {
      const row = await seedConsultation(app, { coordinatorProfileId: c1.profileId, coordinatorUserId: c1.id, startsAt: inMin(5) });
      const res = await api("POST", "/meet/guest/preflight", { t: row.joinToken });
      expect(res.statusCode).toBe(200);
      expect(res.json().data).toMatchObject({ purpose: "service_consultation", hostName: "Patient Coordinator · Ayşe K.", title: "WM Health online consultation" });
      const generic = await app.prisma.externalMeeting.create({
        data: { hostUserId: c1.id, title: "Genel", startsAt: inMin(60), endsAt: inMin(90), durationMin: 30, roomName: `meet_${"b".repeat(32)}`, guestTokenHash: hashToken(`mg_${"G".repeat(43)}`) },
      });
      expect(generic.id).toBeTruthy();
      const g = await api("POST", "/meet/guest/preflight", { t: `mg_${"G".repeat(43)}` });
      expect(g.json().data.purpose).toBe("general");
    });

    it("misafir adi 'Patient Coordinator X' / 'Coordinator X' -> 422; normal ad -> bekleme; koordinator gelince hazir ve token meet-guest, ekran paylasimi yok", async () => {
      const row = await seedConsultation(app, { coordinatorProfileId: c1.profileId, coordinatorUserId: c1.id, startsAt: inMin(5) });
      for (const name of ["Patient Coordinator Ayse", "coordinator Bob", "  Coordinator"]) {
        const bad = await api("POST", "/meet/guest/join", { t: row.joinToken, name });
        expect(bad.statusCode, name).toBe(422);
      }
      const waiting = await api("POST", "/meet/guest/join", { t: row.joinToken, name: "Hans Mueller" });
      expect(waiting.statusCode).toBe(200);
      expect(waiting.json().data.status).toBe("waiting");
      lk.rooms.set(row.meeting.roomName, [`meet-host:${c1.id}`]);
      const ready = await api("POST", "/meet/guest/join", { t: row.joinToken, guestSession: waiting.json().data.guestSession });
      expect(ready.json().data.status).toBe("ready");
      const claims = await new TokenVerifier(env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET).verify(ready.json().data.token);
      expect(String(claims.sub)).toMatch(/^meet-guest:/);
      expect([...((claims.video as Record<string, unknown>).canPublishSources as string[])].sort()).toEqual(["camera", "microphone"]);
      expect(claims.name).toBe("Hans Mueller");
    });
  });

  describe("hatirlatma supurucusu", () => {
    const row = (startsAt: Date, over: Record<string, unknown> = {}) =>
      seedConsultation(app, { coordinatorProfileId: c1.profileId, coordinatorUserId: c1.id, startsAt, email: "remind@example.com", ...over });

    it("24 saat bandi: baglantisiz e-posta, bir kez; band disi ve iptal edilmis kayda gitmez", async () => {
      const inBand = await row(inMin(24 * 60));
      await row(inMin(10 * 60));
      await row(inMin(24 * 60), { status: "CANCELLED" });
      const r1 = await runServiceConsultationReminderSweep(app);
      expect(r1).toMatchObject({ reminded24h: 1, reminded60m: 0, failed: 0 });
      const mails = sent().filter((m) => m.to === "remind@example.com");
      expect(mails).toHaveLength(1);
      expect(mails[0]!.subject).toMatch(/^Reminder: your online consultation is tomorrow - SVC-\d{5}$/);
      expect(mails[0]!.html).not.toContain("/meet/join");
      expect((await app.prisma.serviceConsultation.findUniqueOrThrow({ where: { id: inBand.consultation.id } })).reminded24hAt).not.toBeNull();
      const r2 = await runServiceConsultationReminderSweep(app);
      expect(r2.reminded24h).toBe(0);
      expect(sent().filter((m) => m.to === "remind@example.com")).toHaveLength(1);
    });

    it("60 dk bandi: YENI katilim baglantisi uretilir, eskisi gecersiz olur; cift gonderim yok", async () => {
      const r = await row(inMin(60));
      const oldHash = r.meeting.guestTokenHash;
      const res = await runServiceConsultationReminderSweep(app);
      expect(res).toMatchObject({ reminded60m: 1, reminded24h: 0 });
      const mail = sent().find((m) => m.to === "remind@example.com")!;
      expect(mail.subject).toMatch(/^Your online consultation starts in about 1 hour - SVC-/);
      expect(mail.html).toContain("replaces previous links");
      const fresh = /#(mg_[A-Za-z0-9_-]{43})/.exec(mail.html)![1]!;
      const meeting = await app.prisma.externalMeeting.findUniqueOrThrow({ where: { id: r.meeting.id } });
      expect(meeting.guestTokenHash).toBe(hashToken(fresh));
      expect(meeting.guestTokenHash).not.toBe(oldHash);
      expect((await api("POST", "/meet/guest/preflight", { t: r.joinToken })).statusCode).toBe(404);
      expect((await api("POST", "/meet/guest/preflight", { t: fresh })).statusCode).toBe(200);
      expect((await runServiceConsultationReminderSweep(app)).reminded60m).toBe(0);
      expect(sent().filter((m) => m.to === "remind@example.com")).toHaveLength(1);
    });

    it("60 dk: gonderim basarisizsa ESKI baglanti gecerli kalir", async () => {
      const r = await row(inMin(60));
      mailSpy.mockImplementationOnce(() => {
        throw new Error("smtp down");
      });
      const res = await runServiceConsultationReminderSweep(app);
      expect(res.failed).toBe(1);
      const meeting = await app.prisma.externalMeeting.findUniqueOrThrow({ where: { id: r.meeting.id } });
      expect(meeting.guestTokenHash).toBe(r.meeting.guestTokenHash);
      expect((await api("POST", "/meet/guest/preflight", { t: r.joinToken })).statusCode).toBe(200);
    });
  });
});
