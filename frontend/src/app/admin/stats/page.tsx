"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import * as pagesApi from "@/lib/api/pages";
import * as blogApi from "@/lib/api/blog";
import * as statsApi from "@/lib/api/stats";
import { StatCard, type StatCardDelta } from "@/components/admin/stats/stat-card";
import { VisitorChart } from "@/components/admin/stats/visitor-chart";
import { ActivityBarChart } from "@/components/admin/stats/activity-bar-chart";
import { DeviceBreakdownChart } from "@/components/admin/stats/device-breakdown-chart";
import { CountryBreakdownList } from "@/components/admin/stats/country-breakdown-list";
import { PageHeading } from "@/components/admin/page-heading";
import { Alert } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";
import { computeDelta } from "@/lib/stats-summary";
import { AlertCircle, BarChart3 } from "lucide-react";

type Range = "7" | "30" | "90";

interface Summary {
  totalPages: number;
  publishedPosts: number;
  rangePageViews: number;
  rangePostViews: number;
  pageViewsDelta?: StatCardDelta;
  postViewsDelta?: StatCardDelta;
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
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.08 },
  },
};

const statsItemVariants = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.3 } },
};

export default function AdminStatsPage() {
  const [range, setRange] = useState<Range>("30");
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setSummary(null);
      setError(null);
      try {
        const rangeDays = Number(range);
        // Backend `days` parametresi için 90 üst sınır uyguluyor (bkz. stats.schemas.ts),
        // bu yüzden karşılaştırma penceresi 90 gün ile sınırlanıyor. range=90 için önceki
        // dönem verisi bulunmaz (previous=0), computeDelta bu durumda zaten delta göstermeden
        // undefined döner — bu davranış kasıtlı bir düşüş (graceful degradation).
        const requestDays = Math.min(rangeDays * 2, 90);
        const [pages, posts, viewStats] = await Promise.all([
          pagesApi.listPages(),
          blogApi.listPosts(),
          statsApi.getViewStats(requestDays),
        ]);

        // Son `rangeDays` gün mevcut dönem, ondan önceki `rangeDays` gün karşılaştırma dönemi.
        const currentPeriod = viewStats.slice(-rangeDays);
        const previousPeriod = viewStats.slice(0, viewStats.length - rangeDays);

        const rangePageViews = currentPeriod.reduce((sum, row) => sum + row.pageViews, 0);
        const rangePostViews = currentPeriod.reduce((sum, row) => sum + row.postViews, 0);
        const previousPageViews = previousPeriod.reduce((sum, row) => sum + row.pageViews, 0);
        const previousPostViews = previousPeriod.reduce((sum, row) => sum + row.postViews, 0);

        setSummary({
          totalPages: pages.items.length,
          publishedPosts: posts.items.filter((post) => post.status === "PUBLISHED").length,
          rangePageViews,
          rangePostViews,
          pageViewsDelta: computeDelta(rangePageViews, previousPageViews),
          postViewsDelta: computeDelta(rangePostViews, previousPostViews),
        });
      } catch (err) {
        setError(friendlyErrorMessage(err));
      }
    })();
  }, [range]);

  return (
    <div className="space-y-6">
      <PageHeading
        icon={BarChart3}
        title="İstatistikler"
        description={`Son ${range} gün sayfa ve blog görüntülenme verileri.`}
        actions={
          <Tabs value={range} onValueChange={(value) => setRange(String(value) as Range)}>
            <TabsList variant="default">
              <TabsTrigger value="7">7 gün</TabsTrigger>
              <TabsTrigger value="30">30 gün</TabsTrigger>
              <TabsTrigger value="90">90 gün</TabsTrigger>
            </TabsList>
          </Tabs>
        }
      />

      {error && (
        <Alert variant="error">
          <span className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {error}
          </span>
        </Alert>
      )}

      <motion.div
        className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
        variants={statsContainerVariants}
        initial="hidden"
        animate="visible"
      >
        {summary === null ? (
          <>
            <StatCardSkeleton />
            <StatCardSkeleton />
            <StatCardSkeleton />
            <StatCardSkeleton />
          </>
        ) : (
          <>
            <motion.div variants={statsItemVariants}>
              <StatCard label="Toplam sayfa" value={summary.totalPages.toLocaleString("tr-TR")} />
            </motion.div>
            <motion.div variants={statsItemVariants}>
              <StatCard label="Yayında blog yazısı" value={summary.publishedPosts.toLocaleString("tr-TR")} />
            </motion.div>
            <motion.div variants={statsItemVariants}>
              <StatCard
                label="Sayfa görüntüleme"
                value={summary.rangePageViews.toLocaleString("tr-TR")}
                delta={summary.pageViewsDelta}
              />
            </motion.div>
            <motion.div variants={statsItemVariants}>
              <StatCard
                label="Blog görüntüleme"
                value={summary.rangePostViews.toLocaleString("tr-TR")}
                delta={summary.postViewsDelta}
              />
            </motion.div>
          </>
        )}
      </motion.div>

      <div className="grid gap-4 lg:grid-cols-2">
        <VisitorChart days={Number(range)} />
        <ActivityBarChart days={Number(range)} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <DeviceBreakdownChart days={Number(range)} />
        <CountryBreakdownList days={Number(range)} />
      </div>
    </div>
  );
}
