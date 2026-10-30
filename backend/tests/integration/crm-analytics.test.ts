import crypto from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestApp } from "../helpers/build-test-app";
import { resetDatabase } from "../helpers/reset-db";
import { DEFAULT_CRM_SETTINGS, writeCrmSettings } from "../../src/modules/crm/crm.settings";
import { resetFloodWindows } from "../../src/modules/crm/crm.collect";
import { istanbulDate, runCrmRollupForDate } from "../../src/modules/crm/crm.rollup";

/**
 * Paket N3 — analitik ekranlarının uçları: genel bakış, şu an sitede, ziyaretçiler (+detay audit'i),
 * sayfa haritası, kaynaklar, ülke/dil/doktor ilgisi, tıklamalar ve ısı haritası (mobil/masaüstü ayrı;
 * öfkeli/ölü tıklama; kaydırma haritası; "tıklanabilir sanılan" öğeler).
 */
const ORIGIN = "http://localhost:3000";
const MOBILE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const DESKTOP = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

const cid = () => crypto.randomBytes(16).toString("base64url").slice(0, 22);

async function collect(app: FastifyInstance, vid: string, sid: string, events: Record<string, unknown>[], opts: { ua?: string; ctx?: Record<string, string>; ref?: string } = {}) {
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/crm/collect",
    headers: { origin: ORIGIN, "content-type": "text/plain", "user-agent": opts.ua ?? DESKTOP },
    payload: JSON.stringify({ v: 1, vid, sid, cv: "2026-10-23", mk: false, ...(opts.ref ? { ref: opts.ref } : {}), ctx: opts.ctx ?? {}, events: events.map((e) => ({ ts: Date.now(), ...e })) }),
  });
  expect(res.statusCode).toBe(204);
}

describe("CRM N3 — analitik", () => {
  let app: FastifyInstance;
  let token: string;
  const today = istanbulDate();
  const get = (url: string) => app.inject({ method: "GET", url: `/api/v1/admin/crm${url}`, headers: { authorization: `Bearer ${token}` } });

  const hot = cid();
  const cold = cid();

  beforeAll(async () => {
    app = await buildTestApp();
    await resetDatabase(app.prisma);
    const { hashPassword } = await import("../../src/lib/password");
    const user = await app.prisma.user.create({
      data: { email: `crm-an-${crypto.randomUUID()}@example.com`, name: "Analitik", passwordHash: await hashPassword("Sifre12345!"), role: "ADMIN", status: "ACTIVE", emailVerifiedAt: new Date() },
    });
    token = (await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email: user.email, password: "Sifre12345!" } })).json().data.tokens.accessToken;
    await app.prisma.user.update({ where: { id: user.id }, data: { twoFactorEnabled: true } });
    await app.prisma.doctorProfile.create({
      data: { title: "Prof. Dr.", fullName: "Analiz Hekim", slug: "analiz-hekim", bio: "x", languages: ["tr"], sessionPriceCents: 1, currency: "EUR", isActive: true },
    });
  });

  beforeEach(async () => {
    resetFloodWindows();
    await app.prisma.crmVisitor.deleteMany();
    await app.prisma.crmDailyRollup.deleteMany();
    await app.prisma.crmLead.deleteMany();
    await app.prisma.auditLog.deleteMany();
    await writeCrmSettings(app.prisma, { ...DEFAULT_CRM_SETTINGS, trackingEnabled: true }, null);

    // Sıcak ziyaretçi (masaüstü, Almanca, Google'dan): doktor sayfası, okuma, WhatsApp, sihirbaz
    await collect(
      app,
      hot,
      cid(),
      [
        { t: "pageview", p: "/de", ti: "Startseite" },
        { t: "pageview", p: "/de/doctors/analiz-hekim", ti: "Prof. Dr. Analiz Hekim" },
        ...Array.from({ length: 8 }, () => ({ t: "heartbeat", p: "/de/doctors/analiz-hekim" })),
        { t: "scroll", p: "/de/doctors/analiz-hekim", sc: 90 },
        { t: "click", p: "/de/doctors/analiz-hekim", sel: "main>img", x: 30, y: 10, ex: 50, ey: 50, dd: true },
        { t: "click", p: "/de/doctors/analiz-hekim", sel: "main>img", x: 31, y: 10, dd: true, rg: true },
        { t: "whatsapp_click", p: "/de/doctors/analiz-hekim", sel: "a.wa", tx: "WhatsApp", hr: "https://wa.me/90", x: 80, y: 50 },
        { t: "booking_step", p: "/de/doctors/analiz-hekim", st: 2 },
      ],
      { ctx: { lang: "de-DE", tz: "Europe/Berlin", rf: "https://www.google.de/" }, ref: "HXT234" }
    );
    // Soğuk ziyaretçi (mobil, doğrudan): yalnızca doktor sayfası
    await collect(app, cold, cid(), [
      { t: "pageview", p: "/de/doctors/analiz-hekim" },
      { t: "scroll", p: "/de/doctors/analiz-hekim", sc: 30 },
      { t: "click", p: "/de/doctors/analiz-hekim", sel: "button.cta", tx: "Termin", x: 50, y: 40 },
    ], { ua: MOBILE, ctx: { lang: "en-US" } });
    await app.prisma.crmLead.create({ data: { channel: "CONTACT_FORM", name: "Talep Bir" } });
    await runCrmRollupForDate(app, today);
  });

  afterAll(async () => {
    await resetDatabase(app.prisma);
    await app.close();
  });

  it("genel bakış: KPI'lar, kaynaklar, temas/giriş/temas-öncesi sayfalar, sıcak ziyaretçiler, en çok tıklananlar", async () => {
    const res = await get(`/analytics/overview?from=${today}&to=${today}`);
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data.kpis).toMatchObject({ liveNow: 2, visitors: 2, pageviews: 3, whatsappClicks: 1, phoneClicks: 0, leads: 1, conversionRate: 50 });
    expect(data.sources.map((s: { source: string; medium: string }) => `${s.source}/${s.medium}`).sort()).toEqual(["(direct)/(none)", "google/organic"]);
    expect(data.contactPages[0]).toMatchObject({ path: "/de/physicians/analiz-hekim", contacts: 1 });
    expect(data.entryPages.map((p: { path: string }) => p.path).sort()).toEqual(["/de", "/de/physicians/analiz-hekim"]);
    expect(data.prePages.map((p: { path: string }) => p.path).sort()).toEqual(["/de", "/de/physicians/analiz-hekim"]);
    expect(data.hotVisitors.map((v: { id: string }) => v.id)).toEqual([hot]);
    expect(data.topClicks.find((c: { text: string | null }) => c.text === "WhatsApp")).toMatchObject({ target: "wa.me/90", contacts: 1 });
    expect(data.series).toEqual([expect.objectContaining({ date: today, visitors: 2, pageviews: 3, contacts: 1 })]);
    expect(data.recentLeads[0]).toMatchObject({ name: "Talep Bir" });
  });

  it("şu an sitede: yalnızca son 75 sn içinde sinyal gönderenler", async () => {
    await app.prisma.crmSession.updateMany({ where: { visitorId: cold }, data: { lastSeenAt: new Date(Date.now() - 5 * 60_000) } });
    const live = (await get("/analytics/live")).json().data;
    expect(live).toHaveLength(1);
    expect(live[0]).toMatchObject({ visitorId: hot, currentPath: "/de/doctors/analiz-hekim", deviceType: "DESKTOP", source: "google", refCode: "HXT234" });
  });

  it("ziyaretçiler: Ref koduyla arama, sıcak filtresi; detay zaman çizelgesi (heartbeat yok) ve audit", async () => {
    const byRef = (await get("/visitors?q=Ref:%20hxt234")).json();
    expect(byRef.data.map((v: { id: string }) => v.id)).toEqual([hot]);
    const hotOnly = (await get("/visitors?hot=true")).json();
    expect(hotOnly.data.map((v: { id: string }) => v.id)).toEqual([hot]);
    expect(hotOnly.data[0].score).toBeGreaterThanOrEqual(hotOnly.meta.hotThreshold);

    const detail = await get(`/visitors/${hot}`);
    expect(detail.statusCode).toBe(200);
    const data = detail.json().data;
    expect(data.sessions).toHaveLength(1);
    expect(data.sessions[0]).toMatchObject({ source: "google", medium: "organic", bookingStarted: true });
    expect(data.events.some((e: { type: string }) => e.type === "HEARTBEAT")).toBe(false);
    expect(data.events.map((e: { type: string }) => e.type)).toContain("WHATSAPP_CLICK");
    expect(await app.prisma.auditLog.count({ where: { action: "crm.visitor.viewed", targetId: hot } })).toBe(1);
    expect((await get(`/visitors/${cid()}`)).statusCode).toBe(404);
  });

  it("sayfa haritası: ortalama okuma süresi, kaydırma derinliği, giriş, temas", async () => {
    const pages = (await get(`/analytics/pages?from=${today}&to=${today}`)).json().data;
    const doctor = pages.find((p: { path: string }) => p.path === "/de/physicians/analiz-hekim");
    expect(doctor).toMatchObject({ pageviews: 2, visitors: 2, entries: 1, contacts: 1, avgEngagedSeconds: 60, avgScrollPct: 60 });
  });

  it("kitle: dil, saat dilimi, cihaz; doktor ilgisi adıyla", async () => {
    const data = (await get(`/analytics/audience?from=${today}&to=${today}`)).json().data;
    expect(data.languages.map((l: { key: string }) => l.key).sort()).toEqual(["de", "en"]);
    expect(data.timezones.find((t: { key: string }) => t.key === "Europe/Berlin")).toMatchObject({ visitors: 1 });
    expect(data.devices.map((d: { key: string }) => d.key).sort()).toEqual(["DESKTOP", "MOBILE"]);
    expect(data.doctors[0]).toMatchObject({ key: "analiz-hekim", label: "Prof. Dr. Analiz Hekim", visitors: 2, contacts: 1, bookingsStarted: 1 });
  });

  it("tıklamalar: öğe, konum, hedef; yola göre filtre", async () => {
    const all = (await get(`/analytics/clicks?from=${today}&to=${today}`)).json().data;
    expect(all.find((c: { text: string | null }) => c.text === "Termin")).toMatchObject({ selector: "button.cta", clicks: 1 });
    const none = (await get(`/analytics/clicks?from=${today}&to=${today}&path=/de`)).json().data;
    expect(none).toEqual([]);
  });

  it("ısı haritası: mobil/masaüstü ayrı, öfkeli/ölü tıklama, kaydırma, tıklanabilir sanılan öğeler", async () => {
    const desktop = (await get(`/analytics/heatmap?from=${today}&to=${today}&path=/de/doctors/analiz-hekim&device=desktop`)).json().data;
    expect(desktop).toMatchObject({ pageviews: 1, clickCount: 3, rageClicks: 1, deadClicks: 2, scrollSamples: 1 });
    expect(desktop.points[0]).toHaveProperty("x");
    expect(desktop.likelyClickable).toEqual([expect.objectContaining({ selector: "main>img", count: 2 })]);
    expect(desktop.scrollReach.find((b: { depth: number }) => b.depth === 90).pct).toBe(100);
    expect(desktop.scrollReach.find((b: { depth: number }) => b.depth === 100).pct).toBe(0);

    const mobile = (await get(`/analytics/heatmap?from=${today}&to=${today}&path=/de/doctors/analiz-hekim&device=mobile`)).json().data;
    expect(mobile).toMatchObject({ pageviews: 1, clickCount: 1, rageClicks: 0, deadClicks: 0 });
    expect(mobile.scrollReach.find((b: { depth: number }) => b.depth === 30).pct).toBe(100);

    const pages = (await get(`/analytics/heatmap/pages?from=${today}&to=${today}`)).json().data;
    expect(pages[0]).toMatchObject({ path: "/de/physicians/analiz-hekim", pageviews: 2 });
    expect((await get(`/analytics/heatmap?from=${today}&to=${today}`)).statusCode).toBe(422);
  });

  it("geçersiz aralık 422", async () => {
    expect((await get(`/analytics/overview?from=2026-10-23&to=2026-10-01`)).statusCode).toBe(422);
    expect((await get(`/analytics/sources?from=bozuk&to=2026-10-01`)).statusCode).toBe(422);
  });
});
