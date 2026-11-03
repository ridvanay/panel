import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";

/**
 * Paket AI (Is 3, hizli surum) - hizmet gorusmesi rezervasyonu: config/slots, tek islemde kayit, riza kurallari, limitler,
 * eszamanlilik, yonetim baglantisi (lookup/iptal/saat degisikligi), e-postalar ve PII'siz yonetici bildirimi.
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
import { waitForAdminNotifications } from "../../src/modules/telehealth/lib/admin-booking-notifications";
import { hashToken } from "../../src/lib/tokens";
import { bearer, bookingBody, isoDay, mkCoordinator, mkSpecialty, mkUser, nextIp, openDesk, seedConsultation } from "../helpers/service-desk";

interface SentMail {
  to: string;
  subject: string;
  html: string;
  text: string;
}
const sent = (): SentMail[] => mailSpy.mock.calls.map((c) => c[1] as SentMail);

describe("Paket AI - hizmet gorusmesi rezervasyonu", () => {
  let app: FastifyInstance;
  let specialty: { id: string; slug: string; name: string };
  let c1: Awaited<ReturnType<typeof mkCoordinator>>;

  const api = (method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE", url: string, payload?: unknown, headers: Record<string, string> = {}, ip = nextIp()) =>
    app.inject({ method, url: `/api/v1${url}`, ...(payload !== undefined ? { payload: payload as object } : {}), headers, remoteAddress: ip });

  async function slotsAvailable(daysAhead = 4) {
    const res = await api("GET", `/service-consultations/slots?from=${isoDay(0)}&to=${isoDay(daysAhead)}`);
    expect(res.statusCode).toBe(200);
    return res.json().data as { timeZone: string; durationMin: number; slots: Array<{ startsAt: string; endsAt: string }>; days: Array<{ date: string; status: string }> };
  }

  async function book(over: Record<string, unknown> = {}, startsAt?: string, ip = nextIp()) {
    const at = startsAt ?? (await slotsAvailable()).slots[0]!.startsAt;
    return api("POST", "/service-consultations", bookingBody(specialty.slug, at, over), {}, ip);
  }

  async function drain() {
    await waitForAdminNotifications();
  }

  beforeAll(async () => {
    app = await buildTestApp();
  });
  afterAll(async () => {
    await resetDatabase(app.prisma);
    await app.close();
  });
  beforeEach(async () => {
    await resetDatabase(app.prisma);
    mailSpy.mockClear();
    specialty = await mkSpecialty(app);
    c1 = await mkCoordinator(app, { displayName: "Ayşe K.", languages: ["en", "ar"] });
    await openDesk(app);
  });

  describe("config ve slots", () => {
    it("config: bayrak kapaliyken enabled=false; koordinator/saat yokken false; hepsi varsa true ve masa degerleri", async () => {
      await openDesk(app, { enabled: false });
      expect((await api("GET", "/service-consultations/config")).json().data.enabled).toBe(false);
      await openDesk(app, { enabled: true });
      const on = await api("GET", "/service-consultations/config");
      expect(on.statusCode).toBe(200);
      expect(on.headers["cache-control"]).toContain("max-age=60");
      expect(on.json().data).toEqual({ enabled: true, timeZone: "Europe/Istanbul", durationMin: 30, minNoticeMin: 120, horizonDays: 30 });
      await app.prisma.coordinatorProfile.update({ where: { id: c1.profileId }, data: { isActive: false } });
      expect((await api("GET", "/service-consultations/config")).json().data.enabled).toBe(false);
      await app.prisma.coordinatorProfile.update({ where: { id: c1.profileId }, data: { isActive: true } });
      await app.prisma.serviceDeskHours.deleteMany();
      expect((await api("GET", "/service-consultations/config")).json().data.enabled).toBe(false);
    });

    it("doktor profili olan kullanici koordinator sayilmaz (config enabled=false)", async () => {
      const doc = await mkUser(app, "EDITOR");
      const sp = await mkSpecialty(app, "Cardiology");
      await app.prisma.doctorProfile.create({
        data: { title: "Dr.", fullName: "Doktor", slug: `d-${doc.id}`, bio: "x", languages: ["tr"], timeZone: "Europe/Istanbul", specialtyId: sp.id, sessionDurationMin: 30, sessionPriceCents: 1, currency: "TRY", isActive: true, userId: doc.id },
      });
      await app.prisma.coordinatorProfile.update({ where: { id: c1.profileId }, data: { userId: doc.id } });
      expect((await api("GET", "/service-consultations/config")).json().data.enabled).toBe(false);
    });

    it("slots: kapaliyken 404 SERVICE_NOT_BOOKABLE; aralik >31 gun 422; yanit koordinator bilgisi tasimaz", async () => {
      await openDesk(app, { enabled: false });
      const closed = await api("GET", `/service-consultations/slots?from=${isoDay(0)}&to=${isoDay(2)}`);
      expect(closed.statusCode).toBe(404);
      expect(closed.json().error.code).toBe("SERVICE_NOT_BOOKABLE");
      await openDesk(app);
      const tooLong = await api("GET", `/service-consultations/slots?from=${isoDay(0)}&to=${isoDay(40)}`);
      expect(tooLong.statusCode).toBe(422);
      const data = await slotsAvailable();
      expect(data.timeZone).toBe("Europe/Istanbul");
      expect(data.durationMin).toBe(30);
      expect(data.slots.length).toBeGreaterThan(0);
      for (const s of data.slots) expect(Object.keys(s).sort()).toEqual(["endsAt", "startsAt"]);
      const raw = JSON.stringify(data);
      expect(raw).not.toContain(c1.id);
      expect(raw).not.toContain(c1.profileId);
      expect(raw).not.toContain("Ayşe");
      // en erken kural: ilk slot en az 2 saat sonra
      expect(Date.parse(data.slots[0]!.startsAt)).toBeGreaterThanOrEqual(Date.now() + 120 * 60_000);
      expect(data.days.some((d) => d.status === "available")).toBe(true);
    });

    it("slots: tatil gunu slot uretmez ve gun 'closed' gorunur", async () => {
      const before = await slotsAvailable(6);
      const day = before.days.find((d) => d.status === "available")!.date;
      await app.prisma.serviceDeskClosure.create({ data: { deskId: "main", date: new Date(`${day}T00:00:00Z`) } });
      const after = await slotsAvailable(6);
      expect(after.days.find((d) => d.date === day)!.status).toBe("closed");
      expect(after.slots.every((s) => new Date(s.startsAt).toLocaleDateString("en-CA", { timeZone: "Europe/Istanbul" }) !== day)).toBe(true);
    });

    it("slots: koordinatorun kendi gorusmesi VE ev sahibi oldugu AG toplantisi slotu kapatir; ikinci koordinator acar", async () => {
      const first = (await slotsAvailable()).slots[0]!;
      const startsAt = new Date(first.startsAt);
      // AG genel toplantisi (hizmet gorusmesi degil)
      await app.prisma.externalMeeting.create({
        data: { hostUserId: c1.id, title: "x", startsAt, endsAt: new Date(startsAt.getTime() + 30 * 60_000), durationMin: 30, roomName: `meet_${"a".repeat(32)}`, maxParticipants: 4 },
      });
      expect((await slotsAvailable()).slots.some((s) => s.startsAt === first.startsAt)).toBe(false);
      const c2 = await mkCoordinator(app, { displayName: "Bora T." });
      expect((await slotsAvailable()).slots.some((s) => s.startsAt === first.startsAt)).toBe(true);
      await app.prisma.coordinatorProfile.update({ where: { id: c2.profileId }, data: { isActive: false } });
      expect((await slotsAvailable()).slots.some((s) => s.startsAt === first.startsAt)).toBe(false);
    });
  });

  describe("rezervasyon", () => {
    it("201: yanitta belirtec/baglanti yok; lead + talep + meet_ odasi + gorusme TEK islemde; DB'de duz belirtec yok", async () => {
      const slot = (await slotsAvailable()).slots[0]!;
      const res = await book({ message: null }, slot.startsAt);
      expect(res.statusCode).toBe(201);
      const data = res.json().data;
      expect(data.consultationNumber).toMatch(/^SVC-\d{5}$/);
      expect(data.startsAt).toBe(slot.startsAt);
      expect(data.endsAt).toBe(slot.endsAt);
      expect(data.durationMin).toBe(30);
      expect(Date.parse(data.joinOpensAt)).toBe(Date.parse(slot.startsAt) - 15 * 60_000);
      expect(JSON.stringify(res.json())).not.toMatch(/mg_|sc_|#|token/i);

      const c = await app.prisma.serviceConsultation.findFirstOrThrow({ include: { meeting: true, request: true } });
      expect(c.status).toBe("SCHEDULED");
      expect(c.coordinatorId).toBe(c1.profileId);
      expect(c.consentVersion).toBe("service-consultation-v1");
      expect(c.patientUserId).toBeNull();
      expect(c.meeting.roomName).toMatch(/^meet_[0-9a-f]{32}$/);
      expect(c.meeting.autoAdmitGuests).toBe(false);
      expect(c.meeting.title).toBe("WM Health online consultation");
      expect(c.meeting.note).toBeNull();
      expect(c.meeting.maxParticipants).toBe(3);
      expect(c.meeting.hostUserId).toBe(c1.id);
      expect(c.request?.contactConsentAt).toBeTruthy();
      expect(await app.prisma.crmLead.count({ where: { channel: "CONSULTATION_REQUEST" } })).toBe(1);
      expect(await app.prisma.consultationRequest.count()).toBe(1);
      expect((await app.prisma.coordinatorProfile.findUniqueOrThrow({ where: { id: c1.profileId } })).lastAssignedAt).not.toBeNull();

      // Duz belirtec DB'de yok: yalniz ozet
      await drain();
      const mail = sent().find((m) => m.to.startsWith("max-"))!;
      expect(mail).toBeTruthy();
      const join = /#(mg_[A-Za-z0-9_-]{43})/.exec(mail.html)?.[1];
      const manage = /#(sc_[A-Za-z0-9_-]{43})/.exec(mail.html)?.[1];
      expect(join).toBeTruthy();
      expect(manage).toBeTruthy();
      expect(c.meeting.guestTokenHash).toBe(hashToken(join!));
      expect(c.manageTokenHash).toBe(hashToken(manage!));
      const dump = JSON.stringify([c, await app.prisma.auditLog.findMany(), await app.prisma.adminNotification.findMany()]);
      expect(dump).not.toContain(join!);
      expect(dump).not.toContain(manage!);
    });

    it("kimlik alani istenmez (tcNo/pasaport gonderilmeden 201)", async () => {
      const res = await book();
      expect(res.statusCode).toBe(201);
    });

    it("e-posta: konu satirinda ve govdede hizmet adi yok; katilim ve yonetim baglantisi var; tr -> en", async () => {
      const res = await book({ locale: "tr", email: "tr-user@example.com" });
      expect(res.statusCode).toBe(201);
      await drain();
      const mail = sent().find((m) => m.to === "tr-user@example.com")!;
      expect(mail.subject).toMatch(/^Your online consultation is confirmed - SVC-\d{5}$/);
      expect(mail.subject).not.toContain(specialty.name);
      expect(mail.html).not.toContain(specialty.name);
      expect(mail.html).toContain("/en/meet/join#mg_");
      expect(mail.html).toContain("/en/book-consultation/manage#sc_");
      expect(mail.html).toContain("not a medical examination");
      expect(mail.html).toContain("International Health Tourism Intermediary");
    });

    it("8 dilde onay e-postasi (almanca ornek) ve hizmet adi yok", async () => {
      await book({ locale: "de", email: "de-user@example.com", contactLanguage: "de" });
      await drain();
      const mail = sent().find((m) => m.to === "de-user@example.com")!;
      expect(mail.subject).toMatch(/^Ihre Online-Beratung ist bestätigt - SVC-\d{5}$/);
      expect(mail.html).not.toContain(specialty.name);
    });

    it("riza kurallari AH ile ayni: iletisim rizasi zorunlu; mesaj varsa saglik rizasi zorunlu; gecersiz saat dilimi 422", async () => {
      expect((await book({ contactConsent: false })).statusCode).toBe(422);
      expect((await book({ message: "Merhaba", healthDataConsent: false })).statusCode).toBe(422);
      expect((await book({ patientTimeZone: "Mars/Olympus" })).statusCode).toBe(422);
      const okMsg = await book({ message: "Hello", healthDataConsent: true });
      expect(okMsg.statusCode).toBe(201);
      const req = await app.prisma.consultationRequest.findFirstOrThrow();
      expect(req.messageEncrypted).toBeTruthy();
      expect(req.messageEncrypted).not.toContain("Hello");
      expect(req.healthDataConsentAt).not.toBeNull();
    });

    it("hizmet zorunlu; bilinmeyen/pasif hizmet 404; 'specialtySlug' takma adi kabul edilir", async () => {
      const slot = (await slotsAvailable()).slots[0]!;
      const noService = await api("POST", "/service-consultations", { ...bookingBody(specialty.slug, slot.startsAt), serviceSlug: null }, {}, nextIp());
      expect(noService.statusCode).toBe(422);
      const unknown = await api("POST", "/service-consultations", bookingBody("does-not-exist", slot.startsAt), {}, nextIp());
      expect(unknown.statusCode).toBe(404);
      expect(unknown.json().error.code).toBe("SERVICE_NOT_BOOKABLE");
      await app.prisma.specialty.update({ where: { id: specialty.id }, data: { isActive: false } });
      expect((await book({}, slot.startsAt)).statusCode).toBe(404);
      await app.prisma.specialty.update({ where: { id: specialty.id }, data: { isActive: true } });
      const { serviceSlug, ...rest } = bookingBody(specialty.slug, slot.startsAt);
      const alias = await api("POST", "/service-consultations", { ...rest, specialtySlug: serviceSlug }, {}, nextIp());
      expect(alias.statusCode).toBe(201);
    });

    it("kapali bayrakta 404; gecmis/uygunsuz saat 409 SLOT_TAKEN", async () => {
      const slot = (await slotsAvailable()).slots[0]!;
      const past = await book({}, new Date(Date.now() - 3_600_000).toISOString());
      expect(past.statusCode).toBe(409);
      expect(past.json().error.code).toBe("SLOT_TAKEN");
      const offGrid = await book({}, new Date(Date.parse(slot.startsAt) + 7 * 60_000).toISOString());
      expect(offGrid.statusCode).toBe(409);
      await openDesk(app, { enabled: false });
      const closed = await book({}, slot.startsAt);
      expect(closed.statusCode).toBe(404);
      expect(closed.json().error.code).toBe("SERVICE_NOT_BOOKABLE");
    });

    it("honeypot: basari gibi gorunur, hicbir sey yazilmaz, e-posta gitmez", async () => {
      const res = await book({ website: "http://spam.example", email: "bot@example.com" });
      expect(res.statusCode).toBe(201);
      expect(res.json().data.consultationNumber).toMatch(/^SVC-\d{5}$/);
      expect(await app.prisma.serviceConsultation.count()).toBe(0);
      expect(await app.prisma.consultationRequest.count()).toBe(0);
      await drain();
      expect(sent().some((m) => m.to === "bot@example.com")).toBe(false);
    });

    it("ayni e-postaya en cok 2 gelecek gorusme: 3. istek 409 SERVICE_CONSULTATION_LIMIT", async () => {
      const slots = (await slotsAvailable()).slots;
      const email = "limit@example.com";
      expect((await book({ email }, slots[0]!.startsAt)).statusCode).toBe(201);
      expect((await book({ email }, slots[1]!.startsAt)).statusCode).toBe(201);
      const third = await book({ email }, slots[2]!.startsAt);
      expect(third.statusCode).toBe(409);
      expect(third.json().error.code).toBe("SERVICE_CONSULTATION_LIMIT");
      // iptal edilince yer acilir degil: yalniz SCHEDULED sayilir
      await app.prisma.serviceConsultation.updateMany({ where: { request: { email } }, data: { status: "CANCELLED" } });
      expect((await book({ email }, slots[2]!.startsAt)).statusCode).toBe(201);
    });

    it("IP basina gunluk 10 rezervasyon sinirini asinca 429", async () => {
      const ip = "10.99.1.1";
      const start = new Date(Date.now() + 3 * 86_400_000);
      for (let i = 0; i < 10; i++) {
        await seedConsultation(app, { coordinatorProfileId: c1.profileId, coordinatorUserId: c1.id, startsAt: new Date(start.getTime() + i * 3_600_000 * 24), ipAddress: ip });
      }
      const res = await book({}, undefined, ip);
      expect(res.statusCode).toBe(429);
      expect(res.json().error.code).toBe("RATE_LIMITED");
    });

    it("dakikada 5 istek sinirinin ustu 429", async () => {
      const ip = "10.99.2.2";
      const slot = (await slotsAvailable()).slots[0]!;
      let last = 0;
      for (let i = 0; i < 6; i++) last = (await book({ contactConsent: false }, slot.startsAt, ip)).statusCode;
      expect(last).toBe(429);
    });

    it("doktor profilli oturum 403; oturumsuz misafir hesap ACMAZ", async () => {
      const doc = await mkUser(app, "USER");
      const sp = await mkSpecialty(app, "Cardiology");
      await app.prisma.doctorProfile.create({
        data: { title: "Dr.", fullName: "Doktor", slug: `d-${doc.id}`, bio: "x", languages: ["tr"], timeZone: "Europe/Istanbul", specialtyId: sp.id, sessionDurationMin: 30, sessionPriceCents: 1, currency: "TRY", isActive: true, userId: doc.id },
      });
      const slot = (await slotsAvailable()).slots[0]!;
      const forbidden = await api("POST", "/service-consultations", bookingBody(specialty.slug, slot.startsAt), bearer(doc), nextIp());
      expect(forbidden.statusCode).toBe(403);
      const usersBefore = await app.prisma.user.count();
      expect((await book({}, slot.startsAt)).statusCode).toBe(201);
      expect(await app.prisma.user.count()).toBe(usersBefore);
    });

    it("hesapli hasta (doktor degil) rezervasyon yapabilir; patientUserId bu surumde YAZILMAZ", async () => {
      const patient = await mkUser(app, "CUSTOMER");
      const slot = (await slotsAvailable()).slots[0]!;
      const res = await api("POST", "/service-consultations", bookingBody(specialty.slug, slot.startsAt), bearer(patient), nextIp());
      expect(res.statusCode).toBe(201);
      expect((await app.prisma.serviceConsultation.findFirstOrThrow()).patientUserId).toBeNull();
    });
  });

  describe("eszamanlilik ve otomatik atama", () => {
    it("tek koordinator: ayni slota iki paralel istek -> biri 201, digeri 409 SLOT_TAKEN", async () => {
      const slot = (await slotsAvailable()).slots[0]!;
      const [a, b] = await Promise.all([book({ email: "a1@example.com" }, slot.startsAt), book({ email: "b1@example.com" }, slot.startsAt)]);
      expect([a.statusCode, b.statusCode].sort()).toEqual([201, 409]);
      const failed = a.statusCode === 409 ? a : b;
      expect(failed.json().error.code).toBe("SLOT_TAKEN");
      expect(await app.prisma.serviceConsultation.count()).toBe(1);
      expect(await app.prisma.consultationRequest.count()).toBe(1);
      expect(await app.prisma.externalMeeting.count()).toBe(1);
    });

    it("iki koordinator: ayni slota iki paralel istek -> ikisi 201 ve FARKLI koordinatorler", async () => {
      await mkCoordinator(app, { displayName: "Bora T." });
      const slot = (await slotsAvailable()).slots[0]!;
      const [a, b] = await Promise.all([book({ email: "a2@example.com" }, slot.startsAt), book({ email: "b2@example.com" }, slot.startsAt)]);
      expect([a.statusCode, b.statusCode]).toEqual([201, 201]);
      const rows = await app.prisma.serviceConsultation.findMany();
      expect(rows).toHaveLength(2);
      expect(new Set(rows.map((r) => r.coordinatorId)).size).toBe(2);
      // uclu istek: yer kalmadi
      const third = await book({ email: "c2@example.com" }, slot.startsAt);
      expect(third.statusCode).toBe(409);
    });

    it("atama: dil uyumu once gelir (ar konusan koordinator)", async () => {
      const arabic = await mkCoordinator(app, { displayName: "Dalia M.", languages: ["ar"] });
      await app.prisma.coordinatorProfile.update({ where: { id: c1.profileId }, data: { languages: ["en"] } });
      const slot = (await slotsAvailable()).slots[0]!;
      const res = await book({ contactLanguage: "ar", locale: "ar" }, slot.startsAt);
      expect(res.statusCode).toBe(201);
      expect((await app.prisma.serviceConsultation.findFirstOrThrow()).coordinatorId).toBe(arabic.profileId);
    });

    it("atama: dil esitse o gun en az gorusmesi olan; sonra en eski lastAssignedAt", async () => {
      const c2 = await mkCoordinator(app, { displayName: "Bora T.", languages: ["en"] });
      const slots = (await slotsAvailable()).slots;
      // c1'in o gun 1 gorusmesi var -> c2 secilmeli
      await seedConsultation(app, { coordinatorProfileId: c1.profileId, coordinatorUserId: c1.id, startsAt: new Date(slots[0]!.startsAt) });
      const res = await book({}, slots[1]!.startsAt);
      expect(res.statusCode).toBe(201);
      const created = await app.prisma.serviceConsultation.findFirstOrThrow({ where: { startsAt: new Date(slots[1]!.startsAt) } });
      expect(created.coordinatorId).toBe(c2.profileId);
    });
  });

  describe("yonetim baglantisi", () => {
    async function bookedWithTokens(email = "manage@example.com", startsAt?: string) {
      const slot = startsAt ?? (await slotsAvailable()).slots[0]!.startsAt;
      const res = await book({ email }, slot);
      expect(res.statusCode).toBe(201);
      await drain();
      const mail = sent().filter((m) => m.to === email).pop()!;
      return {
        join: /#(mg_[A-Za-z0-9_-]{43})/.exec(mail.html)![1]!,
        manage: /#(sc_[A-Za-z0-9_-]{43})/.exec(mail.html)![1]!,
        slot,
      };
    }
    const preflight = (t: string) => api("POST", "/meet/guest/preflight", { t });

    beforeEach(async () => {
      await app.prisma.siteModule.upsert({ where: { key: "telehealth" }, create: { key: "telehealth", enabled: true }, update: { enabled: true } });
    });

    it("lookup: gecerli belirtec ozet doner; gecersiz/bozuk/bilinmeyen TEK tip 404", async () => {
      const { manage } = await bookedWithTokens();
      const res = await api("POST", "/service-consultations/manage/lookup", { t: manage });
      expect(res.statusCode).toBe(200);
      expect(res.headers["cache-control"]).toBe("no-store");
      const d = res.json().data;
      expect(d).toMatchObject({ status: "SCHEDULED", durationMin: 30, serviceName: specialty.name, canCancel: true, canReschedule: true });
      expect(d.consultationNumber).toMatch(/^SVC-\d{5}$/);
      const unknown = await api("POST", "/service-consultations/manage/lookup", { t: `sc_${"A".repeat(43)}` });
      const bad = await api("POST", "/service-consultations/manage/lookup", { t: "nonsense" });
      expect(unknown.statusCode).toBe(404);
      expect(bad.statusCode).toBe(404);
      expect(unknown.json()).toEqual(bad.json());
    });

    it("lookup: baslangica 2 saatten az kaldiysa canCancel/canReschedule=false; iptal ve degisiklik 409", async () => {
      const seeded = await seedConsultation(app, { coordinatorProfileId: c1.profileId, coordinatorUserId: c1.id, startsAt: new Date(Date.now() + 60 * 60_000) });
      const look = await api("POST", "/service-consultations/manage/lookup", { t: seeded.manageToken });
      expect(look.json().data).toMatchObject({ canCancel: false, canReschedule: false });
      const cancel = await api("POST", "/service-consultations/manage/cancel", { t: seeded.manageToken });
      expect(cancel.statusCode).toBe(409);
      expect(cancel.json().error.code).toBe("CONSULTATION_NOT_CHANGEABLE");
    });

    it("iptal: gorusme + ExternalMeeting iptal, belirtec null, eski katilim baglantisi gecersiz, slot yeniden acilir, e-posta + bildirim; tekrar iptal idempotent", async () => {
      const { manage, join, slot } = await bookedWithTokens();
      expect((await preflight(join)).statusCode).toBe(200);
      mailSpy.mockClear();
      const res = await api("POST", "/service-consultations/manage/cancel", { t: manage });
      expect(res.statusCode).toBe(200);
      expect(res.json().data).toEqual({ status: "CANCELLED" });
      const c = await app.prisma.serviceConsultation.findFirstOrThrow({ include: { meeting: true } });
      expect(c.status).toBe("CANCELLED");
      expect(c.cancelledBy).toBe("patient");
      expect(c.meeting.status).toBe("CANCELLED");
      expect(c.meeting.guestTokenHash).toBeNull();
      const pre = await preflight(join);
      expect(pre.statusCode).toBe(404);
      expect(pre.json().error.code).toBe("MEETING_LINK_INVALID");
      expect((await slotsAvailable()).slots.some((s) => s.startsAt === slot)).toBe(true);
      await drain();
      expect(sent().some((m) => m.to === "manage@example.com" && /has been cancelled/.test(m.subject))).toBe(true);
      expect(await app.prisma.adminNotification.count({ where: { kind: "service_consultation_cancelled" } })).toBe(1);
      const again = await api("POST", "/service-consultations/manage/cancel", { t: manage });
      expect(again.statusCode).toBe(200);
      await drain();
      expect(await app.prisma.adminNotification.count({ where: { kind: "service_consultation_cancelled" } })).toBe(1);
      const look = await api("POST", "/service-consultations/manage/lookup", { t: manage });
      expect(look.json().data).toMatchObject({ status: "CANCELLED", canCancel: false, canReschedule: false });
    });

    it("saat degisikligi: ayni ExternalMeeting guncellenir, ESKI katilim baglantisi gecersiz, YENI baglanti e-postada, damgalar sifirlanir, sayac artar", async () => {
      const { manage, join } = await bookedWithTokens();
      const slots = (await slotsAvailable()).slots;
      const target = slots[3]!;
      const before = await app.prisma.serviceConsultation.findFirstOrThrow({ include: { meeting: true } });
      await app.prisma.serviceConsultation.update({ where: { id: before.id }, data: { reminded24hAt: new Date(), reminded60mAt: new Date() } });
      mailSpy.mockClear();
      const res = await api("POST", "/service-consultations/manage/reschedule", { t: manage, startsAt: target.startsAt, patientTimeZone: "America/New_York" });
      expect(res.statusCode).toBe(200);
      expect(res.json().data).toMatchObject({ startsAt: target.startsAt, endsAt: target.endsAt, status: "SCHEDULED" });
      const after = await app.prisma.serviceConsultation.findFirstOrThrow({ include: { meeting: true } });
      expect(after.id).toBe(before.id);
      expect(after.meetingId).toBe(before.meetingId);
      expect(after.startsAt.toISOString()).toBe(target.startsAt);
      expect(after.meeting.startsAt.toISOString()).toBe(target.startsAt);
      expect(after.rescheduledCount).toBe(1);
      expect(after.reminded24hAt).toBeNull();
      expect(after.reminded60mAt).toBeNull();
      expect(after.patientTimeZone).toBe("America/New_York");
      expect((await preflight(join)).statusCode).toBe(404);
      await drain();
      const mail = sent().find((m) => m.to === "manage@example.com")!;
      expect(mail.subject).toMatch(/new time/);
      const fresh = /#(mg_[A-Za-z0-9_-]{43})/.exec(mail.html)![1]!;
      expect(fresh).not.toBe(join);
      expect((await preflight(fresh)).statusCode).toBe(200);
      expect(mail.html).toContain(manage);
      expect(await app.prisma.adminNotification.count({ where: { kind: "service_consultation_rescheduled" } })).toBe(1);
    });

    it("saat degisikligi: ayni saat 409, dolu slot 409 SLOT_TAKEN, en cok 3 degisiklik", async () => {
      const { manage, slot } = await bookedWithTokens();
      const slots = (await slotsAvailable()).slots;
      const same = await api("POST", "/service-consultations/manage/reschedule", { t: manage, startsAt: slot, patientTimeZone: "Europe/Berlin" });
      expect(same.statusCode).toBe(409);
      // baska hasta slots[2]'yi alir
      expect((await book({ email: "other@example.com" }, slots[2]!.startsAt)).statusCode).toBe(201);
      const taken = await api("POST", "/service-consultations/manage/reschedule", { t: manage, startsAt: slots[2]!.startsAt, patientTimeZone: "Europe/Berlin" });
      expect(taken.statusCode).toBe(409);
      expect(taken.json().error.code).toBe("SLOT_TAKEN");
      for (const i of [3, 4, 5]) {
        const r = await api("POST", "/service-consultations/manage/reschedule", { t: manage, startsAt: slots[i]!.startsAt, patientTimeZone: "Europe/Berlin" });
        expect(r.statusCode).toBe(200);
      }
      const fourth = await api("POST", "/service-consultations/manage/reschedule", { t: manage, startsAt: slots[6]!.startsAt, patientTimeZone: "Europe/Berlin" });
      expect(fourth.statusCode).toBe(409);
      expect(fourth.json().error.code).toBe("CONSULTATION_NOT_CHANGEABLE");
    });

    it("saat degisikligi: iptal edilmis gorusmede 409", async () => {
      const { manage } = await bookedWithTokens();
      await api("POST", "/service-consultations/manage/cancel", { t: manage });
      const slots = (await slotsAvailable()).slots;
      const res = await api("POST", "/service-consultations/manage/reschedule", { t: manage, startsAt: slots[4]!.startsAt, patientTimeZone: "Europe/Berlin" });
      expect(res.statusCode).toBe(409);
    });
  });

  describe("bildirimler", () => {
    it("yonetici bildirimi ve koordinator e-postasi KISISEL VERI ICERMEZ (ad, e-posta, telefon, mesaj)", async () => {
      const email = "very.secret.patient@example.com";
      const res = await book({ email, fullName: "Zeynep Gizli", phone: "+49 170 9998877", message: "Gizli saglik sikayeti metni", healthDataConsent: true });
      expect(res.statusCode).toBe(201);
      await drain();
      const staff = sent().filter((m) => m.to !== email);
      expect(staff.length).toBeGreaterThanOrEqual(2); // yonetici alicisi + koordinator
      for (const m of staff) {
        const blob = `${m.subject}\n${m.html}\n${m.text}`;
        for (const secret of ["Zeynep", "Gizli", email, "9998877", "saglik sikayeti", "very.secret"]) expect(blob).not.toContain(secret);
      }
      const adminMail = staff.find((m) => m.to === "admin@wmhealthistanbul.com")!;
      expect(adminMail.subject).toMatch(/^New online consultation SVC-\d{5} - \d{4}-\d{2}-\d{2} \d{2}:\d{2} \(Europe\/Istanbul\)$/);
      expect(adminMail.html).toContain("/admin/service-desk/consultations/");
      const coordMail = staff.find((m) => m.to === c1.email)!;
      expect(coordMail.subject).toMatch(/^New online consultation assigned to you SVC-/);
      expect(coordMail.html).toContain("/admin/my-consultations");
      const rows = await app.prisma.adminNotification.findMany({ where: { kind: "service_consultation_booked" } });
      expect(rows).toHaveLength(1);
      expect(JSON.stringify(rows[0]!.payload)).not.toMatch(/Zeynep|very.secret|9998877/);
    });

    it("e-posta gonderim hatasi rezervasyonu bozmaz", async () => {
      mailSpy.mockImplementation(() => {
        throw new Error("smtp down");
      });
      try {
        const res = await book({ email: "fail@example.com" });
        expect(res.statusCode).toBe(201);
        await drain();
        expect(await app.prisma.serviceConsultation.count()).toBe(1);
      } finally {
        mailSpy.mockReset();
      }
    });
  });
});
