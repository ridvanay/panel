import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { resetDatabase } from "../helpers/reset-db";

/**
 * Paket AA — görüşmeye tercüman katılımı: yetki (yalnızca atanmış booking, pencere, 2FA, taahhüt,
 * kaldırma), token grant'ları, atama kuralları (tek aktif, dil/çakışma filtresi, audit), e-posta
 * içeriği (hasta adı/şikayet/belge yok), doktorun çıkarması, hasta talebi ve diğer uçlara 403.
 * LiveKit sahte config ile (imzalama yerel; `LIVEKIT_INTERNAL_URL` boş → odadan çıkarma atlanır).
 */
const FAKE_SECRET = "fake-api-secret-for-tests-only";

type Claims = {
  sub: string;
  name?: string;
  metadata?: string;
  exp: number;
  video: { roomJoin?: boolean; room?: string; canSubscribe?: boolean; canPublish?: boolean; canPublishData?: boolean; hidden?: boolean; canPublishSources?: string[]; canUpdateOwnMetadata?: boolean };
};

let ipCounter = 0;
const nextIp = () => `10.30.${Math.floor(++ipCounter / 250)}.${(ipCounter % 250) + 1}`;
const auth = (token: string) => ({ authorization: `Bearer ${token}` });

const mailSpy = vi.fn();
vi.mock("../../src/lib/mail", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/lib/mail")>();
  return { ...actual, sendMail: (...args: unknown[]) => (mailSpy(...args), Promise.resolve({ messageId: "test" })) };
});

describe("telehealth — tercüman katılımı (Paket AA)", () => {
  let app: FastifyInstance;
  let admin: { id: string; token: string };
  let manager: { id: string; token: string };

  async function user(role: "ADMIN" | "MANAGER" | "USER" | "INTERPRETER", opts: { twoFactor?: boolean } = {}) {
    const { hashPassword } = await import("../../src/lib/password");
    const { signAccessToken } = await import("../../src/lib/jwt");
    const u = await app.prisma.user.create({
      data: {
        email: `aa-${role.toLowerCase()}-${crypto.randomUUID()}@example.com`,
        name: `Test ${role}`,
        passwordHash: await hashPassword("Sifre12345!"),
        role,
        status: "ACTIVE",
        emailVerifiedAt: new Date(),
        twoFactorEnabled: opts.twoFactor ?? false,
      },
    });
    return { id: u.id, email: u.email, token: signAccessToken({ sub: u.id, email: u.email }).token };
  }

  async function confidentialityVersion() {
    const { parseConfidentialityText } = await import("../../src/modules/telehealth/lib/interpreters");
    const row = await app.prisma.siteModule.findUnique({ where: { key: "telehealth" } });
    return parseConfidentialityText(row?.settings).version;
  }

  async function interpreter(opts: { languages?: string[]; twoFactor?: boolean; accepted?: boolean; active?: boolean } = {}) {
    const u = await user("INTERPRETER", { twoFactor: opts.twoFactor ?? true });
    const accepted = opts.accepted ?? true;
    const profile = await app.prisma.interpreterProfile.create({
      data: {
        userId: u.id,
        displayName: "A. Yılmaz",
        languages: opts.languages ?? ["ar", "tr"],
        isActive: opts.active ?? true,
        confidentialityAcceptedAt: accepted ? new Date() : null,
        confidentialityVersion: accepted ? await confidentialityVersion() : null,
      },
    });
    return { ...u, profileId: profile.id };
  }

  async function setRequire2fa(value: boolean) {
    const res = await app.inject({ method: "PUT", url: "/api/v1/admin/telehealth/interpreters/settings", headers: auth(admin.token), payload: { require2fa: value } });
    expect(res.statusCode).toBe(200);
  }

  async function booking(
    opts: { status?: "SCHEDULED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED"; paid?: boolean; startsInMin?: number; doctorUserId?: string | null; patientUserId?: string | null; patientEmail?: string } = {}
  ) {
    const { generateOpaqueToken, hashToken } = await import("../../src/lib/tokens");
    const specialty = await app.prisma.specialty.create({ data: { name: `S ${crypto.randomUUID()}`, slug: `s-${crypto.randomUUID()}`, icon: "Heart" } });
    const doctor = await app.prisma.doctorProfile.create({
      data: {
        title: "Prof. Dr.",
        fullName: "Hakan SOFU",
        bio: "Test doktoru.",
        slug: `d-${crypto.randomUUID()}`,
        languages: ["tr"],
        timeZone: "Europe/Istanbul",
        specialtyId: specialty.id,
        sessionDurationMin: 30,
        sessionPriceCents: 50000,
        currency: "EUR",
        isActive: true,
        userId: opts.doctorUserId ?? null,
      },
    });
    const raw = generateOpaqueToken();
    const startsAt = new Date(Date.now() + (opts.startsInMin ?? 60) * 60_000);
    const roomName = `room_${crypto.randomBytes(12).toString("hex")}`;
    const b = await app.prisma.appointmentBooking.create({
      data: {
        bookingNumber: `B-${crypto.randomUUID().slice(0, 8)}`,
        doctorId: doctor.id,
        patientName: "Zeynep Kaya",
        patientEmail: opts.patientEmail ?? `hasta-${crypto.randomUUID()}@example.com`,
        slotCount: 1,
        unitPriceCents: 50000,
        subtotalCents: 50000,
        totalCents: 50000,
        currency: "EUR",
        paymentStatus: opts.paid === false ? "PENDING" : "PAID",
        expiresAt: new Date(Date.now() + 3600_000),
        meetingRoomName: roomName,
        accessTokenHash: hashToken(raw),
        patientUserId: opts.patientUserId ?? null,
        consentAt: new Date(),
        consentVersion: "v1",
      },
    });
    const appointment = await app.prisma.appointment.create({
      data: {
        doctorId: doctor.id,
        bookingId: b.id,
        patientName: "Zeynep Kaya",
        patientEmail: b.patientEmail,
        startsAt,
        endsAt: new Date(startsAt.getTime() + 30 * 60_000),
        priceCents: 50000,
        currency: "EUR",
        meetingRoomName: `${roomName}-a`,
        accessTokenHash: hashToken(generateOpaqueToken()),
        status: opts.status ?? "SCHEDULED",
      },
    });
    return { booking: b, appointment, doctor, raw };
  }

  async function assign(bookingId: string, interpreterId: string, language = "ar", token = admin.token) {
    return app.inject({ method: "POST", url: `/api/v1/admin/telehealth/bookings/${bookingId}/interpreter`, headers: auth(token), payload: { interpreterId, language }, remoteAddress: nextIp() });
  }

  async function assignmentFor(bookingId: string) {
    return app.prisma.appointmentInterpreter.findFirstOrThrow({ where: { bookingId }, orderBy: { assignedAt: "desc" } });
  }

  function requestToken(assignmentId: string, token: string) {
    return app.inject({ method: "POST", url: `/api/v1/interpreter/assignments/${assignmentId}/meeting-token`, headers: auth(token), remoteAddress: nextIp() });
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
    await app.prisma.siteModule.upsert({ where: { key: "telehealth" }, create: { key: "telehealth", enabled: true }, update: { enabled: true } });
    admin = await user("ADMIN", { twoFactor: true });
    manager = await user("MANAGER", { twoFactor: true });
  });

  beforeEach(() => mailSpy.mockClear());

  afterAll(async () => {
    await resetDatabase(app.prisma);
    await app.close();
    delete process.env.LIVEKIT_URL;
    delete process.env.LIVEKIT_API_KEY;
    delete process.env.LIVEKIT_API_SECRET;
    vi.resetModules();
  });

  describe("token grant'ları ve yetki", () => {
    it("atanmış tercüman: yayın+abonelik açık, ekran paylaşımı kapalı, hidden yok, metadata rolü ve görünen ad doğru; görüşmeyi başlatmaz", async () => {
      const interp = await interpreter();
      const { booking: b, appointment } = await booking();
      expect((await assign(b.id, interp.profileId)).statusCode).toBe(200);
      const a = await assignmentFor(b.id);

      const res = await requestToken(a.id, interp.token);
      expect(res.statusCode).toBe(200);
      const claims = jwt.verify(res.json().data.token, FAKE_SECRET) as Claims;
      expect(claims.sub).toBe(`interpreter:${interp.profileId}:${b.id}`);
      expect(claims.name).toBe("A. Yılmaz · Interpreter (العربية)");
      expect(JSON.parse(claims.metadata ?? "{}")).toEqual({ role: "interpreter", language: "ar" });
      expect(claims.video).toMatchObject({ roomJoin: true, room: b.meetingRoomName, canPublish: true, canSubscribe: true, canPublishData: true, canUpdateOwnMetadata: false });
      expect(claims.video.canPublishSources).toEqual(["camera", "microphone"]);
      expect(claims.video.hidden).toBeUndefined();
      expect(JSON.stringify(res.json())).not.toContain(FAKE_SECRET);

      expect((await app.prisma.appointment.findUniqueOrThrow({ where: { id: appointment.id } })).status).toBe("SCHEDULED");
      expect((await assignmentFor(b.id)).status).toBe("JOINED");
      const joined = await app.prisma.auditLog.findFirstOrThrow({ where: { action: "interpreter.joined", targetId: b.id } });
      expect(JSON.stringify(joined.metadata)).not.toMatch(/token|wss:|https?:/i);
    });

    it("başka booking'in ataması 404; atama kaldırılınca, pencere dışında, 2FA ya da taahhüt yokken token yok", async () => {
      const interp = await interpreter();
      const other = await interpreter();
      const { booking: b } = await booking();
      await assign(b.id, interp.profileId);
      const a = await assignmentFor(b.id);
      expect((await requestToken(a.id, other.token)).statusCode).toBe(404);

      // Atama kaldırıldı → artık alamaz.
      expect((await app.inject({ method: "DELETE", url: `/api/v1/admin/telehealth/bookings/${b.id}/interpreter`, headers: auth(admin.token), payload: { reason: "plan değişti" } })).statusCode).toBe(200);
      expect((await requestToken(a.id, interp.token)).statusCode).toBe(409);

      // Pencere dışı: görüşme bitti / ödenmedi.
      const done = await booking({ status: "COMPLETED" });
      const unpaid = await booking({ paid: false });
      for (const target of [done, unpaid]) {
        await app.prisma.appointmentInterpreter.create({ data: { bookingId: target.booking.id, interpreterId: interp.profileId, language: "ar" } });
        const row = await assignmentFor(target.booking.id);
        expect((await requestToken(row.id, interp.token)).statusCode).toBe(409);
      }

      // 2FA yok: ayar (interpreterRequire2fa) açıkken reddedilir; varsayılan kapalıyken katılabilir (Paket AA-ek).
      const no2fa = await interpreter({ twoFactor: false });
      const b2 = await booking();
      await app.prisma.appointmentInterpreter.create({ data: { bookingId: b2.booking.id, interpreterId: no2fa.profileId, language: "ar" } });
      await setRequire2fa(true);
      const r2 = await requestToken((await assignmentFor(b2.booking.id)).id, no2fa.token);
      expect([r2.statusCode, r2.json().error.code]).toEqual([403, "TWO_FACTOR_REQUIRED"]);
      await setRequire2fa(false);
      expect((await requestToken((await assignmentFor(b2.booking.id)).id, no2fa.token)).statusCode).toBe(200);

      // Taahhüt yok.
      const noConsent = await interpreter({ accepted: false });
      const b3 = await booking();
      await app.prisma.appointmentInterpreter.create({ data: { bookingId: b3.booking.id, interpreterId: noConsent.profileId, language: "ar" } });
      expect((await requestToken((await assignmentFor(b3.booking.id)).id, noConsent.token)).statusCode).toBe(403);
    });

    it("tercüman admin, doktor portalı, CRM, hasta belgeleri ve hasta/doktor meeting-token uçlarına erişemez", async () => {
      const interp = await interpreter();
      const { booking: b, appointment } = await booking();
      await assign(b.id, interp.profileId);
      for (const [method, url] of [
        ["GET", "/api/v1/admin/telehealth/appointments"],
        ["GET", "/api/v1/admin/users"],
        ["GET", "/api/v1/admin/crm/settings"],
        ["GET", "/api/v1/admin/telehealth/interpreters"],
        ["GET", `/api/v1/admin/telehealth/bookings/${b.id}/interpreter`],
      ] as const) {
        expect((await app.inject({ method, url, headers: auth(interp.token) })).statusCode, url).toBe(403);
      }
      for (const [method, url] of [
        ["GET", `/api/v1/appointments/bookings/${b.id}/intake`],
        ["GET", `/api/v1/appointments/bookings/${b.id}/documents`],
        ["POST", `/api/v1/appointments/${appointment.id}/meeting-token`],
        ["GET", `/api/v1/appointments/${appointment.id}`],
      ] as const) {
        const res = await app.inject({ method, url, headers: auth(interp.token), remoteAddress: nextIp() });
        expect([403, 404], url).toContain(res.statusCode);
      }
      const portal = await app.inject({ method: "GET", url: "/api/v1/doctor/me", headers: auth(interp.token) });
      expect([403, 404]).toContain(portal.statusCode);
    });

    it("panel: hastanın yalnızca baş harfi, doktorun görünen adı; belge/intake/not alanı yok", async () => {
      const interp = await interpreter();
      const { booking: b } = await booking();
      await assign(b.id, interp.profileId);
      const res = await app.inject({ method: "GET", url: "/api/v1/interpreter/assignments", headers: auth(interp.token) });
      expect(res.statusCode).toBe(200);
      const item = res.json().data[0];
      expect(item).toMatchObject({ patientInitial: "Z.", doctorDisplayName: "H. Sofu", language: "ar", canJoin: true });
      const body = JSON.stringify(res.json());
      expect(body).not.toContain("Zeynep");
      expect(body).not.toContain("Kaya");
      expect(body).not.toMatch(/intake|document|note|prescription|recording|email/i);
    });

    it("gizlilik taahhüdü: eski sürüme onay verilmez; güncel sürüm onaylanınca katılabilir", async () => {
      const interp = await interpreter({ accepted: false });
      const me = await app.inject({ method: "GET", url: "/api/v1/interpreter/me", headers: auth(interp.token) });
      expect(me.json().data.confidentiality).toMatchObject({ accepted: false });
      expect(me.json().data.confidentiality.textTr).toContain("gizli");
      expect((await app.inject({ method: "POST", url: "/api/v1/interpreter/confidentiality/accept", headers: auth(interp.token), payload: { version: "eski-surum-123" } })).statusCode).toBe(409);
      const version = me.json().data.confidentiality.version;
      expect((await app.inject({ method: "POST", url: "/api/v1/interpreter/confidentiality/accept", headers: auth(interp.token), payload: { version } })).statusCode).toBe(204);
      expect((await app.inject({ method: "GET", url: "/api/v1/interpreter/me", headers: auth(interp.token) })).json().data.confidentiality.accepted).toBe(true);
    });
  });

  describe("atama", () => {
    it("tek aktif tercüman; değiştirmede eski atama kapanır; dil ve çakışma filtresi; audit kayıtları", async () => {
      const arabic = await interpreter({ languages: ["ar"] });
      const russian = await interpreter({ languages: ["ru"] });
      const busy = await interpreter({ languages: ["ar"] });
      const inactive = await interpreter({ languages: ["ar"], active: false });
      const unconsented = await interpreter({ languages: ["ar"], accepted: false });
      const { booking: b } = await booking({ startsInMin: 300 });
      const clash = await booking({ startsInMin: 310 });
      await assign(clash.booking.id, busy.profileId);

      const state = (await app.inject({ method: "GET", url: `/api/v1/admin/telehealth/bookings/${b.id}/interpreter?language=ar`, headers: auth(manager.token) })).json().data;
      const ids = state.candidates.map((c: { id: string }) => c.id);
      expect(ids).toContain(arabic.profileId);
      expect(ids).not.toContain(russian.profileId); // dil
      expect(ids).not.toContain(busy.profileId); // çakışma
      expect(ids).not.toContain(inactive.profileId);
      expect(ids).not.toContain(unconsented.profileId);
      expect((await assign(b.id, busy.profileId)).statusCode).toBe(422);
      expect((await assign(b.id, russian.profileId)).statusCode).toBe(422);

      expect((await assign(b.id, arabic.profileId, "ar", manager.token)).statusCode).toBe(200);
      const second = await interpreter({ languages: ["ar"] });
      const replaced = await assign(b.id, second.profileId);
      expect(replaced.statusCode).toBe(200);
      expect(replaced.json().data.active.interpreterId).toBe(second.profileId);
      const rows = await app.prisma.appointmentInterpreter.findMany({ where: { bookingId: b.id }, orderBy: { assignedAt: "asc" } });
      expect(rows.map((r) => r.status)).toEqual(["CANCELLED", "ASSIGNED"]);
      expect(await app.prisma.auditLog.count({ where: { targetId: b.id, action: "interpreter.assigned" } })).toBe(2);
      expect(await app.prisma.auditLog.count({ where: { targetId: b.id, action: "interpreter.unassigned" } })).toBe(1);

      // DB güvencesi: ikinci aktif atama eklenemez.
      await expect(app.prisma.appointmentInterpreter.create({ data: { bookingId: b.id, interpreterId: arabic.profileId, language: "ar" } })).rejects.toThrow();
    });

    it("e-postalar: tercümana hasta adı/şikayet/belge yok, panel bağlantısı var; hastaya ve doktora yalnızca görünen ad", async () => {
      const doctorUser = await user("USER");
      const interp = await interpreter({ languages: ["ar", "tr"] });
      const { booking: b } = await booking({ doctorUserId: doctorUser.id });
      await assign(b.id, interp.profileId);
      const sent = mailSpy.mock.calls.map((c) => c[1] as { to: string; subject: string; html: string });
      expect(sent).toHaveLength(3);
      const toInterpreter = sent.find((m) => m.to === interp.email)!;
      expect(toInterpreter.subject).toBe("Yeni tercümanlık görevi");
      expect(toInterpreter.html).toContain("/tr/interpreter");
      expect(toInterpreter.html).toContain("TR saati");
      expect(toInterpreter.html).not.toMatch(/Zeynep|Kaya|şikayet|belge|intake/i);
      const toPatient = sent.find((m) => m.to === b.patientEmail)!;
      expect(toPatient.html).toContain('lang="ar"');
      expect(toPatient.html).toContain("A. Yılmaz");
      expect(toPatient.html).not.toContain(interp.email);
      expect(sent.find((m) => m.to === doctorUser.email)!.html).toContain("A. Yılmaz");
    });
  });

  describe("doktorun çıkarması ve hasta tarafı", () => {
    it("doktor tercümanı çıkarır: atama REMOVED, audit, tercüman yeni token alamaz; hasta çıkaramaz", async () => {
      const doctorUser = await user("USER");
      const interp = await interpreter();
      const { booking: b, appointment, raw } = await booking({ doctorUserId: doctorUser.id });
      await assign(b.id, interp.profileId);
      const a = await assignmentFor(b.id);
      expect((await requestToken(a.id, interp.token)).statusCode).toBe(200);

      const info = await app.inject({ method: "GET", url: `/api/v1/appointments/${appointment.id}/interpreter?t=${raw}` });
      expect(info.json().data).toEqual({ language: "ar", languageName: "العربية", displayName: "A. Yılmaz", status: "JOINED" });

      const patient = await user("USER");
      expect((await app.inject({ method: "POST", url: `/api/v1/appointments/${appointment.id}/interpreter/remove`, headers: auth(patient.token) })).statusCode).toBe(404);
      expect((await app.inject({ method: "POST", url: `/api/v1/appointments/${appointment.id}/interpreter/remove`, headers: auth(doctorUser.token) })).statusCode).toBe(204);
      expect((await assignmentFor(b.id)).status).toBe("REMOVED");
      expect(await app.prisma.auditLog.count({ where: { action: "interpreter.removed_by_doctor", targetId: b.id } })).toBe(1);
      expect(await app.prisma.auditLog.count({ where: { action: "interpreter.left", targetId: b.id } })).toBe(1);
      expect((await requestToken(a.id, interp.token)).statusCode).toBe(409);
      expect((await app.inject({ method: "GET", url: `/api/v1/appointments/${appointment.id}/interpreter?t=${raw}` })).json().data).toBeNull();
    });

    it("hasta talebi: yalnızca interpreterIncluded=true iken; booking token'ı ile; kaldırılabilir", async () => {
      const { booking: b, raw } = await booking();
      const url = `/api/v1/appointments/bookings/${b.id}/interpreter-request?t=${raw}`;
      expect((await app.inject({ method: "PUT", url, payload: { language: "ar" }, remoteAddress: nextIp() })).statusCode).toBe(409);
      await app.prisma.siteModule.update({ where: { key: "telehealth" }, data: { settings: { languageSupport: { supportLanguages: ["ar", "en"], supportHours: {}, interpreterIncluded: true } } } });
      expect((await app.inject({ method: "PUT", url, payload: { language: "ru" }, remoteAddress: nextIp() })).statusCode).toBe(422);
      expect((await app.inject({ method: "PUT", url: url.replace(raw, "yanlis"), payload: { language: "ar" }, remoteAddress: nextIp() })).statusCode).toBe(404);
      expect((await app.inject({ method: "PUT", url, payload: { language: "ar" }, remoteAddress: nextIp() })).statusCode).toBe(204);
      expect((await app.prisma.interpreterRequest.findUniqueOrThrow({ where: { bookingId: b.id } })).language).toBe("ar");
      expect((await app.inject({ method: "PUT", url, payload: { language: null }, remoteAddress: nextIp() })).statusCode).toBe(204);
      expect(await app.prisma.interpreterRequest.count({ where: { bookingId: b.id } })).toBe(0);
    });
  });

  describe("hesap, rapor", () => {
    it("ADMIN tercüman hesabı açar (davet e-postası, rol INTERPRETER, varsayılan baş harfli ad); MANAGER açamaz; genel kullanıcı ekranından INTERPRETER verilemez", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/admin/telehealth/interpreters",
        headers: auth(admin.token),
        payload: { name: "Leyla Hasan ALİ", email: `leyla-${crypto.randomUUID()}@example.com`, languages: ["ar", "en"] },
        remoteAddress: nextIp(),
      });
      expect(res.statusCode).toBe(201);
      expect(res.json().data.interpreter).toMatchObject({ displayName: "L. H. Ali", languages: ["ar", "en"], confidentialityCurrent: false, twoFactorEnabled: false });
      expect((await app.prisma.user.findUniqueOrThrow({ where: { id: res.json().data.interpreter.userId } })).role).toBe("INTERPRETER");
      expect((await app.inject({ method: "POST", url: "/api/v1/admin/telehealth/interpreters", headers: auth(manager.token), payload: { name: "X Y", email: "xy@example.com", languages: ["ar"] } })).statusCode).toBe(403);
      const generic = await app.inject({ method: "POST", url: "/api/v1/admin/users", headers: auth(admin.token), payload: { name: "Z", email: `z-${crypto.randomUUID()}@example.com`, role: "INTERPRETER" }, remoteAddress: nextIp() });
      expect(generic.statusCode).toBe(422);
    });

    it("rapor: tercüman bazında görüşme sayısı, dil ve toplam süre (audit join/leave); CSV", async () => {
      const interp = await interpreter();
      const { booking: b } = await booking();
      await assign(b.id, interp.profileId);
      const a = await assignmentFor(b.id);
      await requestToken(a.id, interp.token);
      await app.prisma.appointmentInterpreter.update({ where: { id: a.id }, data: { joinedAt: new Date(Date.now() - 125_000) } });
      expect((await app.inject({ method: "POST", url: `/api/v1/interpreter/assignments/${a.id}/leave`, headers: auth(interp.token) })).statusCode).toBe(204);
      expect((await app.inject({ method: "POST", url: `/api/v1/interpreter/assignments/${a.id}/leave`, headers: auth(interp.token) })).statusCode).toBe(204);

      const day = new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
      const report = await app.inject({ method: "GET", url: `/api/v1/admin/telehealth/interpreters/report?from=${day}&to=${day}`, headers: auth(manager.token) });
      const row = report.json().data.find((r: { interpreterId: string }) => r.interpreterId === interp.profileId);
      expect(row).toMatchObject({ language: "ar", consultations: 1 });
      expect(row.totalSeconds).toBeGreaterThanOrEqual(124);
      const csv = await app.inject({ method: "GET", url: `/api/v1/admin/telehealth/interpreters/report?from=${day}&to=${day}&format=csv`, headers: auth(manager.token) });
      expect(csv.headers["content-type"]).toContain("text/csv");
      expect(csv.body).toContain("A. Yılmaz");
    });
  });

  describe("temizleyici (çıkarılan tercüman eski token'la geri dönemez)", () => {
    it("aktif ataması olmayan ya da pasif tercüman kimliği odadan çıkarılır; meşru tercüman ve diğer katılımcılar kalır", async () => {
      const { runInterpreterSweep, parseInterpreterIdentity } = await import("../../src/modules/telehealth/lib/interpreter-sweeper");
      expect(parseInterpreterIdentity("interpreter:p:b")).toEqual({ profileId: "p", bookingId: "b" });
      expect(parseInterpreterIdentity("doctor:x")).toBeNull();

      const removedOne = await interpreter();
      const legit = await interpreter();
      const deactivated = await interpreter();
      const b1 = await booking();
      const b2 = await booking();
      const b3 = await booking();
      await assign(b1.booking.id, removedOne.profileId);
      await app.inject({ method: "DELETE", url: `/api/v1/admin/telehealth/bookings/${b1.booking.id}/interpreter`, headers: auth(admin.token), payload: {} });
      await assign(b2.booking.id, legit.profileId);
      await assign(b3.booking.id, deactivated.profileId);
      await app.prisma.interpreterProfile.update({ where: { id: deactivated.profileId }, data: { isActive: false } });

      const rooms: Record<string, string[]> = {
        [b1.booking.meetingRoomName]: [`interpreter:${removedOne.profileId}:${b1.booking.id}`, "doctor:x", "patient:y"],
        [b2.booking.meetingRoomName]: [`interpreter:${legit.profileId}:${b2.booking.id}`, "doctor:x", "qa-listener-u-1"],
        [b3.booking.meetingRoomName]: [`interpreter:${deactivated.profileId}:${b3.booking.id}`],
      };
      const removed: string[] = [];
      const result = await runInterpreterSweep(app, {
        listIdentities: async (room) => rooms[room] ?? [],
        removeParticipant: async (_room, identity) => {
          removed.push(identity);
          return true;
        },
      });
      expect(removed.sort()).toEqual([`interpreter:${deactivated.profileId}:${b3.booking.id}`, `interpreter:${removedOne.profileId}:${b1.booking.id}`].sort());
      expect(result.removed).toHaveLength(2);
      expect(await app.prisma.auditLog.count({ where: { action: "interpreter.stray_removed" } })).toBe(2);
    });

    it("biten/iptal randevuya tercüman talebi açılmaz (kaldırma serbest)", async () => {
      await app.prisma.siteModule.update({ where: { key: "telehealth" }, data: { settings: { languageSupport: { supportLanguages: ["ar"], supportHours: {}, interpreterIncluded: true } } } });
      const { booking: b, raw } = await booking({ status: "COMPLETED" });
      const url = `/api/v1/appointments/bookings/${b.id}/interpreter-request?t=${raw}`;
      expect((await app.inject({ method: "PUT", url, payload: { language: "ar" }, remoteAddress: nextIp() })).statusCode).toBe(409);
      expect((await app.inject({ method: "PUT", url, payload: { language: null }, remoteAddress: nextIp() })).statusCode).toBe(204);
    });
  });

  describe("var olan kullanıcıya tercümanlık yetkisi (Paket AA-ek)", () => {
    async function grant(userId: string, languages = ["ar", "tr"]) {
      return app.inject({ method: "POST", url: "/api/v1/admin/telehealth/interpreters/from-user", headers: auth(admin.token), payload: { userId, languages }, remoteAddress: nextIp() });
    }
    async function acceptConfidentiality(token: string) {
      const res = await app.inject({ method: "POST", url: "/api/v1/interpreter/confidentiality/accept", headers: auth(token), payload: { version: await confidentialityVersion() }, remoteAddress: nextIp() });
      expect(res.statusCode).toBe(204);
    }

    it("USER, ADMIN ve doktor: rol değişmez, eski yetkiler çalışır; token yalnızca atanmış görüşme için ve her zaman tercüman token'ı", async () => {
      const patient = await user("USER");
      const otherAdmin = await user("ADMIN", { twoFactor: true });
      const doctorUser = await user("USER");
      await booking({ doctorUserId: doctorUser.id });

      const before = {
        adminUsers: (await app.inject({ method: "GET", url: "/api/v1/admin/users", headers: auth(otherAdmin.token) })).statusCode,
        doctorMe: (await app.inject({ method: "GET", url: "/api/v1/doctor/me", headers: auth(doctorUser.token) })).statusCode,
      };

      for (const target of [patient, otherAdmin, doctorUser]) {
        mailSpy.mockClear();
        const res = await grant(target.id);
        expect(res.statusCode).toBe(201);
        expect(res.json().data.existing).toBe(false);
        const roleBefore = target === otherAdmin ? "ADMIN" : "USER";
        expect(res.json().data.interpreter.role).toBe(roleBefore);
        expect((await app.prisma.user.findUniqueOrThrow({ where: { id: target.id } })).role).toBe(roleBefore);
        // "Tercümanlık yetkisi verildi" e-postası; 2FA adımı ayar kapalıyken yok.
        expect(mailSpy).toHaveBeenCalledTimes(1);
        const mail = mailSpy.mock.calls[0][1] as { to: string; subject: string; html: string };
        expect(mail.to).toBe(target.email);
        expect(mail.subject).toBe("Tercümanlık yetkisi verildi");
        expect(mail.html).toContain("/tr/interpreter");
        expect(mail.html).not.toContain("iki adımlı");
        const audit = await app.prisma.auditLog.findFirstOrThrow({ where: { action: "interpreter.profile_created_for_existing_user", targetId: res.json().data.interpreter.id } });
        expect(audit.metadata).toMatchObject({ userId: target.id, role: roleBefore });
        expect(JSON.stringify(audit.metadata)).not.toContain(target.email);
        // İkinci kez: yeni profil açılmaz, mevcut profil döner.
        const again = await grant(target.id);
        expect([again.statusCode, again.json().data.existing, again.json().data.interpreter.id]).toEqual([200, true, res.json().data.interpreter.id]);
      }
      expect(await app.prisma.interpreterProfile.count({ where: { userId: { in: [patient.id, otherAdmin.id, doctorUser.id] } } })).toBe(3);

      // Eski yetkiler aynen.
      expect((await app.inject({ method: "GET", url: "/api/v1/admin/users", headers: auth(otherAdmin.token) })).statusCode).toBe(before.adminUsers);
      expect((await app.inject({ method: "GET", url: "/api/v1/doctor/me", headers: auth(doctorUser.token) })).statusCode).toBe(before.doctorMe);
      expect((await app.inject({ method: "GET", url: "/api/v1/admin/users", headers: auth(patient.token) })).statusCode).toBe(403);
      // Hesap menüsü bayrağı.
      expect((await app.inject({ method: "GET", url: "/api/v1/interpreter/access", headers: auth(patient.token) })).json().data.hasProfile).toBe(true);
      expect((await app.inject({ method: "GET", url: "/api/v1/interpreter/access", headers: auth(manager.token) })).json().data.hasProfile).toBe(false);

      // ADMIN tercüman: kendi atandığı görüşmede tercüman token'ı (dinleyici/doktor değil); başkasının atamasında 404.
      const adminProfile = await app.prisma.interpreterProfile.findUniqueOrThrow({ where: { userId: otherAdmin.id } });
      await acceptConfidentiality(otherAdmin.token);
      const { booking: b } = await booking();
      expect((await assign(b.id, adminProfile.id)).statusCode).toBe(200);
      const a = await assignmentFor(b.id);
      const res = await requestToken(a.id, otherAdmin.token);
      expect(res.statusCode).toBe(200);
      const claims = jwt.verify(res.json().data.token, FAKE_SECRET) as Claims;
      expect(claims.sub).toBe(`interpreter:${adminProfile.id}:${b.id}`);
      expect(JSON.parse(claims.metadata ?? "{}")).toEqual({ role: "interpreter", language: "ar" });
      expect(claims.video.hidden).toBeUndefined();
      expect(claims.video.canPublishSources).toEqual(["camera", "microphone"]);
      await acceptConfidentiality(patient.token);
      expect((await requestToken(a.id, patient.token)).statusCode).toBe(404);
      // Panelde yalnızca tercümanlık atamaları (rolün verisi yok).
      const list = await app.inject({ method: "GET", url: "/api/v1/interpreter/assignments", headers: auth(otherAdmin.token) });
      expect(list.json().data.map((x: { id: string }) => x.id)).toEqual([a.id]);
    });

    it("taahhüt yoksa token yok; 2FA yalnızca ayar açıkken zorunlu; ayar yalnızca ADMIN değiştirir", async () => {
      const patient = await user("USER");
      const profileId = (await grant(patient.id)).json().data.interpreter.id as string;
      const { booking: b } = await booking();
      await app.prisma.appointmentInterpreter.create({ data: { bookingId: b.id, interpreterId: profileId, language: "ar" } });
      const a = await assignmentFor(b.id);
      expect((await requestToken(a.id, patient.token)).statusCode).toBe(403);
      await acceptConfidentiality(patient.token);

      await setRequire2fa(true);
      const me = await app.inject({ method: "GET", url: "/api/v1/interpreter/me", headers: auth(patient.token) });
      expect(me.json().data.twoFactorRequired).toBe(true);
      expect((await requestToken(a.id, patient.token)).json().error.code).toBe("TWO_FACTOR_REQUIRED");
      await setRequire2fa(false);
      expect((await requestToken(a.id, patient.token)).statusCode).toBe(200);

      expect((await app.inject({ method: "PUT", url: "/api/v1/admin/telehealth/interpreters/settings", headers: auth(manager.token), payload: { require2fa: true } })).statusCode).toBe(403);
      expect((await app.inject({ method: "GET", url: "/api/v1/admin/telehealth/interpreters/settings", headers: auth(manager.token) })).json().data.require2fa).toBe(false);
      expect(await app.prisma.auditLog.count({ where: { action: "interpreter.settings_updated" } })).toBeGreaterThan(0);
    });

    it("çıkar çatışması: kendi hasta ya da doktor olduğu görüşmeye atanamaz ve aday listesinde görünmez", async () => {
      const doctorUser = await user("USER");
      const patient = await user("USER");
      const doctorProfileId = (await grant(doctorUser.id)).json().data.interpreter.id as string;
      const patientProfileId = (await grant(patient.id)).json().data.interpreter.id as string;
      await acceptConfidentiality(doctorUser.token);
      await acceptConfidentiality(patient.token);
      const { booking: b } = await booking({ doctorUserId: doctorUser.id, patientUserId: patient.id });

      const state = await app.inject({ method: "GET", url: `/api/v1/admin/telehealth/bookings/${b.id}/interpreter?language=ar`, headers: auth(admin.token) });
      const ids = state.json().data.candidates.map((c: { id: string }) => c.id);
      expect(ids).not.toContain(doctorProfileId);
      expect(ids).not.toContain(patientProfileId);
      for (const id of [doctorProfileId, patientProfileId]) {
        const res = await assign(b.id, id);
        expect(res.statusCode).toBe(422);
        expect(res.json().error.message).toContain("çıkar çatışması");
      }
      // Başka bir görüşmeye atanabilir.
      const other = await booking();
      expect((await assign(other.booking.id, patientProfileId)).statusCode).toBe(200);
      // Atama sonradan çatışmaya düşerse (kayıt doğrudan) token verilmez.
      await app.prisma.appointmentInterpreter.updateMany({ where: { bookingId: other.booking.id }, data: { status: "CANCELLED" } });
      await app.prisma.appointmentInterpreter.create({ data: { bookingId: b.id, interpreterId: patientProfileId, language: "ar" } });
      expect((await requestToken((await assignmentFor(b.id)).id, patient.token)).statusCode).toBe(403);
    });

    it("çıkar çatışması (güvenlik incelemesi): misafir randevuda hasta e-postası eşleşirse atanamaz; atamadan sonra doğan çatışmada temizleyici odadan çıkarır", async () => {
      const guest = await user("USER");
      const guestProfileId = (await grant(guest.id)).json().data.interpreter.id as string;
      await acceptConfidentiality(guest.token);
      // Hesapsız (misafir) randevu: patientUserId yok, hasta e-postası tercümanın hesap e-postasıyla aynı (büyük harfle).
      const guestBooking = await booking({ patientEmail: guest.email.toUpperCase() });
      const state = await app.inject({ method: "GET", url: `/api/v1/admin/telehealth/bookings/${guestBooking.booking.id}/interpreter?language=ar`, headers: auth(admin.token) });
      expect(state.json().data.candidates.map((c: { id: string }) => c.id)).not.toContain(guestProfileId);
      expect((await assign(guestBooking.booking.id, guestProfileId)).statusCode).toBe(422);

      // Atama geçerliyken yapıldı; sonra tercüman bu görüşmenin hastası oldu → temizleyici çıkarır.
      const later = await booking();
      expect((await assign(later.booking.id, guestProfileId)).statusCode).toBe(200);
      const identity = `interpreter:${guestProfileId}:${later.booking.id}`;
      const { runInterpreterSweep } = await import("../../src/modules/telehealth/lib/interpreter-sweeper");
      const sweep = async () => {
        const removed: string[] = [];
        await runInterpreterSweep(app, {
          listIdentities: async (room) => (room === later.booking.meetingRoomName ? [identity] : []),
          removeParticipant: async (_room, id) => {
            removed.push(id);
            return true;
          },
        });
        return removed;
      };
      expect(await sweep()).toEqual([]);
      await app.prisma.appointmentBooking.update({ where: { id: later.booking.id }, data: { patientUserId: guest.id } });
      expect(await sweep()).toEqual([identity]);
    });

    it("tercümanlığı kapatma: gelecek atamalar CANCELLED, rol ve hesap aynı, panel erişimi kapanır; geçmiş atama kalır", async () => {
      const staff = await user("MANAGER", { twoFactor: true });
      const profileId = (await grant(staff.id)).json().data.interpreter.id as string;
      await acceptConfidentiality(staff.token);
      const future = await booking({ startsInMin: 600 });
      expect((await assign(future.booking.id, profileId)).statusCode).toBe(200);
      const past = await booking({ status: "COMPLETED", startsInMin: -600 });
      await app.prisma.appointmentInterpreter.create({ data: { bookingId: past.booking.id, interpreterId: profileId, language: "ar", status: "LEFT" } });

      const res = await app.inject({ method: "PATCH", url: `/api/v1/admin/telehealth/interpreters/${profileId}`, headers: auth(admin.token), payload: { isActive: false } });
      expect(res.statusCode).toBe(200);
      expect((await assignmentFor(future.booking.id)).status).toBe("CANCELLED");
      expect((await assignmentFor(past.booking.id)).status).toBe("LEFT");
      const u = await app.prisma.user.findUniqueOrThrow({ where: { id: staff.id } });
      expect([u.role, u.status]).toEqual(["MANAGER", "ACTIVE"]);
      expect((await app.prisma.auditLog.findFirstOrThrow({ where: { action: "interpreter.deactivated", targetId: profileId } })).metadata).toMatchObject({ cancelledAssignments: 1 });
      expect((await app.inject({ method: "GET", url: "/api/v1/interpreter/me", headers: auth(staff.token) })).statusCode).toBe(403);
      expect((await app.inject({ method: "GET", url: "/api/v1/interpreter/access", headers: auth(staff.token) })).json().data.hasProfile).toBe(false);
      // Rolün kendi yetkisi çalışmaya devam eder.
      expect((await app.inject({ method: "GET", url: "/api/v1/admin/telehealth/interpreters", headers: auth(staff.token) })).statusCode).toBe(200);
    });

    it("yeni hesap formunda kayıtlı e-posta: hata yerine 'Var olan kullanıcıdan ekle' yönlendirmesi; arama rol gösterir; MANAGER yetki veremez", async () => {
      const existing = await user("USER");
      const res = await app.inject({ method: "POST", url: "/api/v1/admin/telehealth/interpreters", headers: auth(admin.token), payload: { name: "X Y", email: existing.email, languages: ["ar"] }, remoteAddress: nextIp() });
      expect(res.statusCode).toBe(409);
      expect(res.json().error.message).toBe("Bu e-posta kayıtlı. Var olan kullanıcıdan ekle sekmesinden tercümanlık verebilirsiniz.");
      expect(res.json().error.details).toEqual({ email: ["EMAIL_REGISTERED_USE_EXISTING"] });

      const search = await app.inject({ method: "GET", url: `/api/v1/admin/telehealth/interpreters/user-search?q=${encodeURIComponent(existing.email)}`, headers: auth(admin.token) });
      expect(search.json().data).toEqual([{ id: existing.id, name: "Test USER", email: existing.email, role: "USER", isDoctor: false, interpreterProfileId: null }]);
      expect((await app.inject({ method: "GET", url: "/api/v1/admin/telehealth/interpreters/user-search?q=test", headers: auth(manager.token) })).statusCode).toBe(403);
      const byManager = await app.inject({ method: "POST", url: "/api/v1/admin/telehealth/interpreters/from-user", headers: auth(manager.token), payload: { userId: existing.id, languages: ["ar"] }, remoteAddress: nextIp() });
      expect(byManager.statusCode).toBe(403);
    });
  });
});
