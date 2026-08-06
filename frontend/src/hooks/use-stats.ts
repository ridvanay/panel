import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import * as statsApi from "@/lib/api/stats";
import type { StatsRangeQuery, TopContentQuery } from "@/lib/api/stats";
import type { BreakdownDto, DailyViewStats, RevenueStats, SummaryStats, TopContentItem, UsersStats } from "@/lib/api/types";

/**
 * `/admin/stats/*` için TanStack Query anahtar fabrikası — tüm hook'lar BURADAN türer ki aynı
 * `range` ile yapılan istekler (ör. üst KPI kartları + grafik) tarayıcı önbelleğini paylaşsın.
 */
export const statsKeys = {
  all: ["admin-stats"] as const,
  views: (range: StatsRangeQuery) => [...statsKeys.all, "views", range] as const,
  breakdown: (range: StatsRangeQuery) => [...statsKeys.all, "breakdown", range] as const,
  liveVisitors: () => [...statsKeys.all, "live-visitors"] as const,
  summary: (range: StatsRangeQuery) => [...statsKeys.all, "summary", range] as const,
  topContent: (range: StatsRangeQuery, limit: number) => [...statsKeys.all, "top-content", range, limit] as const,
  users: (range: StatsRangeQuery) => [...statsKeys.all, "users", range] as const,
  revenue: (range: StatsRangeQuery) => [...statsKeys.all, "revenue", range] as const,
};

type EnabledOption = { enabled?: boolean };

export function useViewStats(range: StatsRangeQuery, options: EnabledOption = {}) {
  return useQuery<DailyViewStats[]>({
    queryKey: statsKeys.views(range),
    queryFn: () => statsApi.getViewStats(range),
    enabled: options.enabled ?? true,
  });
}

export function useBreakdownStats(range: StatsRangeQuery, options: EnabledOption = {}) {
  return useQuery<BreakdownDto>({
    queryKey: statsKeys.breakdown(range),
    queryFn: () => statsApi.getBreakdown(range),
    enabled: options.enabled ?? true,
  });
}

/** "Şu an sayfa görüntüleyen" rozeti — 5 saniyede bir poll eder (bkz. live-visitors-badge.tsx). */
export function useLiveVisitors() {
  return useQuery({
    queryKey: statsKeys.liveVisitors(),
    queryFn: () => statsApi.getLiveVisitors(),
    refetchInterval: 5000,
    staleTime: 0,
  });
}

/** YALNIZCA ADMIN — `enabled: false` ile EDITOR oturumunda hiç istek atılmaz (403 gürültüsü yok). */
export function useSummaryStats(range: StatsRangeQuery, options: EnabledOption = {}) {
  return useQuery<SummaryStats>({
    queryKey: statsKeys.summary(range),
    queryFn: () => statsApi.getSummary(range),
    enabled: options.enabled ?? true,
  });
}

const TOP_CONTENT_PAGE_SIZE = 10;

/** "Daha fazla yükle" akışı için `useInfiniteQuery` — `getNextPageParam` backend `meta.nextCursor`'ı okur. */
export function useTopContent(range: StatsRangeQuery, options: EnabledOption = {}) {
  return useInfiniteQuery({
    queryKey: statsKeys.topContent(range, TOP_CONTENT_PAGE_SIZE),
    queryFn: ({ pageParam }: { pageParam: string | null }) =>
      statsApi.getTopContent({ ...range, cursor: pageParam ?? undefined, limit: TOP_CONTENT_PAGE_SIZE } satisfies TopContentQuery),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.meta.nextCursor,
    enabled: options.enabled ?? true,
  });
}

export function flattenTopContent(pages: { items: TopContentItem[] }[] | undefined): TopContentItem[] {
  return pages?.flatMap((page) => page.items) ?? [];
}

/** YALNIZCA ADMIN. */
export function useUsersStats(range: StatsRangeQuery, options: EnabledOption = {}) {
  return useQuery<UsersStats>({
    queryKey: statsKeys.users(range),
    queryFn: () => statsApi.getUsersStats(range),
    enabled: options.enabled ?? true,
  });
}

/** YALNIZCA ADMIN. */
export function useRevenueStats(range: StatsRangeQuery, options: EnabledOption = {}) {
  return useQuery<RevenueStats>({
    queryKey: statsKeys.revenue(range),
    queryFn: () => statsApi.getRevenueStats(range),
    enabled: options.enabled ?? true,
  });
}
