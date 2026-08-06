import { apiFetch, apiFetchPage } from "./client";
import type {
  BreakdownDto,
  DailyViewStats,
  LiveVisitorsDto,
  Page,
  RevenueStats,
  StatsGranularity,
  SummaryStats,
  TopContentItem,
  UsersStats,
} from "./types";

/**
 * §10.8.10 genişletilmiş tarih aralığı sözleşmesi — `from`/`to` (ISO-8601, BİRLİKTE verilmeli)
 * VEYA `days` (deprecated, backend'de üst sınır 90). İkisi birden verilirse backend `from`/`to`'yu
 * önceliklendirir. `compare` YALNIZCA `/admin/stats/summary`'yi etkiler — `/views` ve `/breakdown`
 * bu alanı ŞEMA UYUMLULUĞU için kabul eder ama YOK SAYAR (bkz. backend `stats-query.ts`).
 */
export interface StatsRangeQuery {
  from?: string;
  to?: string;
  /** @deprecated `from`/`to` tercih edilmeli. */
  days?: number;
  granularity?: StatsGranularity;
  compare?: boolean;
}

type StatsQueryInput = number | StatsRangeQuery;

function normalizeRangeQuery(input: StatsQueryInput): StatsRangeQuery {
  return typeof input === "number" ? { days: input } : input;
}

function toQueryParams(range: StatsRangeQuery): Record<string, string | number | boolean | undefined> {
  return {
    from: range.from,
    to: range.to,
    days: range.days,
    granularity: range.granularity,
    compare: range.compare,
  };
}

/** `GET /admin/stats/views` — EDITOR+ADMIN. Geriye uyumlu: sayı verilirse `days` olarak yorumlanır. */
export function getViewStats(query: StatsQueryInput = 30): Promise<DailyViewStats[]> {
  return apiFetch<DailyViewStats[]>("/admin/stats/views", { query: toQueryParams(normalizeRangeQuery(query)) });
}

/** `GET /admin/stats/live-visitors` — EDITOR+ADMIN. */
export function getLiveVisitors(): Promise<LiveVisitorsDto> {
  return apiFetch<LiveVisitorsDto>("/admin/stats/live-visitors");
}

/** `GET /admin/stats/breakdown` — EDITOR+ADMIN. Geriye uyumlu: sayı verilirse `days` olarak yorumlanır. */
export function getBreakdown(query: StatsQueryInput = 30): Promise<BreakdownDto> {
  return apiFetch<BreakdownDto>("/admin/stats/breakdown", { query: toQueryParams(normalizeRangeQuery(query)) });
}

/** `GET /admin/stats/summary` — YALNIZCA ADMIN. `from`/`to` VEYA `days` ZORUNLU (boş çağrılamaz). */
export function getSummary(query: StatsRangeQuery): Promise<SummaryStats> {
  return apiFetch<SummaryStats>("/admin/stats/summary", { query: toQueryParams(query) });
}

export interface TopContentQuery extends StatsRangeQuery {
  cursor?: string;
  limit?: number;
}

/** `GET /admin/stats/top-content` — EDITOR+ADMIN, cursor sayfalı (`apiFetchPage`). */
export function getTopContent(query: TopContentQuery = {}): Promise<Page<TopContentItem>> {
  const { cursor, limit, ...range } = query;
  return apiFetchPage<TopContentItem>("/admin/stats/top-content", {
    query: { ...toQueryParams(range), cursor, limit },
  });
}

/** `GET /admin/stats/users` — YALNIZCA ADMIN. */
export function getUsersStats(query: StatsRangeQuery = {}): Promise<UsersStats> {
  return apiFetch<UsersStats>("/admin/stats/users", { query: toQueryParams(query) });
}

/** `GET /admin/stats/revenue` — YALNIZCA ADMIN. */
export function getRevenueStats(query: StatsRangeQuery = {}): Promise<RevenueStats> {
  return apiFetch<RevenueStats>("/admin/stats/revenue", { query: toQueryParams(query) });
}
