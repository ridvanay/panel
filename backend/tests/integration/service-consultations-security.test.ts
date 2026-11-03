import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";

/** Paket AI (Is 3) guvenlik inceleme duzeltmeleri: B1 IPv6/tavanlar, B2 altyapi kapisi, B3 e-posta hatasi + resend-links, B4 koordinator uygunlugu. */
const mailSpy = vi.hoisted(() => vi.fn());
const lk = vi.hoisted(() => {
  process.env.LIVEKIT_URL = "wss://fake-project.livekit.cloud";
  process.env.LIVEKIT_API_KEY = "fake-api-key";
  process.env.LIVEKIT_API_SECRET = "fake-api-secret-for-tests-only";
  return { configured: true };
});
vi.mock("../../src/lib/mail", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/lib/mail")>();
  return { ...actual, sendMail: (...args: unknown[]) => (mailSpy(...args), Promise.resolve({ messageId: "test" })) };
});
vi.mock("../../src/modules/telehealth/lib/livekit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/modules/telehealth/lib/livekit")>();
  return {
    ...actual,
    isLiveKitConfigured: (...args: Parameters<typeof actual.isLiveKitConfigured>) => lk.configured && actual.isLiveKitConfigured(...args),
    listRoomParticipantIdentities: vi.fn(async () => []),
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

describe("Paket AI - guvenlik inceleme duzeltmeleri", () => {
  let app: FastifyInstance;
  let specialty: { id: string; slug: string };
  let c1: Awaited<ReturnType<typeof mkCoordinator>>;

  const api = (method: "GET" | "POST" | "PATCH", url: string, payload?: unknown, headers: Record<string, string> = {}, ip = nextIp("10.81")) =>
    app.inject({ method, url: `/api/v1${url}`, ...(payload !== undefined ? { payload: payload as object } : {}), headers, remoteAddress: ip });

  async function firstSlots() {
    const res = await api("GET", `/service-consultations/slots?from=${isoDay(0)}&to=${isoDay(4)}`);
    expect(res.statusCode).toBe(200);
    return res.json().data.slots as Array<{ startsAt: string }>;
  }
  const book = async (over: Record<string, unknown> = {}, ip = nextIp("10.81"), startsAt?: string) =>
    api("POST", "/service-consultations", bookingBody(specialty.slug, startsAt ?? (await firstSlots())[0]!.startsAt, over), {}, ip);

  beforeAll(async () => {
    app = await buildTestApp();
  });
  afterAll(async () => {
    await resetDatabase(app.prisma);
    await app.close();
  });
  beforeEach(async () => {
    await resetDatabase(app.prisma);
    mailSpy.mockReset();
    lk.configured = true;
    specialty = await mkSpecialty(app);
    c1 = await mkCoordinator(app, { displayName: "Ayşe K." });
    await openDesk(app);
  });

  describe("B2 - altyapi kapisi", () => {
    it("telehealth modulu kapaliysa config.enabled=false ve slots/POST 404 SERVICE_NOT_BOOKABLE", async () => {
      await app.prisma.siteModule.update({ where: { key: "telehealth" }, data: { enabled: false } });
      expect((await api("GET", "/service-consultations/config")).json().data.enabled).toBe(false);
      const slots = await api("GET", `/service-consultations/slots?from=${isoDay(0)}&to=${isoDay(2)}`);
      expect(slots.statusCode).toBe(404);
      expect(slots.json().error.code).toBe("SERVICE_NOT_BOOKABLE");
      const res = await api("POST", "/service-consultations", bookingBody(specialty.slug, new Date(Date.now() + 5 * 3_600_000).toISOString()));
      expect(res.statusCode).toBe(404);
    });

    it("LiveKit yapilandirilmamissa kapali sayilir", async () => {
      expect((await api("GET", "/service-consultations/config")).json().data.enabled).toBe(true);
      lk.configured = false;
      expect((await api("GET", "/service-consultations/config")).json().data.enabled).toBe(false);
      expect((await api("GET", `/service-consultations/slots?from=${isoDay(0)}&to=${isoDay(2)}`)).statusCode).toBe(404);
    });
  });

  describe("B1 - oran siniri anahtari ve tavanlar", () => {
    it("IPv6: ayni /64 icindeki farkli adresler TEK kova (6. istek 429); baska /64 ayri", async () => {
      const slot = (await firstSlots())[0]!.startsAt;
      let last = 0;
      for (let i = 1; i <= 6; i++) last = (await book({ contactConsent: false }, `2001:db8:aaaa:bbbb:${i}::${i}`, slot)).statusCode;
      expect(last).toBe(429);
      expect((await book({ contactConsent: false }, "2001:db8:aaaa:cccc::1", slot)).statusCode).toBe(422);
    });

    it("gunluk IP tavani IPv6 /64 uzerinden sayilir", async () => {
      const start = new Date(Date.now() + 3 * 86_400_000);
      for (let i = 0; i < 10; i++) {
        await seedConsultation(app, { coordinatorProfileId: c1.profileId, coordinatorUserId: c1.id, startsAt: new Date(start.getTime() + i * 86_400_000), ipAddress: `2001:db8:1:2:${i + 1}::5` });
      }
      const res = await book({}, "2001:db8:1:2:ffff::9");
      expect(res.statusCode).toBe(429);
    });

    it("saatlik rezervasyon tavani asilinca adminlere saatte EN FAZLA 1 uyari; rezervasyon ENGELLENMEZ; onay e-postasi site geneli tavana takilmaz", async () => {
      const base = new Date(Date.now() + 10 * 86_400_000);
      for (let i = 0; i < 60; i++) {
        await seedConsultation(app, { coordinatorProfileId: c1.profileId, coordinatorUserId: c1.id, startsAt: new Date(base.getTime() + i * 3_600_000) });
      }
      const slots = await firstSlots();
      const email = "real.patient@example.com";
      expect((await book({ email }, nextIp("10.81"), slots[0]!.startsAt)).statusCode).toBe(201);
      expect((await book({ email: "second@example.com" }, nextIp("10.81"), slots[1]!.startsAt)).statusCode).toBe(201);
      await waitForAdminNotifications();
      expect(await app.prisma.adminNotification.count({ where: { kind: "service_consultation_cap_reached" } })).toBe(1);
      expect(sent().some((m) => m.to === email && /confirmed/.test(m.subject))).toBe(true);
      expect(sent().some((m) => m.subject === "Online consultation booking volume is high")).toBe(true);
    });
  });

  describe("B3 - e-posta hatasi ve baglanti yeniden gonderme", () => {
    const failFor = (address: string) =>
      mailSpy.mockImplementation((_app: unknown, m: SentMail) => {
        if (m?.to === address) throw new Error("smtp down");
      });

    it("onay e-postasi gonderilemezse PII'siz admin uyarisi 'SVC-xxxxx confirmation e-mail failed'", async () => {
      failFor("fail.patient@example.com");
      const res = await book({ email: "fail.patient@example.com", fullName: "Gizli Hasta" });
      expect(res.statusCode).toBe(201);
      await waitForAdminNotifications();
      const row = await app.prisma.adminNotification.findFirstOrThrow({ where: { kind: "service_consultation_email_failed" } });
      expect(JSON.stringify(row.payload)).not.toMatch(/Gizli|fail\.patient/);
      const mail = sent().find((m) => /confirmation e-mail failed/.test(m.subject))!;
      expect(mail.subject).toMatch(/^SVC-\d{5} confirmation e-mail failed$/);
      expect(`${mail.subject}${mail.html}${mail.text}`).not.toMatch(/Gizli|fail\.patient/);
    });

    it("saat degisikligi e-postasi gonderilemezse 'reschedule e-mail failed' uyarisi", async () => {
      const slots = await firstSlots();
      await book({ email: "resched.patient@example.com" }, nextIp("10.81"), slots[0]!.startsAt);
      await waitForAdminNotifications();
      const manage = /#(sc_[A-Za-z0-9_-]{43})/.exec(sent().find((m) => m.to === "resched.patient@example.com")!.html)![1]!;
      failFor("resched.patient@example.com");
      const res = await api("POST", "/service-consultations/manage/reschedule", { t: manage, startsAt: slots[4]!.startsAt, patientTimeZone: "Europe/Berlin" });
      expect(res.statusCode).toBe(200);
      await waitForAdminNotifications();
      expect(sent().some((m) => /reschedule e-mail failed/.test(m.subject))).toBe(true);
    });

    describe("POST /admin/service-desk/consultations/:id/resend-links", () => {
      const post = (id: string, who: { token: string }) => app.inject({ method: "POST", url: `/api/v1/admin/service-desk/consultations/${id}/resend-links`, headers: bearer(who), remoteAddress: nextIp("10.82") });

      it("yeni sc_ ve mg_ uretir, eskileri gecersiz kilar, kayitli adrese gonderir, audit; 202 {sent:true}", async () => {
        const manager = await mkUser(app, "MANAGER");
        const seeded = await seedConsultation(app, { coordinatorProfileId: c1.profileId, coordinatorUserId: c1.id, startsAt: new Date(Date.now() + 5 * 3_600_000), email: "resend@example.com" });
        const res = await post(seeded.consultation.id, manager);
        expect(res.statusCode).toBe(202);
        expect(res.json().data).toEqual({ sent: true });
        const mail = sent().filter((m) => m.to === "resend@example.com").pop()!;
        const join = /#(mg_[A-Za-z0-9_-]{43})/.exec(mail.html)![1]!;
        const manage = /#(sc_[A-Za-z0-9_-]{43})/.exec(mail.html)![1]!;
        const after = await app.prisma.serviceConsultation.findUniqueOrThrow({ where: { id: seeded.consultation.id }, include: { meeting: true } });
        expect(after.manageTokenHash).toBe(hashToken(manage));
        expect(after.manageTokenHash).not.toBe(seeded.consultation.manageTokenHash);
        expect(after.meeting.guestTokenHash).toBe(hashToken(join));
        expect((await api("POST", "/service-consultations/manage/lookup", { t: seeded.manageToken })).statusCode).toBe(404);
        expect((await api("POST", "/service-consultations/manage/lookup", { t: manage })).statusCode).toBe(200);
        expect(await app.prisma.auditLog.count({ where: { action: "service_desk.links_resent" } })).toBe(1);
        expect(JSON.stringify(await app.prisma.auditLog.findMany())).not.toContain(manage);
      });

      it("gonderim basarisizsa sent:false ve ESKI baglantilar gecerli kalir", async () => {
        const manager = await mkUser(app, "MANAGER");
        const seeded = await seedConsultation(app, { coordinatorProfileId: c1.profileId, coordinatorUserId: c1.id, startsAt: new Date(Date.now() + 5 * 3_600_000), email: "resend.fail@example.com" });
        failFor("resend.fail@example.com");
        const res = await post(seeded.consultation.id, manager);
        expect(res.statusCode).toBe(202);
        expect(res.json().data).toEqual({ sent: false });
        expect((await api("POST", "/service-consultations/manage/lookup", { t: seeded.manageToken })).statusCode).toBe(200);
      });

      it("EDITOR 403; iptal edilmis/bitmis 409; bilinmeyen 404; kayit basina 5/saat sinir (6. 429)", async () => {
        const editor = await mkUser(app, "EDITOR");
        const admin = await mkUser(app, "ADMIN");
        const seeded = await seedConsultation(app, { coordinatorProfileId: c1.profileId, coordinatorUserId: c1.id, startsAt: new Date(Date.now() + 5 * 3_600_000) });
        expect((await post(seeded.consultation.id, editor)).statusCode).toBe(403);
        const cancelled = await seedConsultation(app, { coordinatorProfileId: c1.profileId, coordinatorUserId: c1.id, startsAt: new Date(Date.now() + 8 * 3_600_000), status: "CANCELLED" });
        expect((await post(cancelled.consultation.id, admin)).statusCode).toBe(409);
        const ended = await seedConsultation(app, { coordinatorProfileId: c1.profileId, coordinatorUserId: c1.id, startsAt: new Date(Date.now() - 5 * 3_600_000) });
        expect((await post(ended.consultation.id, admin)).statusCode).toBe(409);
        expect((await post("00000000-0000-4000-8000-000000000000", admin)).statusCode).toBe(404);
        const codes: number[] = [];
        for (let i = 0; i < 6; i++) codes.push((await post(seeded.consultation.id, admin)).statusCode);
        // Ilk istek (EDITOR 403) de kayit basina kovadan bir hak tuketir: 5 hak = 1 (403) + 4 (202); sonrasi 429.
        expect(codes.slice(0, 4)).toEqual([202, 202, 202, 202]);
        expect(codes[4]).toBe(429);
      });
    });
  });

  describe("B4 - koordinator uygunlugu", () => {
    it("ADMIN rolu koordinator sayilmaz: atama havuzunda yok, /users/me false, coordinator uclari 404", async () => {
      await app.prisma.coordinatorProfile.update({ where: { id: c1.profileId }, data: { isActive: false } });
      const adminCoord = await mkCoordinator(app, { displayName: "Ada Y.", role: "ADMIN" });
      expect((await api("GET", "/service-consultations/config")).json().data.enabled).toBe(false);
      expect((await api("GET", "/users/me", undefined, bearer(adminCoord))).json().data.isServiceCoordinator).toBe(false);
      const row = await seedConsultation(app, { coordinatorProfileId: adminCoord.profileId, coordinatorUserId: adminCoord.id, startsAt: new Date(Date.now() + 3_600_000) });
      expect((await api("GET", `/coordinator/consultations/${row.consultation.id}`, undefined, bearer(adminCoord))).statusCode).toBe(404);
      expect((await api("GET", "/coordinator/consultations", undefined, bearer(adminCoord))).statusCode).toBe(403);
    });

    it("MANAGER koordinator olabilir; PATCH isActive:true uygunlugu yeniden dogrular (422 COORDINATOR_NOT_ELIGIBLE)", async () => {
      const manager = await mkCoordinator(app, { displayName: "Mina M.", role: "MANAGER" });
      expect((await api("GET", "/users/me", undefined, bearer(manager))).json().data.isServiceCoordinator).toBe(true);
      const admin = await mkUser(app, "ADMIN");
      const off = await app.inject({ method: "PATCH", url: `/api/v1/admin/service-desk/coordinators/${manager.profileId}`, headers: bearer(admin), payload: { isActive: false }, remoteAddress: nextIp("10.82") });
      expect(off.statusCode).toBe(200);
      await app.prisma.user.update({ where: { id: manager.id }, data: { role: "CUSTOMER" } });
      const on = await app.inject({ method: "PATCH", url: `/api/v1/admin/service-desk/coordinators/${manager.profileId}`, headers: bearer(admin), payload: { isActive: true }, remoteAddress: nextIp("10.82") });
      expect(on.statusCode).toBe(422);
      expect(on.json().error.code).toBe("COORDINATOR_NOT_ELIGIBLE");
    });
  });
});
