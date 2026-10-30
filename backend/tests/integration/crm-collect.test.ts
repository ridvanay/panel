import crypto from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestApp } from "../helpers/build-test-app";
import { resetDatabase } from "../helpers/reset-db";
import { hashToken } from "../../src/lib/tokens";
import { DEFAULT_CRM_SETTINGS, parseCrmSettings, writeCrmSettings } from "../../src/modules/crm/crm.settings";
import { CRM_FLOOD_MAX_EVENTS, resetFloodWindows, sanitizeTarget } from "../../src/modules/crm/crm.collect";
import { ipMatchesList, isBotUserAgent, isExcludedPath, maskIp, parseUserAgent, sanitizeText } from "../../src/modules/crm/crm.privacy";
import { classifySource } from "../../src/modules/crm/crm.source";
import { computeVisitorScore } from "../../src/modules/crm/crm.score";
import { istanbulDate, runCrmRetentionSweep, runCrmRollupForDate, shiftDate } from "../../src/modules/crm/crm.rollup";

/**
 * Paket N1 — takip altyapısı: `POST /api/v1/crm/collect|consent|attribution`, `GET /crm/config`,
 * `/admin/crm/settings`, günlük özet ve saklama temizliği. Gizlilik kuralları (onay, hariç yollar,
 * input değeri yok, metin ≤80, IP maskeleme, bot/hız, origin) burada doğrulanır.
 */
const ORIGIN = "http://localhost:3000";
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const DESKTOP_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

function id(prefix = "") {
  return (prefix + crypto.randomBytes(16).toString("base64url")).slice(0, 24);
}

interface EventInput {
  t: string;
  ts?: number;
  p: string;
  [key: string]: unknown;
}

function payload(vid: string, sid: string, events: EventInput[], extra: Record<string, unknown> = {}) {
  return {
    v: 1,
    vid,
    sid,
    cv: "2026-10-23",
    mk: false,
    ctx: { lang: "en-GB", tz: "Europe/London", rf: "https://www.google.com/" },
    events: events.map((e) => ({ ts: Date.now(), ...e })),
    ...extra,
  };
}

async function collect(app: FastifyInstance, body: unknown, opts: { origin?: string | null; ua?: string; ip?: string; asText?: boolean } = {}) {
  const headers: Record<string, string> = { "user-agent": opts.ua ?? UA, "content-type": opts.asText === false ? "application/json" : "text/plain;charset=UTF-8" };
  if (opts.origin !== null) headers.origin = opts.origin ?? ORIGIN;
  return app.inject({
    method: "POST",
    url: "/api/v1/crm/collect",
    headers,
    payload: JSON.stringify(body),
    remoteAddress: opts.ip ?? "203.0.113.57",
  });
}

async function enableTracking(app: FastifyInstance, patch: Partial<typeof DEFAULT_CRM_SETTINGS> = {}) {
  await writeCrmSettings(app.prisma, { ...DEFAULT_CRM_SETTINGS, trackingEnabled: true, ...patch }, null);
}

async function createUser(app: FastifyInstance, role: "ADMIN" | "MANAGER", twoFactor: boolean) {
  const { hashPassword } = await import("../../src/lib/password");
  const user = await app.prisma.user.create({
    data: {
      email: `crm-${role.toLowerCase()}-${crypto.randomUUID()}@example.com`,
      name: `CRM ${role}`,
      passwordHash: await hashPassword("Sifre12345!"),
      role,
      status: "ACTIVE",
      emailVerifiedAt: new Date(),
    },
  });
  const res = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email: user.email, password: "Sifre12345!" } });
  expect(res.statusCode).toBe(200);
  // Token alındıktan SONRA 2FA bayrağı açılır — `authenticate` her istekte bayrağı DB'den okur.
  if (twoFactor) await app.prisma.user.update({ where: { id: user.id }, data: { twoFactorEnabled: true } });
  return res.json().data.tokens.accessToken as string;
}

describe("CRM N1 — saf yardımcılar", () => {
  it("IP maskeleme: IPv4 /24, IPv6 /48", () => {
    expect(maskIp("203.0.113.57")).toBe("203.0.113.0");
    expect(maskIp("::ffff:198.51.100.9")).toBe("198.51.100.0");
    expect(maskIp("2001:db8:abcd:12:1:2:3:4")).toBe("2001:db8:abcd::");
    expect(maskIp("2001:db8::1")).toBe("2001:db8:0::");
    expect(maskIp(undefined)).toBeNull();
  });

  it("IP/CIDR listesi", () => {
    expect(ipMatchesList("203.0.113.57", ["203.0.113.0/24"])).toBe(true);
    expect(ipMatchesList("203.0.114.1", ["203.0.113.0/24"])).toBe(false);
    expect(ipMatchesList("10.0.0.5", ["10.0.0.5"])).toBe(true);
    expect(ipMatchesList("2001:db8:abcd:1::9", ["2001:db8:abcd::/48"])).toBe(true);
    expect(ipMatchesList("2001:db9::1", ["2001:db8::/32"])).toBe(false);
  });

  it("hariç yollar segment bazlı ve dil önekinden bağımsız", () => {
    for (const p of ["/admin", "/tr/patient/bookings/x", "/en/consultation/abc", "/checkout", "/en/checkout/success", "/hesabim", "/en/doctor", "/ar/doctor/patients", "/login", "/tr/cart"]) {
      expect(isExcludedPath(p), p).toBe(true);
    }
    for (const p of ["/", "/en/doctors", "/tr/doctors/vahit-mutlu", "/en/specialties/oncology", "/contact", "/en/blog/post"]) {
      expect(isExcludedPath(p), p).toBe(false);
    }
    expect(isExcludedPath("/en/kampanya-test/x", ["/kampanya-test"])).toBe(true);
    // Paket T — tireli dil öneki (`/sr-latn`) de soyulur; benzer ama geçersiz önek soyulmaz.
    for (const p of ["/sr-latn/patient/bookings/x", "/sr-latn/doctor", "/ro/checkout", "/fr/consultation/abc"]) expect(isExcludedPath(p), p).toBe(true);
    expect(isExcludedPath("/sr-latn/doctors/vahit-mutlu")).toBe(false);
  });

  it("bot UA, UA aileleri, metin temizleme, hedef temizleme", () => {
    expect(isBotUserAgent("Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)")).toBe(true);
    expect(isBotUserAgent("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/120.0 Safari/537.36")).toBe(true);
    expect(isBotUserAgent("")).toBe(true);
    expect(isBotUserAgent(UA)).toBe(false);
    expect(parseUserAgent(UA)).toEqual({ deviceType: "MOBILE", browser: "Safari", os: "iOS" });
    expect(parseUserAgent(DESKTOP_UA)).toEqual({ deviceType: "DESKTOP", browser: "Chrome", os: "Windows" });
    expect(sanitizeText("  a\u0000b\u202Ec\n\n d  ", 80)).toBe("a b c d");
    expect(sanitizeTarget("https://wa.me/905551112233?text=Merhaba%20ad%C4%B1m%20Ali")).toBe("wa.me/905551112233");
    expect(sanitizeTarget("tel:+905551112233")).toBe("tel:+905551112233");
    expect(sanitizeTarget("javascript:alert(1)")).toBeNull();
  });

  it("kaynak sınıflandırması", () => {
    const own = ["siteadi.localhost"];
    expect(classifySource({ utmSource: "Newsletter", utmMedium: "Email", utmCampaign: "Ekim", ownHosts: own })).toEqual({ source: "newsletter", medium: "email", campaign: "ekim" });
    expect(classifySource({ hasAdClickId: true, ownHosts: own })).toMatchObject({ source: "google", medium: "cpc" });
    expect(classifySource({ referrerHost: "www.google.com.tr", ownHosts: own })).toMatchObject({ source: "google", medium: "organic" });
    expect(classifySource({ referrerHost: "l.facebook.com", ownHosts: own })).toMatchObject({ source: "facebook", medium: "social" });
    expect(classifySource({ referrerHost: "blog.example.org", ownHosts: own })).toMatchObject({ source: "blog.example.org", medium: "referral" });
    expect(classifySource({ referrerHost: "siteadi.localhost", ownHosts: own })).toMatchObject({ source: "(direct)", medium: "(none)" });
  });

  it("sıcaklık puanı formülü ve üst sınırlar", () => {
    const w = DEFAULT_CRM_SETTINGS.scoreWeights;
    expect(computeVisitorScore({ engagedSeconds: 0, pageviewCount: 1, sessionCount: 1, reachedBooking: false, contactClicks: 0 }, w)).toBe(3);
    // 5 dk × 2 + 4 sayfa × 3 + 1 tekrar × 10 + randevu 20 + temas 25 = 77
    expect(computeVisitorScore({ engagedSeconds: 300, pageviewCount: 4, sessionCount: 2, reachedBooking: true, contactClicks: 1 }, w)).toBe(77);
    expect(computeVisitorScore({ engagedSeconds: 99999, pageviewCount: 999, sessionCount: 99, reachedBooking: true, contactClicks: 9 }, w)).toBe(100);
  });

  it("bozuk ayar JSON'u alan alan varsayılana düşer", () => {
    const parsed = parseCrmSettings({ trackingEnabled: "evet", retentionDays: 3, ipMode: "full", scoreWeights: { perPageview: 5, hotThreshold: 900 } });
    expect(parsed.trackingEnabled).toBe(false);
    expect(parsed.retentionDays).toBe(180);
    expect(parsed.ipMode).toBe("full");
    expect(parsed.scoreWeights.perPageview).toBe(5);
    expect(parsed.scoreWeights.hotThreshold).toBe(50);
  });
});

describe("CRM N1 — uçlar", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
    await resetDatabase(app.prisma);
  });

  beforeEach(async () => {
    resetFloodWindows();
    await app.prisma.crmVisitor.deleteMany();
    await app.prisma.crmConsent.deleteMany();
    await app.prisma.crmDailyRollup.deleteMany();
    await app.prisma.crmAttribution.deleteMany();
    await app.prisma.siteModule.deleteMany({ where: { key: "crm" } });
  });

  afterAll(async () => {
    await resetDatabase(app.prisma);
    await app.close();
  });

  it("config: takip varsayılan KAPALI; kapalıyken olay yazılmaz", async () => {
    const config = (await app.inject({ method: "GET", url: "/api/v1/crm/config" })).json().data;
    expect(config).toMatchObject({ trackingEnabled: false, whatsappRef: false, consentVersion: "2026-10-23", heartbeatSeconds: 15 });

    const res = await collect(app, payload(id(), id(), [{ t: "pageview", p: "/en" }]));
    expect(res.statusCode).toBe(204);
    expect(await app.prisma.crmEvent.count()).toBe(0);
  });

  it("origin yoksa ya da farklıysa 403; bozuk gövde 400; bilinmeyen alan 400", async () => {
    await enableTracking(app);
    const body = payload(id(), id(), [{ t: "pageview", p: "/en" }]);
    expect((await collect(app, body, { origin: null })).statusCode).toBe(403);
    expect((await collect(app, body, { origin: "https://evil.example" })).statusCode).toBe(403);
    expect(
      (
        await app.inject({ method: "POST", url: "/api/v1/crm/collect", headers: { origin: ORIGIN, "content-type": "text/plain", "user-agent": UA }, payload: "{bozuk" })
      ).statusCode
    ).toBe(400);
    expect((await collect(app, { ...body, extra: 1 })).statusCode).toBe(400);
    expect((await collect(app, payload(id(), id(), [{ t: "pageview", p: "/en", value: "gizli" }]))).statusCode).toBe(400);
    expect((await collect(app, payload(id(), id(), [{ t: "booking_completed", p: "/en" }]))).statusCode).toBe(400);
    // Yol yalnızca site-içi pathname: protokol-bağıl, ters eğik çizgili, javascript:/data: ve tam URL reddedilir.
    for (const p of ["//evil.com/x", "/\\evil.com/x", "javascript:alert(1)", "data:text/html,x", "https://evil.com/", "evil", "/a b"]) {
      expect((await collect(app, payload(id(), id(), [{ t: "pageview", p }]))).statusCode, p).toBe(400);
    }
    expect(await app.prisma.crmEvent.count()).toBe(0);
  });

  it("geçerli paket: maskeli IP, UA ailesi, kaynak, metin ≤80, hedefte sorgu yok, sayaçlar ve puan", async () => {
    await enableTracking(app);
    const vid = id("v");
    const sid = id("s");
    const longText = "Randevu al ".repeat(20);
    const res = await collect(
      app,
      payload(vid, sid, [
        { t: "pageview", p: "/en/doctors/vahit-mutlu?utm_source=x#top", ti: "Dr. <b>Vahit</b>" },
        { t: "heartbeat", p: "/en/doctors/vahit-mutlu" },
        { t: "heartbeat", p: "/en/doctors/vahit-mutlu" },
        { t: "click", p: "/en/doctors/vahit-mutlu", sel: "main > a.btn", tx: longText, hr: "/en/contact?name=Ali", x: 50, y: 20, ex: 10, ey: 90, vw: 390, vh: 844, dh: 3000 },
        { t: "whatsapp_click", p: "/en/doctors/vahit-mutlu", tx: "WhatsApp", hr: "https://wa.me/905551112233?text=Merhaba%20ben%20Ali" },
        { t: "booking_step", p: "/en/doctors/vahit-mutlu", st: 2 },
      ]),
      { ip: "203.0.113.57" }
    );
    expect(res.statusCode).toBe(204);

    const session = await app.prisma.crmSession.findUniqueOrThrow({ where: { id: sid } });
    expect(session).toMatchObject({
      ip: "203.0.113.0",
      deviceType: "MOBILE",
      browser: "Safari",
      os: "iOS",
      source: "google",
      medium: "organic",
      landingPath: "/en/doctors/vahit-mutlu",
      pageCount: 1,
      durationSeconds: 30,
      reachedDoctorPage: true,
      bookingStarted: true,
      contactClicked: true,
      gclid: null,
    });
    expect(session.ip).not.toBe("203.0.113.57");

    const events = await app.prisma.crmEvent.findMany({ where: { sessionId: sid }, orderBy: { id: "asc" } });
    const click = events.find((e) => e.type === "CLICK")!;
    expect(click.text!.length).toBeLessThanOrEqual(80);
    expect(click.target).toBe("/en/contact");
    expect(click.xPct).toBe(50);
    const wa = events.find((e) => e.type === "WHATSAPP_CLICK")!;
    expect(wa.target).toBe("wa.me/905551112233");
    expect(JSON.stringify(events.map((e) => ({ ...e, id: String(e.id) })))).not.toContain("Ali");
    expect(events.find((e) => e.type === "BOOKING_STEP")!.step).toBe(2);

    const visitor = await app.prisma.crmVisitor.findUniqueOrThrow({ where: { id: vid } });
    expect(visitor).toMatchObject({ sessionCount: 1, pageviewCount: 1, engagedSeconds: 30, contactClicks: 1, reachedBooking: true, firstSource: "google" });
    // 0 dk + 1 sayfa × 3 + randevu 20 + temas 25
    expect(visitor.score).toBe(48);
  });

  it("hariç tutulan yollarda (portal, consultation, checkout, admin) olay kaydedilmez", async () => {
    await enableTracking(app, { excludedPaths: ["/kampanya-test"] });
    const sid = id("s");
    const res = await collect(
      app,
      payload(id("v"), sid, [
        { t: "pageview", p: "/tr/patient/bookings/123" },
        { t: "pageview", p: "/en/consultation/abc" },
        { t: "click", p: "/tr/checkout", tx: "Öde" },
        { t: "pageview", p: "/admin/crm" },
        { t: "pageview", p: "/tr/kampanya-test" },
        { t: "pageview", p: "/tr/hesabim/profil" },
        { t: "pageview", p: "/en//admin/x" },
        { t: "pageview", p: "/en/consultation//x" },
      ])
    );
    expect(res.statusCode).toBe(204);
    expect(await app.prisma.crmEvent.count()).toBe(0);
    expect(await app.prisma.crmSession.count()).toBe(0);

    await collect(app, payload(id("v"), id("s"), [{ t: "pageview", p: "/tr/checkout" }, { t: "pageview", p: "/tr/doctors" }]));
    const paths = (await app.prisma.crmEvent.findMany({ select: { path: true } })).map((e) => e.path);
    expect(paths).toEqual(["/tr/doctors"]);
  });

  it("bot UA, hariç IP ve aşırı olay hızı elenir; hız aşan oturum işaretlenir", async () => {
    await enableTracking(app, { excludedIps: ["198.51.100.0/24"] });
    await collect(app, payload(id(), id(), [{ t: "pageview", p: "/en" }]), { ua: "Googlebot/2.1 (+http://www.google.com/bot.html)" });
    await collect(app, payload(id(), id(), [{ t: "pageview", p: "/en" }]), { ip: "198.51.100.23" });
    expect(await app.prisma.crmEvent.count()).toBe(0);

    const vid = id("v");
    const sid = id("s");
    const burst = Array.from({ length: 50 }, () => ({ t: "click", p: "/en", sel: "div" }));
    await collect(app, payload(vid, sid, burst));
    expect(await app.prisma.crmEvent.count()).toBe(50);
    await collect(app, payload(vid, sid, burst.slice(0, CRM_FLOOD_MAX_EVENTS - 40)));
    expect(await app.prisma.crmEvent.count()).toBe(50);
    expect((await app.prisma.crmSession.findUniqueOrThrow({ where: { id: sid } })).botFlagged).toBe(true);
  });

  it("IP 'full' modunda tam IP; pazarlama onayıyla gclid saklanır, onaysız saklanmaz", async () => {
    await enableTracking(app, { ipMode: "full" });
    const withMk = id("s");
    await collect(app, payload(id("v"), withMk, [{ t: "pageview", p: "/en" }], { mk: true, ctx: { gclid: "Cj0KCQ-abc" } }), { ip: "203.0.113.57" });
    const noMk = id("s");
    await collect(app, payload(id("v"), noMk, [{ t: "pageview", p: "/en" }], { mk: false, ctx: { gclid: "Cj0KCQ-xyz" } }));
    const a = await app.prisma.crmSession.findUniqueOrThrow({ where: { id: withMk } });
    const b = await app.prisma.crmSession.findUniqueOrThrow({ where: { id: noMk } });
    expect(a).toMatchObject({ ip: "203.0.113.57", gclid: "Cj0KCQ-abc", source: "google", medium: "cpc" });
    expect(b).toMatchObject({ gclid: null, source: "(direct)" });
  });

  it("başka ziyaretçinin oturum kimliğiyle olay yazılamaz", async () => {
    await enableTracking(app);
    const sid = id("s");
    await collect(app, payload(id("v"), sid, [{ t: "pageview", p: "/en" }]));
    await collect(app, payload(id("v"), sid, [{ t: "pageview", p: "/en/x" }]));
    expect(await app.prisma.crmEvent.count({ where: { sessionId: sid } })).toBe(1);
  });

  it("onay kaydı: reddetme de kaydedilir, ziyaretçi kimliği yazılmaz; geri almada ziyaret verisi silinir", async () => {
    await enableTracking(app);
    const vid = id("v");
    await collect(app, payload(vid, id("s"), [{ t: "pageview", p: "/en" }]));
    const consent = (body: Record<string, unknown>) =>
      app.inject({ method: "POST", url: "/api/v1/crm/consent", headers: { origin: ORIGIN, "content-type": "text/plain" }, payload: JSON.stringify(body) });

    expect((await consent({ cid: id("c"), vid, v: "2026-10-23", a: false, m: false, act: "REJECT_ALL", l: "tr" })).statusCode).toBe(204);
    const rows = await app.prisma.crmConsent.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ analytics: false, marketing: false, action: "REJECT_ALL", visitorId: null });

    // Pazarlama onayı geri alınınca (analitik açık kalır) reklam tıklama kimlikleri silinir.
    const mkVid = id("v");
    const mkSid = id("s");
    await collect(app, payload(mkVid, mkSid, [{ t: "pageview", p: "/en" }], { mk: true, ctx: { gclid: "Cj0KCQ-mk" } }));
    expect((await app.prisma.crmSession.findUniqueOrThrow({ where: { id: mkSid } })).gclid).toBe("Cj0KCQ-mk");
    expect((await consent({ cid: id("c"), vid: mkVid, v: "2026-10-23", a: true, m: false, act: "CUSTOM" })).statusCode).toBe(204);
    expect((await app.prisma.crmSession.findUniqueOrThrow({ where: { id: mkSid } })).gclid).toBeNull();
    expect(await app.prisma.crmVisitor.count({ where: { id: mkVid } })).toBe(1);
    expect(await app.prisma.crmVisitor.count({ where: { id: vid } })).toBe(0);
    expect(await app.prisma.crmEvent.count({ where: { visitorId: vid } })).toBe(0);

    expect((await consent({ cid: id("c"), v: "x", a: true, m: true, act: "OOPS" })).statusCode).toBe(400);
    expect(
      (await app.inject({ method: "POST", url: "/api/v1/crm/consent", headers: { "content-type": "text/plain" }, payload: JSON.stringify({ cid: id("c"), v: "x", a: true, m: true, act: "ACCEPT_ALL" }) })).statusCode
    ).toBe(403);
  });

  it("randevu atfı: token doğrulanır, oturum düzeyinde anlık görüntü yazılır, ziyaretçi kimliği yazılmaz", async () => {
    await enableTracking(app);
    const doctor = await app.prisma.doctorProfile.create({
      data: { title: "Dr.", fullName: "Test Doktor", slug: `doc-${crypto.randomUUID()}`, bio: "Test", languages: ["tr"], sessionPriceCents: 10000, currency: "EUR", isActive: true },
    });
    const token = crypto.randomBytes(24).toString("hex");
    const booking = await app.prisma.appointmentBooking.create({
      data: {
        bookingNumber: `B-${Date.now()}`,
        doctorId: doctor.id,
        patientName: "Hasta",
        patientEmail: "hasta@example.com",
        slotCount: 1,
        unitPriceCents: 10000,
        subtotalCents: 10000,
        totalCents: 10000,
        expiresAt: new Date(Date.now() + 30 * 60_000),
        meetingRoomName: `room_${crypto.randomBytes(16).toString("hex")}`,
        accessTokenHash: hashToken(token),
        consentAt: new Date(),
        consentVersion: "v1",
      },
    });
    const vid = id("v");
    const sid = id("s");
    await collect(app, payload(vid, sid, [{ t: "pageview", p: "/en/doctors/x" }], { mk: true, ctx: { us: "newsletter", um: "email", uc: "ekim", gclid: "G-1" } }));

    const attribute = (body: Record<string, unknown>) =>
      app.inject({ method: "POST", url: "/api/v1/crm/attribution", headers: { origin: ORIGIN, "content-type": "text/plain", "user-agent": UA }, payload: JSON.stringify(body) });

    expect((await attribute({ bookingId: booking.id, token: "yanlis-token-1234567890", sid, vid })).statusCode).toBe(204);
    expect(await app.prisma.crmAttribution.count()).toBe(0);

    expect((await attribute({ bookingId: booking.id, token, sid, vid })).statusCode).toBe(204);
    expect((await attribute({ bookingId: booking.id, token, sid, vid })).statusCode).toBe(204);
    const rows = await app.prisma.crmAttribution.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ bookingId: booking.id, lastSource: "newsletter", lastMedium: "email", lastCampaign: "ekim", firstSource: "newsletter", landingPath: "/en/doctors/x", gclid: "G-1" });
    expect(JSON.stringify(rows[0])).not.toContain(vid);
    expect(JSON.stringify(rows[0])).not.toContain(sid);
    expect(await app.prisma.crmEvent.count({ where: { type: "BOOKING_COMPLETED", sessionId: sid } })).toBe(1);
  });

  it("günlük özet doğru hesaplanır (total/page/source/prePage/click) ve idempotenttir", async () => {
    await enableTracking(app);
    const today = istanbulDate();
    const v1 = id("v");
    const v2 = id("v");
    await collect(app, payload(v1, id("s"), [
      { t: "pageview", p: "/en" },
      { t: "pageview", p: "/en/doctors/a" },
      { t: "heartbeat", p: "/en/doctors/a" },
      { t: "scroll", p: "/en/doctors/a", sc: 80 },
      { t: "phone_click", p: "/en/doctors/a", tx: "Ara", hr: "tel:+905551112233" },
    ]));
    await collect(app, payload(v2, id("s"), [
      { t: "pageview", p: "/en/doctors/a" },
      { t: "scroll", p: "/en/doctors/a", sc: 40 },
      { t: "click", p: "/en/doctors/a", sel: "button.cta", tx: "Randevu" },
    ]), { ua: DESKTOP_UA });

    await runCrmRollupForDate(app, today);
    const second = await runCrmRollupForDate(app, today);
    const rows = await app.prisma.crmDailyRollup.findMany();
    expect(rows.length).toBe(second);

    const get = (dimension: string, key: string) => rows.find((r) => r.dimension === dimension && r.key === key)!;
    expect(get("total", "")).toMatchObject({ visitors: 2, sessions: 2, pageviews: 3, entries: 2, engagedSeconds: 15, phoneClicks: 1, contacts: 1, clicks: 1 });
    expect(get("page", "/en/physicians/a")).toMatchObject({ visitors: 2, pageviews: 2, entries: 1, scrollSum: 120, scrollCount: 2, contacts: 1 });
    expect(get("page", "/en")).toMatchObject({ pageviews: 1, entries: 1 });
    expect(get("source", "google|organic|")).toMatchObject({ sessions: 2, entries: 2 });
    expect(get("doctor", "a")).toMatchObject({ visitors: 2, pageviews: 2 });
    expect(get("device", "MOBILE")).toMatchObject({ visitors: 1 });
    expect(get("country", "UNKNOWN")).toMatchObject({ sessions: 2 });
    expect(rows.filter((r) => r.dimension === "prePage").map((r) => r.key).sort()).toEqual(["/en", "/en/physicians/a"]);
    const clickRows = rows.filter((r) => r.dimension === "click");
    expect(clickRows).toHaveLength(2);
    expect(clickRows.map((r) => JSON.parse(r.label!).text).sort()).toEqual(["Ara", "Randevu"]);
  });

  it("uzun kaynak/ortam/kampanya değerleri günlük özet anahtarında çakışma üretmez", async () => {
    await enableTracking(app);
    const long = (c: string) => c.repeat(150);
    await collect(app, payload(id("v"), id("s"), [{ t: "pageview", p: "/en" }], { ctx: { us: long("a"), um: long("b"), uc: `${long("c").slice(0, 149)}1` } }));
    await collect(app, payload(id("v"), id("s"), [{ t: "pageview", p: "/en" }], { ctx: { us: long("a"), um: long("b"), uc: `${long("c").slice(0, 149)}2` } }));
    await expect(runCrmRollupForDate(app, istanbulDate())).resolves.toBeGreaterThan(0);
    const sources = await app.prisma.crmDailyRollup.findMany({ where: { dimension: "source" } });
    expect(sources).toHaveLength(1);
    expect(sources[0]!.sessions).toBe(2);
  });

  it("reklam tıklama kimlikleri 90 gün sonra boşaltılır", async () => {
    await enableTracking(app);
    const sid = id("s");
    await collect(app, payload(id("v"), sid, [{ t: "pageview", p: "/en" }], { mk: true, ctx: { gclid: "Cj0KCQ-old" } }));
    await app.prisma.crmSession.update({ where: { id: sid }, data: { startedAt: new Date(Date.now() - 100 * 86_400_000) } });
    await app.prisma.crmAttribution.create({ data: { bookingId: crypto.randomUUID(), lastSource: "google", lastMedium: "cpc", gclid: "Cj0KCQ-attr", createdAt: new Date(Date.now() - 100 * 86_400_000) } });
    await runCrmRetentionSweep(app);
    expect((await app.prisma.crmSession.findUniqueOrThrow({ where: { id: sid } })).gclid).toBeNull();
    expect((await app.prisma.crmAttribution.findFirstOrThrow()).gclid).toBeNull();
  });

  it("saklama süresi temizliği eski ziyaret/oturum/olayları siler, yenilere dokunmaz", async () => {
    await enableTracking(app, { retentionDays: 30 });
    const oldVid = id("v");
    await collect(app, payload(oldVid, id("s"), [{ t: "pageview", p: "/en" }]));
    const freshVid = id("v");
    await collect(app, payload(freshVid, id("s"), [{ t: "pageview", p: "/en" }]));
    const past = new Date(Date.now() - 40 * 86_400_000);
    await app.prisma.crmVisitor.update({ where: { id: oldVid }, data: { lastSeenAt: past } });
    await app.prisma.crmDailyRollup.create({ data: { date: new Date(Date.now() - 800 * 86_400_000), dimension: "total", key: "" } });

    const result = await runCrmRetentionSweep(app);
    expect(result.deletedVisitors).toBe(1);
    expect(result.deletedRollups).toBe(1);
    expect(await app.prisma.crmVisitor.count()).toBe(1);
    expect(await app.prisma.crmEvent.count()).toBe(1);
    expect(shiftDate("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("admin ayarları: yalnızca ADMIN + 2FA; MANAGER ve 2FA'sız ADMIN 403; audit yazılır", async () => {
    const admin2fa = await createUser(app, "ADMIN", true);
    const adminNo2fa = await createUser(app, "ADMIN", false);
    const manager = await createUser(app, "MANAGER", true);
    const auth = (token: string) => ({ authorization: `Bearer ${token}` });

    expect((await app.inject({ method: "GET", url: "/api/v1/admin/crm/settings" })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/api/v1/admin/crm/settings", headers: auth(manager) })).statusCode).toBe(403);
    const no2fa = await app.inject({ method: "GET", url: "/api/v1/admin/crm/settings", headers: auth(adminNo2fa) });
    expect(no2fa.statusCode).toBe(403);
    expect(no2fa.json().error.code).toBe("TWO_FACTOR_REQUIRED");

    const get = await app.inject({ method: "GET", url: "/api/v1/admin/crm/settings", headers: auth(admin2fa) });
    expect(get.statusCode).toBe(200);
    expect(get.json().data).toMatchObject({ trackingEnabled: false, ipMode: "masked", retentionDays: 180, leadRetentionDays: 730 });
    expect(JSON.stringify(get.json().data)).not.toContain("credentialsCiphertext");

    const bad = await app.inject({ method: "PATCH", url: "/api/v1/admin/crm/settings", headers: auth(admin2fa), payload: { excludedIps: ["not-an-ip"] } });
    expect(bad.statusCode).toBe(422);
    expect((await app.inject({ method: "PATCH", url: "/api/v1/admin/crm/settings", headers: auth(admin2fa), payload: { searchConsole: {} } })).statusCode).toBe(422);

    const patch = await app.inject({
      method: "PATCH",
      url: "/api/v1/admin/crm/settings",
      headers: auth(admin2fa),
      payload: { trackingEnabled: true, excludedIps: ["203.0.113.0/24"], scoreWeights: { hotThreshold: 60 } },
    });
    expect(patch.statusCode).toBe(200);
    expect(patch.json().data).toMatchObject({ trackingEnabled: true, excludedIps: ["203.0.113.0/24"], scoreWeights: { hotThreshold: 60, perPageview: 3 } });
    expect(await app.prisma.auditLog.count({ where: { action: "crm.settings.update" } })).toBe(1);
    expect((await app.inject({ method: "GET", url: "/api/v1/crm/config" })).json().data.trackingEnabled).toBe(true);
  });
});
