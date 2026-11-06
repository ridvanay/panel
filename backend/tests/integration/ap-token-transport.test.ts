import crypto from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../src/app";
import { env } from "../../src/config/env";
import { resetDatabase } from "../helpers/reset-db";
import { hashPassword } from "../../src/lib/password";
import { hashToken } from "../../src/lib/tokens";
import { LEGACY_TOKEN_IN_URL_UNTIL } from "../../src/lib/access-token-transport";
import { issueSessionToken } from "../../src/modules/blog/lib/preview-token";
import { createReviewInvite } from "../../src/modules/reviews/reviews.service";

/**
 * Paket AP — gizli token'ların taşınması: yeni biçim (`X-Access-Token` başlığı / POST gövdesi) çalışır; eski biçim
 * (`?t=`, yol parçası) geçiş süresi içinde çalışır, süre dolunca aynı tek tip 404/410 döner (saat sahteleme ile).
 * Gerçek pino akışı yakalanır: token değeri sorgu, yol ve başlık kullanımında log'a düşmez; eski biçim yalnızca
 * `legacy_token_transport` sayacı + yol adıyla loglanır.
 */
const AFTER_DEADLINE = new Date(LEGACY_TOKEN_IN_URL_UNTIL.getTime() + 1000);
const FAR_FUTURE = new Date("2027-06-01T09:00:00.000Z");
const ORIGIN = { origin: env.FRONTEND_URL };

describe("Paket AP — token taşıma biçimi", () => {
  let app: FastifyInstance;
  const logLines: string[] = [];
  const logText = () => logLines.join("");
  let ipSeq = 0;
  const nextIp = () => `10.77.${Math.floor(++ipSeq / 250)}.${(ipSeq % 250) + 1}`;

  let bookingId: string;
  let bookingToken: string;

  beforeAll(async () => {
    app = buildApp({ logStream: { write: (line: string) => void logLines.push(line) } });
    await app.ready();
    await resetDatabase(app.prisma);
    await app.prisma.siteModule.upsert({ where: { key: "telehealth" }, create: { key: "telehealth", enabled: true }, update: { enabled: true } });

    const specialty = await app.prisma.specialty.create({ data: { name: `AP ${crypto.randomUUID()}`, slug: `ap-${crypto.randomUUID()}`, icon: "heart-pulse" } });
    const doctor = await app.prisma.doctorProfile.create({
      data: {
        title: "Dr.",
        fullName: `AP Doktor ${crypto.randomUUID()}`,
        slug: `ap-doktor-${crypto.randomUUID()}`,
        bio: "Test",
        languages: ["en"],
        timeZone: "Europe/Istanbul",
        specialtyId: specialty.id,
        sessionDurationMin: 30,
        sessionPriceCents: 50000,
        currency: "TRY",
        isActive: true,
      },
    });
    await app.prisma.doctorAvailability.create({ data: { doctorId: doctor.id, dayOfWeek: 1, startMinute: 540, endMinute: 1020, isActive: true } });
    const now = new Date();
    const daysUntilMonday = (8 - now.getUTCDay()) % 7 || 7;
    const slot = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + daysUntilMonday, 6, 0, 0));
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/appointments/bookings",
      remoteAddress: nextIp(),
      payload: {
        doctorSlug: doctor.slug,
        slots: [slot.toISOString()],
        patientName: "AP Hasta",
        patientEmail: `ap-${crypto.randomUUID()}@example.com`,
        identity: { citizenshipType: "TR", identityNumber: "10000000146", birthDate: "1990-01-01" },
        consent: true,
      },
    });
    expect(res.statusCode).toBe(201);
    ({ bookingId, accessToken: bookingToken } = res.json().data as { bookingId: string; accessToken: string });
    // Token ömrü son randevu + 30 gün: geçiş süresi sonrası denemelerde token'ın KENDİSİ geçerli kalsın diye
    // randevu ileri alınır — böylece sonuç farkı yalnızca taşıma biçiminden gelir.
    await app.prisma.appointment.updateMany({ where: { bookingId }, data: { startsAt: FAR_FUTURE, endsAt: new Date(FAR_FUTURE.getTime() + 30 * 60_000) } });
    await app.prisma.appointmentBooking.update({ where: { id: bookingId }, data: { expiresAt: FAR_FUTURE } });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  afterAll(async () => {
    await app.close();
  });

  const getBooking = (headers: Record<string, string> = {}, query = "") =>
    app.inject({ method: "GET", url: `/api/v1/appointments/bookings/${bookingId}${query}`, headers, remoteAddress: nextIp() });

  describe("randevu (booking) erişimi", () => {
    it("yeni biçim: X-Access-Token başlığıyla 200", async () => {
      expect((await getBooking({ "x-access-token": bookingToken })).statusCode).toBe(200);
    });

    it("eski biçim (?t=) geçiş süresinde 200; log'a token değil sayaç + yol adı yazılır", async () => {
      const before = logLines.length;
      expect((await getBooking({}, `?t=${bookingToken}`)).statusCode).toBe(200);
      const lines = logLines.slice(before).join("");
      expect(lines).toContain('"legacy_token_transport"');
      expect(lines).toContain('"route":"/api/v1/appointments/bookings/:bookingId"');
      expect(lines).not.toContain(bookingToken);
    });

    it("geçiş süresi dolunca eski biçim tek tip 404; başlık çalışmaya devam eder", async () => {
      vi.useFakeTimers({ toFake: ["Date"], now: AFTER_DEADLINE });
      const legacy = await getBooking({}, `?t=${bookingToken}`);
      const none = await getBooking();
      expect(legacy.statusCode).toBe(404);
      expect(legacy.json()).toEqual(none.json());
      expect((await getBooking({ "x-access-token": bookingToken })).statusCode).toBe(200);
    });

    it("yanlış başlık 404 ve hata gövdesi başlık değerini yansıtmaz", async () => {
      const res = await getBooking({ "x-access-token": "WRONG-SECRET-VALUE-0123456789" });
      expect(res.statusCode).toBe(404);
      expect(res.body).not.toContain("WRONG-SECRET-VALUE-0123456789");
    });

    it("CORS: X-Access-Token ön kontrolde izinli", async () => {
      const res = await app.inject({
        method: "OPTIONS",
        url: `/api/v1/appointments/bookings/${bookingId}`,
        headers: { origin: env.FRONTEND_URL, "access-control-request-method": "GET", "access-control-request-headers": "x-access-token" },
        remoteAddress: nextIp(),
      });
      expect(res.statusCode).toBeLessThan(300);
      expect(String(res.headers["access-control-allow-headers"]).toLowerCase()).toContain("x-access-token");
    });
  });

  describe("blog önizleme", () => {
    async function seedPostWithSessionToken() {
      const slug = `ap-${crypto.randomUUID().slice(0, 8)}`;
      const post = await app.prisma.blogPost.create({
        data: { title: `AP ${slug}`, slug, excerpt: "Özet", contentHtml: "<p>taslak</p>", status: "DRAFT", readingMinutes: 1, medicalReviewStatus: "not_required" } as never,
      });
      return { postId: post.id, token: issueSessionToken(post.id, "admin").token };
    }
    const openPreview = (postId: string, headers: Record<string, string> = {}, query = "") =>
      app.inject({ method: "GET", url: `/api/v1/blog/preview/${postId}${query}`, headers, remoteAddress: nextIp() });

    it("başlıkla 200; eski ?t= geçiş süresinde 200; süre dolunca eski biçim 404, başlık 200", async () => {
      const a = await seedPostWithSessionToken();
      expect((await openPreview(a.postId, { "x-access-token": a.token })).statusCode).toBe(200);
      expect((await openPreview(a.postId, {}, `?t=${encodeURIComponent(a.token)}`)).statusCode).toBe(200);

      vi.useFakeTimers({ toFake: ["Date"], now: AFTER_DEADLINE });
      const b = await seedPostWithSessionToken(); // oturum belirteci sahte saatte üretilir (30 dk geçerli)
      expect((await openPreview(b.postId, {}, `?t=${encodeURIComponent(b.token)}`)).statusCode).toBe(404);
      expect((await openPreview(b.postId, { "x-access-token": b.token })).statusCode).toBe(200);
      expect(logText()).not.toContain(a.token);
      expect(logText()).not.toContain(b.token);
    });
  });

  describe("yorum daveti", () => {
    async function freshInvite(): Promise<string> {
      await app.prisma.testimonial.deleteMany({ where: { bookingId } });
      await app.prisma.testimonialInvite.deleteMany({ where: { bookingId } });
      const raw = (await createReviewInvite(app, bookingId))!;
      await app.prisma.testimonialInvite.update({ where: { bookingId }, data: { expiresAt: FAR_FUTURE } });
      return raw;
    }
    const review = { rating: 5, title: "Çok iyi", body: "Süreç boyunca her şey açık ve hızlıydı, teşekkürler.", displayMode: "initials", publishConsent: true, consentTextVersion: "v1" };

    it("yeni biçim: lookup + submit POST gövdesiyle", async () => {
      const token = await freshInvite();
      const info = await app.inject({ method: "POST", url: "/api/v1/reviews/invite/lookup", headers: ORIGIN, payload: { token }, remoteAddress: nextIp() });
      expect(info.statusCode).toBe(200);
      expect(info.json().data.doctorName).toMatch(/^Dr\. /);
      const sent = await app.inject({ method: "POST", url: "/api/v1/reviews/invite/submit", headers: ORIGIN, payload: { ...review, token }, remoteAddress: nextIp() });
      expect(sent.statusCode).toBe(201);
      // tek kullanımlık: ikinci gönderim 404
      expect((await app.inject({ method: "POST", url: "/api/v1/reviews/invite/submit", headers: ORIGIN, payload: { ...review, token }, remoteAddress: nextIp() })).statusCode).toBe(404);
    });

    it("eski yol biçimi geçiş süresinde çalışır, yol token'ı log'da maskelenir; süre dolunca 404 / opt-out etkisiz 204", async () => {
      const token = await freshInvite();
      const before = logLines.length;
      expect((await app.inject({ method: "GET", url: `/api/v1/reviews/invite/${token}`, remoteAddress: nextIp() })).statusCode).toBe(200);
      const lines = logLines.slice(before).join("");
      expect(lines).toContain('"legacy_token_transport"');
      expect(lines).toContain("/api/v1/reviews/invite/***");
      expect(lines).not.toContain(token);

      vi.useFakeTimers({ toFake: ["Date"], now: AFTER_DEADLINE });
      expect((await app.inject({ method: "GET", url: `/api/v1/reviews/invite/${token}`, remoteAddress: nextIp() })).statusCode).toBe(404);
      expect((await app.inject({ method: "POST", url: `/api/v1/reviews/invite/${token}`, headers: ORIGIN, payload: review, remoteAddress: nextIp() })).statusCode).toBe(404);
      expect((await app.inject({ method: "POST", url: `/api/v1/reviews/invite/${token}/opt-out`, headers: ORIGIN, remoteAddress: nextIp() })).statusCode).toBe(204);
      expect(await app.prisma.reviewRequestOptOut.count()).toBe(0);
      // yeni biçim süre sonrasında da çalışır
      expect((await app.inject({ method: "POST", url: "/api/v1/reviews/invite/lookup", headers: ORIGIN, payload: { token }, remoteAddress: nextIp() })).statusCode).toBe(200);
    });
  });

  describe("kullanıcı daveti", () => {
    const PASSWORD = "GucluSifre.2026!";
    async function createUser() {
      const user = await app.prisma.user.create({
        data: { email: `ap-${crypto.randomUUID()}@example.com`, name: "AP Kullanıcı", passwordHash: await hashPassword(PASSWORD), role: "USER", status: "ACTIVE", emailVerifiedAt: new Date() },
      });
      return { userId: user.id, email: user.email, password: PASSWORD };
    }
    async function seedInvitation() {
      const owner = await createUser();
      const invitee = await createUser();
      const org = await app.prisma.organization.create({ data: { name: "AP Org", slug: `ap-org-${crypto.randomUUID().slice(0, 8)}`, ownerId: owner.userId } });
      const raw = crypto.randomBytes(32).toString("base64url");
      await app.prisma.invitation.create({ data: { organizationId: org.id, email: invitee.email, role: "MEMBER", tokenHash: hashToken(raw), expiresAt: FAR_FUTURE } });
      return { raw, invitee };
    }
    async function login(email: string, password: string) {
      const res = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email, password }, remoteAddress: nextIp() });
      return { authorization: `Bearer ${res.json().data.tokens.accessToken as string}` };
    }

    it("yeni biçim: POST /invitations/accept gövdesiyle", async () => {
      const { raw, invitee } = await seedInvitation();
      const res = await app.inject({ method: "POST", url: "/api/v1/invitations/accept", headers: await login(invitee.email, invitee.password), payload: { token: raw }, remoteAddress: nextIp() });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.role).toBe("MEMBER");
    });

    it("eski yol biçimi geçiş süresinde çalışır (log'da maskeli); süre dolunca 410", async () => {
      const first = await seedInvitation();
      const before = logLines.length;
      const ok = await app.inject({ method: "POST", url: `/api/v1/invitations/${first.raw}/accept`, headers: await login(first.invitee.email, first.invitee.password), remoteAddress: nextIp() });
      expect(ok.statusCode).toBe(200);
      const lines = logLines.slice(before).join("");
      expect(lines).toContain("/api/v1/invitations/***/accept");
      expect(lines).not.toContain(first.raw);

      const second = await seedInvitation();
      vi.useFakeTimers({ toFake: ["Date"], now: AFTER_DEADLINE });
      const auth = await login(second.invitee.email, second.invitee.password); // JWT sahte saatte üretilir
      expect((await app.inject({ method: "POST", url: `/api/v1/invitations/${second.raw}/accept`, headers: auth, remoteAddress: nextIp() })).statusCode).toBe(410);
      expect((await app.inject({ method: "POST", url: "/api/v1/invitations/accept", headers: auth, payload: { token: second.raw }, remoteAddress: nextIp() })).statusCode).toBe(200);
    });
  });

  it("log redact: X-Access-Token başlığı içeren nesne loglanırsa değer [REDACTED] olur", () => {
    const before = logLines.length;
    app.log.info({ headers: { "x-access-token": "REDACT-ME-SECRET-42" } }, "ap-redact-check");
    app.log.info({ req: { headers: { "x-access-token": "REDACT-ME-SECRET-43" } } }, "ap-redact-check-2");
    const lines = logLines.slice(before).join("");
    expect(lines).not.toContain("REDACT-ME-SECRET-42");
    expect(lines).not.toContain("REDACT-ME-SECRET-43");
    expect(lines).toContain("[REDACTED]");
  });

  it("tüm akış boyunca booking token'ı hiçbir log satırında yok (sorgu, başlık, Stripe/e-posta dahil)", () => {
    expect(logText()).not.toContain(bookingToken);
  });
});
