import type { FastifyInstance } from "fastify";
import type { DeviceType, Prisma } from "@prisma/client";
import { z } from "zod";
import { readCrmSettings } from "./crm.settings";
import { istanbulDayRange } from "./crm.rollup";

/**
 * Paket N3 — CRM analitik sorguları. Panel tabloları `crm_daily_rollups`'tan okunur; yalnızca "şu an
 * sitede", ziyaretçi detayı ve ısı haritası ham tablolardan (`crm_sessions` / `crm_events`) okur.
 * Ziyaretçi sayısı (tekil) aralık için `crm_sessions` üzerinden hesaplanır (günlük tekillerin toplamı
 * aralık tekilini vermez); sayfa/kaynak tablolarındaki "kişi" sütunu günlük tekillerin toplamıdır.
 */
export const RangeQuerySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export type RangeQuery = z.infer<typeof RangeQuerySchema>;

/** "Şu an sitede": son 75 sn'de sinyal (heartbeat 15 sn) gönderen oturumlar. */
export const CRM_LIVE_WINDOW_MS = 75_000;

function rangeBounds(range: RangeQuery) {
  const start = istanbulDayRange(range.from).start;
  const end = istanbulDayRange(range.to).end;
  return { start, end, fromDate: new Date(`${range.from}T00:00:00.000Z`), toDate: new Date(`${range.to}T00:00:00.000Z`) };
}

type RollupSum = {
  key: string;
  label: string | null;
  visitors: number;
  sessions: number;
  pageviews: number;
  entries: number;
  engagedSeconds: number;
  scrollSum: number;
  scrollCount: number;
  clicks: number;
  whatsappClicks: number;
  phoneClicks: number;
  emailClicks: number;
  contacts: number;
  bookingsStarted: number;
};

/** Bir boyutun aralık toplamı (gün satırları anahtara göre toplanır). */
export async function sumRollup(
  app: FastifyInstance,
  dimension: string,
  range: RangeQuery,
  options: { orderBy?: keyof Omit<RollupSum, "key" | "label">; take?: number; where?: Prisma.CrmDailyRollupWhereInput } = {}
): Promise<RollupSum[]> {
  const { fromDate, toDate } = rangeBounds(range);
  const orderBy = options.orderBy ?? "pageviews";
  const grouped = await app.prisma.crmDailyRollup.groupBy({
    by: ["key"],
    where: { dimension, date: { gte: fromDate, lte: toDate }, ...(options.where ?? {}) },
    _sum: {
      visitors: true,
      sessions: true,
      pageviews: true,
      entries: true,
      engagedSeconds: true,
      scrollSum: true,
      scrollCount: true,
      clicks: true,
      whatsappClicks: true,
      phoneClicks: true,
      emailClicks: true,
      contacts: true,
      bookingsStarted: true,
    },
    _max: { label: true },
    orderBy: { _sum: { [orderBy]: "desc" } },
    ...(options.take ? { take: options.take } : {}),
  });
  return grouped.map((g) => ({
    key: g.key,
    label: g._max.label,
    visitors: g._sum.visitors ?? 0,
    sessions: g._sum.sessions ?? 0,
    pageviews: g._sum.pageviews ?? 0,
    entries: g._sum.entries ?? 0,
    engagedSeconds: g._sum.engagedSeconds ?? 0,
    scrollSum: g._sum.scrollSum ?? 0,
    scrollCount: g._sum.scrollCount ?? 0,
    clicks: g._sum.clicks ?? 0,
    whatsappClicks: g._sum.whatsappClicks ?? 0,
    phoneClicks: g._sum.phoneClicks ?? 0,
    emailClicks: g._sum.emailClicks ?? 0,
    contacts: g._sum.contacts ?? 0,
    bookingsStarted: g._sum.bookingsStarted ?? 0,
  }));
}

export function toPageRow(r: RollupSum) {
  return {
    path: r.key,
    pageviews: r.pageviews,
    visitors: r.visitors,
    entries: r.entries,
    contacts: r.contacts,
    clicks: r.clicks,
    avgEngagedSeconds: r.pageviews > 0 ? Math.round(r.engagedSeconds / r.pageviews) : 0,
    avgScrollPct: r.scrollCount > 0 ? Math.round(r.scrollSum / r.scrollCount) : null,
  };
}

function splitSource(key: string) {
  const [source = "", medium = "", campaign = ""] = key.split("|");
  return { source, medium, campaign: campaign || null };
}

function parseClickLabel(label: string | null) {
  try {
    const parsed = JSON.parse(label ?? "{}") as { path?: string; selector?: string | null; text?: string | null; target?: string | null };
    return { path: parsed.path ?? "", selector: parsed.selector ?? null, text: parsed.text ?? null, target: parsed.target ?? null };
  } catch {
    return { path: "", selector: null, text: null, target: null };
  }
}

export async function countLive(app: FastifyInstance, now = new Date()): Promise<number> {
  return app.prisma.crmSession.count({ where: { botFlagged: false, lastSeenAt: { gte: new Date(now.getTime() - CRM_LIVE_WINDOW_MS) } } });
}

export async function overview(app: FastifyInstance, range: RangeQuery) {
  const { start, end, fromDate, toDate } = rangeBounds(range);
  const settings = await readCrmSettings(app.prisma);
  const [liveNow, visitorRows, totals, daily, sources, pages, prePages, clicks, recentLeads, leadCount, hotVisitors] = await Promise.all([
    countLive(app),
    app.prisma.$queryRaw<{ n: number }[]>`
      SELECT COUNT(DISTINCT "visitorId")::int AS n FROM "crm_sessions"
      WHERE NOT "botFlagged" AND "lastSeenAt" >= ${start} AND "startedAt" < ${end}`,
    sumRollup(app, "total", range),
    app.prisma.crmDailyRollup.findMany({ where: { dimension: "total", date: { gte: fromDate, lte: toDate } }, orderBy: { date: "asc" } }),
    sumRollup(app, "source", range, { orderBy: "sessions", take: 10 }),
    sumRollup(app, "page", range, { orderBy: "pageviews" }),
    sumRollup(app, "prePage", range, { orderBy: "sessions", take: 10 }),
    sumRollup(app, "click", range, { orderBy: "clicks", take: 10 }),
    app.prisma.crmLead.findMany({ where: { candidate: false }, orderBy: { createdAt: "desc" }, take: 8 }),
    app.prisma.crmLead.count({ where: { candidate: false, createdAt: { gte: start, lt: end } } }),
    app.prisma.crmVisitor.findMany({
      where: { botFlagged: false, score: { gte: settings.scoreWeights.hotThreshold }, lastSeenAt: { gte: start, lt: end } },
      orderBy: [{ score: "desc" }, { lastSeenAt: "desc" }],
      take: 10,
    }),
  ]);
  const total = totals[0];
  const visitors = visitorRows[0]?.n ?? 0;
  return {
    kpis: {
      liveNow,
      visitors,
      pageviews: total?.pageviews ?? 0,
      whatsappClicks: total?.whatsappClicks ?? 0,
      phoneClicks: total?.phoneClicks ?? 0,
      emailClicks: total?.emailClicks ?? 0,
      leads: leadCount,
      conversionRate: visitors > 0 ? Math.round((leadCount / visitors) * 10_000) / 100 : 0,
    },
    series: daily.map((d) => ({ date: d.date.toISOString().slice(0, 10), visitors: d.visitors, pageviews: d.pageviews, contacts: d.contacts })),
    sources: sources.map((s) => ({ ...splitSource(s.key), sessions: s.sessions, visitors: s.visitors, contacts: s.contacts, bookingsStarted: s.bookingsStarted })),
    contactPages: pages.filter((p) => p.contacts > 0).sort((a, b) => b.contacts - a.contacts).slice(0, 10).map(toPageRow),
    entryPages: pages.filter((p) => p.entries > 0).sort((a, b) => b.entries - a.entries).slice(0, 10).map(toPageRow),
    prePages: prePages.map((p) => ({ path: p.key, sessions: p.sessions, visitors: p.visitors })),
    topClicks: clicks.map((c) => ({ ...parseClickLabel(c.label), clicks: c.clicks, contacts: c.contacts, visitors: c.visitors })),
    recentLeads: recentLeads.map((l) => ({ id: l.id, seq: l.seq, name: l.name, channel: l.channel, status: l.status, createdAt: l.createdAt.toISOString() })),
    hotVisitors: hotVisitors.map(toVisitorRow),
    hotThreshold: settings.scoreWeights.hotThreshold,
  };
}

export function toVisitorRow(v: {
  id: string;
  firstSeenAt: Date;
  lastSeenAt: Date;
  country: string | null;
  language: string | null;
  deviceType: DeviceType;
  sessionCount: number;
  pageviewCount: number;
  engagedSeconds: number;
  contactClicks: number;
  reachedBooking: boolean;
  score: number;
  refCode: string | null;
  firstSource: string | null;
  firstMedium: string | null;
  firstCampaign: string | null;
}) {
  return {
    id: v.id,
    firstSeenAt: v.firstSeenAt.toISOString(),
    lastSeenAt: v.lastSeenAt.toISOString(),
    country: v.country,
    language: v.language,
    deviceType: v.deviceType,
    sessionCount: v.sessionCount,
    pageviewCount: v.pageviewCount,
    engagedSeconds: v.engagedSeconds,
    contactClicks: v.contactClicks,
    reachedBooking: v.reachedBooking,
    score: v.score,
    refCode: v.refCode,
    firstSource: v.firstSource,
    firstMedium: v.firstMedium,
    firstCampaign: v.firstCampaign,
  };
}

export async function liveSessions(app: FastifyInstance, now = new Date()) {
  const sessions = await app.prisma.crmSession.findMany({
    where: { botFlagged: false, lastSeenAt: { gte: new Date(now.getTime() - CRM_LIVE_WINDOW_MS) } },
    orderBy: { lastSeenAt: "desc" },
    take: 200,
    include: { visitor: { select: { score: true, sessionCount: true, refCode: true } } },
  });
  return sessions.map((s) => ({
    visitorId: s.visitorId,
    currentPath: s.exitPath ?? s.landingPath,
    landingPath: s.landingPath,
    country: s.country,
    city: s.city,
    deviceType: s.deviceType,
    browser: s.browser,
    os: s.os,
    source: s.source,
    medium: s.medium,
    campaign: s.campaign,
    pageCount: s.pageCount,
    durationSeconds: s.durationSeconds,
    startedAt: s.startedAt.toISOString(),
    lastSeenAt: s.lastSeenAt.toISOString(),
    score: s.visitor.score,
    returning: s.visitor.sessionCount > 1,
    refCode: s.visitor.refCode,
  }));
}

export const VisitorListQuerySchema = z.object({
  q: z.string().trim().max(60).optional(),
  hot: z.enum(["true", "false"]).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export async function listVisitors(app: FastifyInstance, query: z.infer<typeof VisitorListQuerySchema>) {
  const settings = await readCrmSettings(app.prisma);
  const where: Prisma.CrmVisitorWhereInput = { botFlagged: false };
  if (query.q) {
    const ref = query.q.toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/^REF/, "");
    where.OR = [{ refCode: ref || "__none__" }, { id: { startsWith: query.q } }];
  }
  if (query.hot === "true") where.score = { gte: settings.scoreWeights.hotThreshold };
  if (query.from || query.to) {
    where.lastSeenAt = {
      ...(query.from ? { gte: istanbulDayRange(query.from).start } : {}),
      ...(query.to ? { lt: istanbulDayRange(query.to).end } : {}),
    };
  }
  const [total, items] = await Promise.all([
    app.prisma.crmVisitor.count({ where }),
    app.prisma.crmVisitor.findMany({
      where,
      orderBy: query.hot === "true" ? [{ score: "desc" }, { lastSeenAt: "desc" }] : { lastSeenAt: "desc" },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
  ]);
  return { items: items.map(toVisitorRow), total, hotThreshold: settings.scoreWeights.hotThreshold };
}

/** Ziyaretçi detayı: oturumlar + ham olay zaman çizelgesi (en fazla 500 olay; heartbeat'ler hariç). */
export async function visitorDetail(app: FastifyInstance, id: string) {
  const visitor = await app.prisma.crmVisitor.findUnique({ where: { id } });
  if (!visitor) return null;
  const [sessions, events, leads] = await Promise.all([
    app.prisma.crmSession.findMany({ where: { visitorId: id }, orderBy: { startedAt: "desc" }, take: 30 }),
    app.prisma.crmEvent.findMany({
      where: { visitorId: id, type: { not: "HEARTBEAT" } },
      orderBy: { occurredAt: "desc" },
      take: 500,
      select: { id: true, sessionId: true, type: true, occurredAt: true, path: true, title: true, text: true, target: true, name: true, scrollPct: true, step: true, isRage: true, isDead: true },
    }),
    app.prisma.crmLead.findMany({ where: { visitorId: id }, select: { id: true, seq: true, name: true, status: true, channel: true } }),
  ]);
  return {
    ...toVisitorRow(visitor),
    timezone: visitor.timezone,
    firstReferrerHost: visitor.firstReferrerHost,
    firstLandingPath: visitor.firstLandingPath,
    sessions: sessions.map((s) => ({
      id: s.id,
      startedAt: s.startedAt.toISOString(),
      lastSeenAt: s.lastSeenAt.toISOString(),
      source: s.source,
      medium: s.medium,
      campaign: s.campaign,
      referrerHost: s.referrerHost,
      landingPath: s.landingPath,
      exitPath: s.exitPath,
      pageCount: s.pageCount,
      durationSeconds: s.durationSeconds,
      country: s.country,
      city: s.city,
      ip: s.ip,
      deviceType: s.deviceType,
      browser: s.browser,
      os: s.os,
      hasAdClickId: Boolean(s.gclid || s.gbraid || s.wbraid),
      bookingStarted: s.bookingStarted,
    })),
    events: events.map((e) => ({ ...e, id: e.id.toString(), occurredAt: e.occurredAt.toISOString() })),
    leads,
  };
}

export async function pageMap(app: FastifyInstance, range: RangeQuery) {
  const rows = await sumRollup(app, "page", range, { orderBy: "pageviews", take: 2000 });
  return rows.map(toPageRow);
}

export async function sourcesReport(app: FastifyInstance, range: RangeQuery) {
  const rows = await sumRollup(app, "source", range, { orderBy: "sessions", take: 500 });
  return rows.map((s) => ({ ...splitSource(s.key), sessions: s.sessions, visitors: s.visitors, pageviews: s.pageviews, entries: s.entries, contacts: s.contacts, bookingsStarted: s.bookingsStarted }));
}

export async function audienceReport(app: FastifyInstance, range: RangeQuery) {
  const [countries, languages, timezones, devices, doctors, specialties] = await Promise.all([
    sumRollup(app, "country", range, { orderBy: "visitors", take: 100 }),
    sumRollup(app, "language", range, { orderBy: "visitors", take: 100 }),
    sumRollup(app, "timezone", range, { orderBy: "visitors", take: 100 }),
    sumRollup(app, "device", range, { orderBy: "visitors" }),
    sumRollup(app, "doctor", range, { orderBy: "pageviews", take: 100 }),
    sumRollup(app, "specialty", range, { orderBy: "pageviews", take: 100 }),
  ]);
  const [doctorNames, specialtyNames] = await Promise.all([
    app.prisma.doctorProfile.findMany({ where: { slug: { in: doctors.map((d) => d.key) } }, select: { slug: true, title: true, fullName: true } }),
    app.prisma.specialty.findMany({ where: { slug: { in: specialties.map((s) => s.key) } }, select: { slug: true, name: true } }),
  ]);
  const docLabel = new Map(doctorNames.map((d) => [d.slug, `${d.title} ${d.fullName}`]));
  const specLabel = new Map(specialtyNames.map((s) => [s.slug, s.name]));
  const row = (r: RollupSum, label?: string) => ({
    key: r.key,
    label: label ?? r.key,
    visitors: r.visitors,
    sessions: r.sessions,
    pageviews: r.pageviews,
    contacts: r.contacts,
    bookingsStarted: r.bookingsStarted,
  });
  return {
    countries: countries.map((r) => row(r)),
    languages: languages.map((r) => row(r)),
    timezones: timezones.map((r) => row(r)),
    devices: devices.map((r) => row(r)),
    doctors: doctors.map((r) => row(r, docLabel.get(r.key))),
    specialties: specialties.map((r) => row(r, specLabel.get(r.key))),
  };
}

export const ClicksQuerySchema = RangeQuerySchema.extend({ path: z.string().max(300).optional() });

export async function clicksReport(app: FastifyInstance, query: z.infer<typeof ClicksQuerySchema>) {
  const rows = await sumRollup(app, "click", query, { orderBy: "clicks", take: 1000 });
  return rows
    .map((c) => ({ ...parseClickLabel(c.label), clicks: c.clicks, contacts: c.contacts, visitors: c.visitors, whatsappClicks: c.whatsappClicks, phoneClicks: c.phoneClicks, emailClicks: c.emailClicks }))
    .filter((c) => !query.path || c.path === query.path)
    .slice(0, 300);
}

export const HeatmapQuerySchema = RangeQuerySchema.extend({
  path: z.string().min(1).max(300),
  device: z.enum(["mobile", "desktop"]).default("desktop"),
});

const MOBILE_DEVICES: DeviceType[] = ["MOBILE", "TABLET"];

/**
 * Isı haritası (ham olaylar): tıklama noktaları (viewport/belge yüzdesi + öğe seçicisi ve öğe içi
 * konum), kaydırma derinliği dağılımı, öfkeli tıklama, ölü tıklama ve "tıklanabilir sanılan" öğeler
 * (ölü tıklamaların seçiciye göre yoğunluğu).
 */
export async function heatmap(app: FastifyInstance, query: z.infer<typeof HeatmapQuerySchema>) {
  const { start, end } = rangeBounds(query);
  const deviceWhere: Prisma.CrmEventWhereInput = query.device === "mobile" ? { deviceType: { in: MOBILE_DEVICES } } : { deviceType: { notIn: MOBILE_DEVICES } };
  const base: Prisma.CrmEventWhereInput = { path: query.path, occurredAt: { gte: start, lt: end }, session: { botFlagged: false }, ...deviceWhere };
  const [clicks, scrolls, pageviews] = await Promise.all([
    app.prisma.crmEvent.findMany({
      where: { ...base, type: { in: ["CLICK", "WHATSAPP_CLICK", "PHONE_CLICK", "EMAIL_CLICK"] }, xPct: { not: null }, yPct: { not: null } },
      orderBy: { occurredAt: "desc" },
      take: 5000,
      select: { xPct: true, yPct: true, elXPct: true, elYPct: true, selector: true, text: true, isRage: true, isDead: true, viewportW: true, docH: true },
    }),
    app.prisma.crmEvent.findMany({ where: { ...base, type: "SCROLL", scrollPct: { not: null } }, select: { scrollPct: true }, take: 20_000 }),
    app.prisma.crmEvent.count({ where: { ...base, type: "PAGEVIEW" } }),
  ]);

  const bands = Array.from({ length: 10 }, (_, i) => (i + 1) * 10);
  const scrollReach = bands.map((band) => ({
    depth: band,
    pct: scrolls.length > 0 ? Math.round((scrolls.filter((s) => (s.scrollPct ?? 0) >= band).length / scrolls.length) * 100) : 0,
  }));

  const deadBySelector = new Map<string, { selector: string; count: number; text: string | null }>();
  for (const c of clicks) {
    if (!c.isDead || !c.selector) continue;
    const entry = deadBySelector.get(c.selector) ?? { selector: c.selector, count: 0, text: c.text };
    entry.count++;
    deadBySelector.set(c.selector, entry);
  }
  const rageBySelector = new Map<string, { selector: string; count: number; text: string | null }>();
  for (const c of clicks) {
    if (!c.isRage || !c.selector) continue;
    const entry = rageBySelector.get(c.selector) ?? { selector: c.selector, count: 0, text: c.text };
    entry.count++;
    rageBySelector.set(c.selector, entry);
  }

  const docHeights = clicks.map((c) => c.docH).filter((h): h is number => typeof h === "number" && h > 0).sort((a, b) => a - b);
  return {
    pageviews,
    clickCount: clicks.length,
    rageClicks: clicks.filter((c) => c.isRage).length,
    deadClicks: clicks.filter((c) => c.isDead).length,
    medianDocHeight: docHeights.length > 0 ? docHeights[Math.floor(docHeights.length / 2)]! : null,
    points: clicks.map((c) => ({ x: c.xPct!, y: c.yPct!, ex: c.elXPct, ey: c.elYPct, sel: c.selector, rage: c.isRage, dead: c.isDead })),
    scrollReach,
    scrollSamples: scrolls.length,
    likelyClickable: [...deadBySelector.values()].filter((d) => d.count >= 2).sort((a, b) => b.count - a.count).slice(0, 15),
    rageTargets: [...rageBySelector.values()].sort((a, b) => b.count - a.count).slice(0, 15),
  };
}

/** Isı haritası sayfa seçicisi: aralıkta en çok görüntülenen yollar. */
export async function heatmapPages(app: FastifyInstance, range: RangeQuery) {
  const rows = await sumRollup(app, "page", range, { orderBy: "pageviews", take: 100 });
  return rows.map((r) => ({ path: r.key, pageviews: r.pageviews, clicks: r.clicks }));
}
