import type { FastifyInstance } from "fastify";
import { addUtcDays, bucketDateKey, startOfUtcDay, toDateKey, type StatsGranularity } from "./date";
import { ValidationError } from "./errors";

/** §10.8.10 — `/admin/stats/*` ve rapor export worker'ının (§10.8.10, `reports.worker.ts`)
 * PAYLAŞTIĞI aggregation katmanı — kod tekrarını önlemek için TEK noktadan yönetilir.
 * `PageView.date`'in `@@index([date])`'inden faydalanacak şekilde, ham satır çekip Node'da
 * toplama YERİNE Prisma `groupBy`/`aggregate`/raw SQL `date_trunc` tercih edilir. */

export const STATS_MAX_RANGE_DAYS = 366;
/** Geriye uyumlu `days` parametresi için eski tavan (bkz. stats.schemas.ts). */
const LEGACY_DEFAULT_DAYS = 30;

export interface DateRange {
  /** UTC gece yarısına yuvarlanmış, dahil. */
  from: Date;
  /** UTC gece yarısına yuvarlanmış, dahil. */
  to: Date;
  /** `to` bucket'ının SONRASI — SQL `< toExclusive` filtrelerinde kullanılır. */
  toExclusive: Date;
  days: number;
}

interface RangeInput {
  days?: number;
  from?: string;
  to?: string;
}

/**
 * `from`/`to` verilirse önceliklidir (366 gün üst sınır, aşımı 422); verilmezse `days`
 * (varsayılan 30, eski 90 günlük tavan zaten şema seviyesinde uygulanır) eski davranışı korur.
 */
export function resolveStatsRange(query: RangeInput): DateRange {
  if (query.from !== undefined && query.to !== undefined) {
    const fromParsed = new Date(query.from);
    const toParsed = new Date(query.to);
    if (Number.isNaN(fromParsed.getTime()) || Number.isNaN(toParsed.getTime())) {
      throw new ValidationError("Geçersiz `from`/`to` tarihi.", { from: ["ISO-8601 biçiminde olmalı."] });
    }
    const from = startOfUtcDay(fromParsed);
    const to = startOfUtcDay(toParsed);
    if (from.getTime() > to.getTime()) {
      throw new ValidationError("`from`, `to`'dan sonra olamaz.", { from: ["`from` <= `to` olmalı."] });
    }
    const days = Math.round((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000)) + 1;
    if (days > STATS_MAX_RANGE_DAYS) {
      throw new ValidationError(`Tarih aralığı en fazla ${STATS_MAX_RANGE_DAYS} gün olabilir.`, {
        to: [`En fazla ${STATS_MAX_RANGE_DAYS} günlük aralık desteklenir.`],
      });
    }
    return { from, to, toExclusive: addUtcDays(to, 1), days };
  }

  const days = query.days ?? LEGACY_DEFAULT_DAYS;
  const to = startOfUtcDay();
  const from = addUtcDays(to, -(days - 1));
  return { from, to, toExclusive: addUtcDays(to, 1), days };
}

/** Aynı uzunlukta, hemen ÖNCESİNDEKİ dönem — `compare=true` için (bkz. stats.routes.ts). */
export function previousRange(range: DateRange): DateRange {
  const to = addUtcDays(range.from, -1);
  const from = addUtcDays(to, -(range.days - 1));
  return { from, to, toExclusive: addUtcDays(to, 1), days: range.days };
}

// ---------------------------------------------------------------------------
// Views / Breakdown — mevcut /admin/stats/views ve /breakdown ile paylaşılır.
// ---------------------------------------------------------------------------

export interface ViewSeriesPoint {
  date: string;
  pageViews: number;
  postViews: number;
}

/** Günlük `PageView.date` bucket'larını `groupBy` ile toplar, ardından (≤366 nokta) granularity'ye göre bucketlar. */
export async function getViewsSeries(app: FastifyInstance, range: DateRange, granularity: StatsGranularity): Promise<ViewSeriesPoint[]> {
  const [pageRows, postRows] = await Promise.all([
    app.prisma.pageView.groupBy({
      by: ["date"],
      where: { date: { gte: range.from, lte: range.to }, pageId: { not: null } },
      _sum: { count: true },
    }),
    app.prisma.pageView.groupBy({
      by: ["date"],
      where: { date: { gte: range.from, lte: range.to }, postId: { not: null } },
      _sum: { count: true },
    }),
  ]);

  const byBucket = new Map<string, { pageViews: number; postViews: number }>();
  if (granularity === "day") {
    for (let i = 0; i < range.days; i++) {
      byBucket.set(toDateKey(addUtcDays(range.from, i)), { pageViews: 0, postViews: 0 });
    }
  }

  for (const row of pageRows) {
    const key = bucketDateKey(row.date, granularity);
    const bucket = byBucket.get(key) ?? { pageViews: 0, postViews: 0 };
    bucket.pageViews += row._sum.count ?? 0;
    byBucket.set(key, bucket);
  }
  for (const row of postRows) {
    const key = bucketDateKey(row.date, granularity);
    const bucket = byBucket.get(key) ?? { pageViews: 0, postViews: 0 };
    bucket.postViews += row._sum.count ?? 0;
    byBucket.set(key, bucket);
  }

  return Array.from(byBucket.entries())
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([date, counts]) => ({ date, ...counts }));
}

export interface BreakdownResult {
  devices: { type: "MOBILE" | "DESKTOP" | "TABLET" | "UNKNOWN"; count: number }[];
  countries: { country: string; count: number }[];
}

export async function getBreakdown(app: FastifyInstance, range: DateRange): Promise<BreakdownResult> {
  const deviceRows = await app.prisma.pageView.groupBy({
    by: ["deviceType"],
    where: { date: { gte: range.from, lte: range.to } },
    _sum: { count: true },
  });

  const countryRowsRaw = await app.prisma.pageView.groupBy({
    by: ["country"],
    where: { date: { gte: range.from, lte: range.to } },
    _sum: { count: true },
    orderBy: { _sum: { count: "desc" } },
  });

  const top10 = countryRowsRaw.slice(0, 10).map((r) => ({ country: r.country, count: r._sum.count ?? 0 }));
  const otherCount = countryRowsRaw.slice(10).reduce((sum, r) => sum + (r._sum.count ?? 0), 0);
  const countries = otherCount > 0 ? [...top10, { country: "OTHER", count: otherCount }] : top10;
  const devices = deviceRows.map((r) => ({ type: r.deviceType, count: r._sum.count ?? 0 }));

  return { devices, countries };
}

// ---------------------------------------------------------------------------
// Summary — KPI kartları
// ---------------------------------------------------------------------------

export interface SummaryAggregate {
  pageViews: number;
  postViews: number;
  newUsers: number;
}

async function getSummaryAggregate(app: FastifyInstance, range: DateRange): Promise<SummaryAggregate> {
  const [pageAgg, postAgg, newUsers] = await Promise.all([
    app.prisma.pageView.aggregate({
      where: { date: { gte: range.from, lte: range.to }, pageId: { not: null } },
      _sum: { count: true },
    }),
    app.prisma.pageView.aggregate({
      where: { date: { gte: range.from, lte: range.to }, postId: { not: null } },
      _sum: { count: true },
    }),
    app.prisma.user.count({ where: { createdAt: { gte: range.from, lt: range.toExclusive } } }),
  ]);

  return {
    pageViews: pageAgg._sum.count ?? 0,
    postViews: postAgg._sum.count ?? 0,
    newUsers,
  };
}

interface ActiveSubscriptionSnapshot {
  activeSubscriptions: number;
  mrrCents: number;
}

/**
 * ANLIK (current) aktif abonelik sayısı + MRR. `Subscription` faturalama periyodunu
 * (aylık/yıllık) ayrı saklamadığı için `Plan.priceMonthlyCents` kullanılır (bkz.
 * stats.schemas.ts::SummaryStatsSchema üstündeki not) — bilinen bir yaklaşıklıktır.
 */
async function getActiveSubscriptionSnapshot(app: FastifyInstance): Promise<ActiveSubscriptionSnapshot> {
  const rows = await app.prisma.$queryRaw<{ count: bigint; mrr: bigint }[]>`
    SELECT COUNT(*)::bigint AS count, COALESCE(SUM(p."priceMonthlyCents"), 0)::bigint AS mrr
    FROM "subscriptions" s
    JOIN "plans" p ON p.id = s."planId"
    WHERE s.status = 'ACTIVE'
  `;
  const row = rows[0];
  return { activeSubscriptions: Number(row?.count ?? 0n), mrrCents: Number(row?.mrr ?? 0n) };
}

export interface SummaryStatsResult {
  pageViews: number;
  postViews: number;
  newUsers: number;
  activeSubscriptions: number;
  mrrCents: number;
  compare: SummaryAggregate | null;
}

export async function getSummaryStats(app: FastifyInstance, range: DateRange, compare: boolean): Promise<SummaryStatsResult> {
  const [current, snapshot, previous] = await Promise.all([
    getSummaryAggregate(app, range),
    getActiveSubscriptionSnapshot(app),
    compare ? getSummaryAggregate(app, previousRange(range)) : Promise.resolve(null),
  ]);

  return { ...current, ...snapshot, compare: previous };
}

// ---------------------------------------------------------------------------
// Top content
// ---------------------------------------------------------------------------

export interface TopContentItem {
  contentType: "page" | "post";
  id: string;
  title: string;
  slug: string;
  views: number;
}

export async function getTopContent(
  app: FastifyInstance,
  range: DateRange,
  offset: number,
  limit: number
): Promise<{ items: TopContentItem[]; nextOffset: number | null }> {
  const [pageRows, postRows] = await Promise.all([
    app.prisma.pageView.groupBy({
      by: ["pageId"],
      where: { date: { gte: range.from, lte: range.to }, pageId: { not: null } },
      _sum: { count: true },
    }),
    app.prisma.pageView.groupBy({
      by: ["postId"],
      where: { date: { gte: range.from, lte: range.to }, postId: { not: null } },
      _sum: { count: true },
    }),
  ]);

  const pageIds = pageRows.map((r) => r.pageId).filter((id): id is string => Boolean(id));
  const postIds = postRows.map((r) => r.postId).filter((id): id is string => Boolean(id));

  const [pages, posts] = await Promise.all([
    pageIds.length > 0 ? app.prisma.page.findMany({ where: { id: { in: pageIds } }, select: { id: true, title: true, slug: true } }) : [],
    postIds.length > 0 ? app.prisma.blogPost.findMany({ where: { id: { in: postIds } }, select: { id: true, title: true, slug: true } }) : [],
  ]);
  const pageById = new Map(pages.map((p) => [p.id, p]));
  const postById = new Map(posts.map((p) => [p.id, p]));

  const combined: TopContentItem[] = [
    ...pageRows
      .filter((r) => r.pageId)
      .map((r) => {
        const page = pageById.get(r.pageId!);
        return { contentType: "page" as const, id: r.pageId!, title: page?.title ?? "—", slug: page?.slug ?? "", views: r._sum.count ?? 0 };
      }),
    ...postRows
      .filter((r) => r.postId)
      .map((r) => {
        const post = postById.get(r.postId!);
        return { contentType: "post" as const, id: r.postId!, title: post?.title ?? "—", slug: post?.slug ?? "", views: r._sum.count ?? 0 };
      }),
  ].sort((a, b) => b.views - a.views || a.id.localeCompare(b.id));

  const items = combined.slice(offset, offset + limit);
  const nextOffset = offset + limit < combined.length ? offset + limit : null;
  return { items, nextOffset };
}

// ---------------------------------------------------------------------------
// Users — kayıt trendi + rol dağılımı
// ---------------------------------------------------------------------------

export interface UserSeriesPoint {
  date: string;
  count: number;
}

export interface UsersStatsResult {
  series: UserSeriesPoint[];
  roleDistribution: { role: "ADMIN" | "EDITOR" | "VIEWER"; count: number }[];
}

export async function getUsersStats(app: FastifyInstance, range: DateRange, granularity: StatsGranularity): Promise<UsersStatsResult> {
  const [seriesRows, roleRows] = await Promise.all([
    app.prisma.$queryRaw<{ bucket: Date; count: bigint }[]>`
      SELECT date_trunc(${granularity}, "createdAt") AS bucket, COUNT(*)::bigint AS count
      FROM "users"
      WHERE "createdAt" >= ${range.from} AND "createdAt" < ${range.toExclusive}
      GROUP BY bucket
      ORDER BY bucket ASC
    `,
    // Rol dağılımı ANLIK (dönemle sınırlı DEĞİL) — bkz. stats.schemas.ts::UsersStatsSchema notu.
    app.prisma.user.groupBy({ by: ["role"], _count: { _all: true } }),
  ]);

  const series = seriesRows.map((row) => ({ date: bucketDateKey(new Date(row.bucket), granularity), count: Number(row.count) }));
  const roleDistribution = roleRows.map((row) => ({ role: row.role, count: row._count._all }));

  return { series, roleDistribution };
}

// ---------------------------------------------------------------------------
// Revenue — MRR zaman serisi + churn
// ---------------------------------------------------------------------------

export interface RevenueSeriesPoint {
  date: string;
  newMrrCents: number;
  churnedCount: number;
}

export interface RevenueStatsResult {
  activeSubscriptions: number;
  mrrCents: number;
  series: RevenueSeriesPoint[];
}

/**
 * `newMrrCents`/`churnedCount` gerçek "o günkü toplam MRR" DEĞİL, bucket İÇİNDE OLUŞAN
 * hareketlerdir (yeni abonelik `createdAt`'i / iptal `updatedAt`'i referans alınır) —
 * `Subscription` geçmiş durum tablosu OLMADIĞI için nokta-zamanlı toplam MRR'ı geçmişe
 * dönük yeniden inşa etmek mümkün değil (bkz. `SummaryStatsSchema` üstündeki not).
 */
export async function getRevenueStats(app: FastifyInstance, range: DateRange, granularity: StatsGranularity): Promise<RevenueStatsResult> {
  const [snapshot, newSubsRows, churnRows] = await Promise.all([
    getActiveSubscriptionSnapshot(app),
    app.prisma.$queryRaw<{ bucket: Date; sum_cents: bigint }[]>`
      SELECT date_trunc(${granularity}, s."createdAt") AS bucket,
             COALESCE(SUM(p."priceMonthlyCents"), 0)::bigint AS sum_cents
      FROM "subscriptions" s
      JOIN "plans" p ON p.id = s."planId"
      WHERE s."createdAt" >= ${range.from} AND s."createdAt" < ${range.toExclusive}
      GROUP BY bucket
      ORDER BY bucket ASC
    `,
    app.prisma.$queryRaw<{ bucket: Date; count: bigint }[]>`
      SELECT date_trunc(${granularity}, s."updatedAt") AS bucket, COUNT(*)::bigint AS count
      FROM "subscriptions" s
      WHERE s.status = 'CANCELED' AND s."updatedAt" >= ${range.from} AND s."updatedAt" < ${range.toExclusive}
      GROUP BY bucket
      ORDER BY bucket ASC
    `,
  ]);

  const byBucket = new Map<string, RevenueSeriesPoint>();
  for (const row of newSubsRows) {
    const key = bucketDateKey(new Date(row.bucket), granularity);
    const point = byBucket.get(key) ?? { date: key, newMrrCents: 0, churnedCount: 0 };
    point.newMrrCents += Number(row.sum_cents);
    byBucket.set(key, point);
  }
  for (const row of churnRows) {
    const key = bucketDateKey(new Date(row.bucket), granularity);
    const point = byBucket.get(key) ?? { date: key, newMrrCents: 0, churnedCount: 0 };
    point.churnedCount += Number(row.count);
    byBucket.set(key, point);
  }

  const series = Array.from(byBucket.values()).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return { ...snapshot, series };
}
