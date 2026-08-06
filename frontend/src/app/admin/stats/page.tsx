"use client";

import { Suspense, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import * as pagesApi from "@/lib/api/pages";
import * as blogApi from "@/lib/api/blog";
import * as statsApi from "@/lib/api/stats";
import { useAuth } from "@/context/auth-context";
import { StatCard, type StatCardDelta } from "@/components/admin/stats/stat-card";
import { VisitorChart } from "@/components/admin/stats/visitor-chart";
import { ActivityBarChart } from "@/components/admin/stats/activity-bar-chart";
import { DeviceBreakdownChart } from "@/components/admin/stats/device-breakdown-chart";
import { CountryBreakdownList } from "@/components/admin/stats/country-breakdown-list";
import { DateRangeFilter } from "@/components/admin/stats/date-range-filter";
import { SummaryKpiCards } from "@/components/admin/stats/summary-kpi-cards";
import { TopContentList } from "@/components/admin/stats/top-content-list";
import { UsersStatsPanel } from "@/components/admin/stats/users-stats-panel";
import { RevenueStatsPanel } from "@/components/admin/stats/revenue-stats-panel";
import { PageHeading } from "@/components/admin/page-heading";
import { Alert } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Card } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";
import { computeDelta } from "@/lib/stats-summary";
import {
  RANGE_PRESET_LABELS,
  statsFilterStateFromSearchParams,
  statsFilterStateToSearchParams,
  toStatsRangeQuery,
  type StatsFilterState,
} from "@/lib/stats-range";
import { AlertCircle, BarChart3 } from "lucide-react";

interface OverviewSummary {
  totalPages: number;
  publishedPosts: number;
  rangePageViews: number;
  rangePostViews: number;
  pageViewsDelta?: StatCardDelta;
  postViewsDelta?: StatCardDelta;
}

function rangeDayCount(filter: StatsFilterState): number {
  const ms = new Date(`${filter.to}T00:00:00`).getTime() - new Date(`${filter.from}T00:00:00`).getTime();
  return Math.max(1, Math.round(ms / 86_400_000) + 1);
}

/**
 * Üst özet kartları (Toplam sayfa/Yayında blog yazısı/Sayfa+Blog görüntüleme) EDITOR'a da
 * görünür — `/admin/stats/views`'ın `compare` parametresi bu ucu ETKİLEMEZ (yalnızca
 * `/admin/stats/summary`'yi etkiler, bkz. backend `stats-query.ts`), bu yüzden delta hesabı
 * için eski çift-aralık fetch tekniği (mevcut davranışla AYNI, `days` üst sınırı 90 olduğundan
 * çok uzun/özel aralıklarda delta'sız — graceful degradation) korunur.
 */
function useOverviewSummary(filter: StatsFilterState) {
  return useQuery<OverviewSummary>({
    queryKey: ["admin-stats-overview", filter.from, filter.to],
    queryFn: async () => {
      const rangeDays = rangeDayCount(filter);
      const requestDays = Math.min(rangeDays * 2, 90);
      const [pages, posts, viewStats] = await Promise.all([
        pagesApi.listPages(),
        blogApi.listPosts(),
        statsApi.getViewStats(requestDays),
      ]);

      const currentPeriod = viewStats.slice(-rangeDays);
      const previousPeriod = viewStats.slice(0, viewStats.length - rangeDays);

      const rangePageViews = currentPeriod.reduce((sum, row) => sum + row.pageViews, 0);
      const rangePostViews = currentPeriod.reduce((sum, row) => sum + row.postViews, 0);
      const previousPageViews = previousPeriod.reduce((sum, row) => sum + row.pageViews, 0);
      const previousPostViews = previousPeriod.reduce((sum, row) => sum + row.postViews, 0);

      return {
        totalPages: pages.items.length,
        publishedPosts: posts.items.filter((post) => post.status === "PUBLISHED").length,
        rangePageViews,
        rangePostViews,
        pageViewsDelta: computeDelta(rangePageViews, previousPageViews),
        postViewsDelta: computeDelta(rangePostViews, previousPostViews),
      };
    },
  });
}

function StatCardSkeleton() {
  return (
    <Card className="space-y-3">
      <Skeleton className="h-4 w-24" />
      <Skeleton className="h-8 w-16" />
    </Card>
  );
}

const statsContainerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.08 } },
};

const statsItemVariants = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.3 } },
};

function AdminStatsPageContent() {
  const { user } = useAuth();
  const isAdmin = user?.role === "ADMIN";
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const filter = useMemo(() => statsFilterStateFromSearchParams(searchParams), [searchParams]);

  function updateFilter(next: StatsFilterState) {
    const params = statsFilterStateToSearchParams(next);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  const range = useMemo(() => toStatsRangeQuery(filter), [filter]);
  const rangeLabel = filter.preset === "custom" ? `${filter.from} – ${filter.to}` : `Son ${RANGE_PRESET_LABELS[filter.preset]}`;

  const overview = useOverviewSummary(filter);

  return (
    <div className="space-y-6">
      <PageHeading
        icon={BarChart3}
        title="İstatistikler"
        description="Sayfa ve blog görüntülenme verileri, içerik ve (ADMIN için) kullanıcı/gelir analitiği."
        actions={<DateRangeFilter value={filter} onChange={updateFilter} />}
      />

      {overview.isError && (
        <Alert variant="error">
          <span className="flex flex-wrap items-center justify-between gap-3">
            <span className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {friendlyErrorMessage(overview.error)}
            </span>
            <Button type="button" variant="outline" size="sm" onClick={() => void overview.refetch()}>
              Tekrar Dene
            </Button>
          </span>
        </Alert>
      )}

      <motion.div
        className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
        variants={statsContainerVariants}
        initial="hidden"
        animate="visible"
      >
        {overview.isPending || !overview.data ? (
          <>
            <StatCardSkeleton />
            <StatCardSkeleton />
            <StatCardSkeleton />
            <StatCardSkeleton />
          </>
        ) : (
          <>
            <motion.div variants={statsItemVariants}>
              <StatCard label="Toplam sayfa" value={overview.data.totalPages.toLocaleString("tr-TR")} />
            </motion.div>
            <motion.div variants={statsItemVariants}>
              <StatCard label="Yayında blog yazısı" value={overview.data.publishedPosts.toLocaleString("tr-TR")} />
            </motion.div>
            <motion.div variants={statsItemVariants}>
              <StatCard
                label="Sayfa görüntüleme"
                value={overview.data.rangePageViews.toLocaleString("tr-TR")}
                delta={overview.data.pageViewsDelta}
              />
            </motion.div>
            <motion.div variants={statsItemVariants}>
              <StatCard
                label="Blog görüntüleme"
                value={overview.data.rangePostViews.toLocaleString("tr-TR")}
                delta={overview.data.postViewsDelta}
              />
            </motion.div>
          </>
        )}
      </motion.div>

      {/* YALNIZCA ADMIN — EDITOR oturumunda bu bileşen HİÇ MOUNT EDİLMEZ (403 gürültüsü/gereksiz istek yok). */}
      {isAdmin && <SummaryKpiCards range={range} />}

      <div className="grid gap-4 lg:grid-cols-2">
        <VisitorChart range={range} rangeLabel={rangeLabel} />
        <ActivityBarChart range={range} rangeLabel={rangeLabel} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <DeviceBreakdownChart range={range} rangeLabel={rangeLabel} />
        <CountryBreakdownList range={range} rangeLabel={rangeLabel} />
      </div>

      <TopContentList range={range} rangeLabel={rangeLabel} />

      {isAdmin && (
        <Tabs defaultValue="users">
          <TabsList variant="line">
            <TabsTrigger value="users">Kullanıcılar</TabsTrigger>
            <TabsTrigger value="revenue">Gelir</TabsTrigger>
          </TabsList>
          <TabsContent value="users" className="mt-4">
            <UsersStatsPanel range={range} rangeLabel={rangeLabel} />
          </TabsContent>
          <TabsContent value="revenue" className="mt-4">
            <RevenueStatsPanel range={range} rangeLabel={rangeLabel} />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}

function AdminStatsPageFallback() {
  return (
    <div className="flex justify-center py-16">
      <Spinner className="h-6 w-6 text-primary" />
    </div>
  );
}

/**
 * NOT (Next.js 16 — bkz. frontend/AGENTS.md): `useSearchParams` kullanan Client Component
 * production build'de `<Suspense>` ile sarılmalı, aksi halde build hata verir (bkz.
 * `app/(auth)/login/page.tsx` ile AYNI pattern). Filtre state'i URL'e yazıldığı için link
 * paylaşılabilir.
 */
export default function AdminStatsPage() {
  return (
    <Suspense fallback={<AdminStatsPageFallback />}>
      <AdminStatsPageContent />
    </Suspense>
  );
}
