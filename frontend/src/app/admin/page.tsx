"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import * as pagesApi from "@/lib/api/pages";
import * as blogApi from "@/lib/api/blog";
import * as statsApi from "@/lib/api/stats";
import { StatCard, type StatCardDelta } from "@/components/admin/stats/stat-card";
import { VisitorChart } from "@/components/admin/stats/visitor-chart";
import { ActivityBarChart } from "@/components/admin/stats/activity-bar-chart";
import { LiveVisitorsBadge } from "@/components/admin/stats/live-visitors-badge";
import { DeviceBreakdownChart } from "@/components/admin/stats/device-breakdown-chart";
import { CountryBreakdownList } from "@/components/admin/stats/country-breakdown-list";
import { PageHeading } from "@/components/admin/page-heading";
import { Alert } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Card } from "@/components/ui/card";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";
import { AlertCircle, LayoutDashboard } from "lucide-react";

interface Summary {
  totalPages: number;
  publishedPosts: number;
  monthPageViews: number;
  monthPostViews: number;
  pageViewsDelta?: StatCardDelta;
  postViewsDelta?: StatCardDelta;
}

function isSameMonth(dateKey: string, reference: Date): boolean {
  const [year, month] = dateKey.split("-").map(Number);
  return year === reference.getUTCFullYear() && month === reference.getUTCMonth() + 1;
}

/**
 * Bu ayki ve önceki ayki toplamları karşılaştırarak yüzde değişim üretir.
 * Önceki ay için veri yoksa (baseline 0), anlamlı bir yüzde hesaplanamayacağı
 * için `undefined` döner ve kart delta göstermez.
 */
function computeDelta(current: number, previous: number): StatCardDelta | undefined {
  if (!previous || previous <= 0) return undefined;

  const changePercent = ((current - previous) / previous) * 100;
  if (!Number.isFinite(changePercent)) return undefined;

  const direction: StatCardDelta["direction"] = changePercent >= 0 ? "up" : "down";

  return {
    value: `%${Math.abs(changePercent).toFixed(1)}`,
    direction,
    isGood: direction === "up",
  };
}

function StatCardSkeleton() {
  return (
    <Card className="space-y-3">
      <Skeleton className="h-4 w-24" />
      <Skeleton className="h-8 w-16" />
    </Card>
  );
}

const gridVariants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.08 },
  },
};

const cardVariants = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0 },
};

export default function AdminDashboardPage() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [pages, posts, viewStats] = await Promise.all([
          pagesApi.listPages(),
          blogApi.listPosts(),
          statsApi.getViewStats(60),
        ]);

        const now = new Date();
        const previousMonthReference = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));

        const monthStats = viewStats.filter((row) => isSameMonth(row.date, now));
        const previousMonthStats = viewStats.filter((row) => isSameMonth(row.date, previousMonthReference));

        const monthPageViews = monthStats.reduce((sum, row) => sum + row.pageViews, 0);
        const monthPostViews = monthStats.reduce((sum, row) => sum + row.postViews, 0);
        const previousMonthPageViews = previousMonthStats.reduce((sum, row) => sum + row.pageViews, 0);
        const previousMonthPostViews = previousMonthStats.reduce((sum, row) => sum + row.postViews, 0);

        setSummary({
          totalPages: pages.items.length,
          publishedPosts: posts.items.filter((post) => post.status === "PUBLISHED").length,
          monthPageViews,
          monthPostViews,
          pageViewsDelta: computeDelta(monthPageViews, previousMonthPageViews),
          postViewsDelta: computeDelta(monthPostViews, previousMonthPostViews),
        });
      } catch (err) {
        setError(friendlyErrorMessage(err));
      }
    })();
  }, []);

  return (
    <div className="space-y-6">
      <PageHeading
        icon={LayoutDashboard}
        title="Genel Bakış"
        description="Sitenizin son durumu."
        actions={<LiveVisitorsBadge />}
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
        variants={gridVariants}
        initial="hidden"
        animate="show"
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
            <motion.div variants={cardVariants} whileHover={{ y: -2 }}>
              <StatCard label="Toplam sayfa" value={summary.totalPages.toLocaleString("tr-TR")} />
            </motion.div>
            <motion.div variants={cardVariants} whileHover={{ y: -2 }}>
              <StatCard label="Yayında blog yazısı" value={summary.publishedPosts.toLocaleString("tr-TR")} />
            </motion.div>
            <motion.div variants={cardVariants} whileHover={{ y: -2 }}>
              <StatCard
                label="Bu ay sayfa görüntüleme"
                value={summary.monthPageViews.toLocaleString("tr-TR")}
                delta={summary.pageViewsDelta}
              />
            </motion.div>
            <motion.div variants={cardVariants} whileHover={{ y: -2 }}>
              <StatCard
                label="Bu ay blog görüntüleme"
                value={summary.monthPostViews.toLocaleString("tr-TR")}
                delta={summary.postViewsDelta}
              />
            </motion.div>
          </>
        )}
      </motion.div>

      <div className="grid gap-4 lg:grid-cols-2">
        <VisitorChart />
        <ActivityBarChart />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <DeviceBreakdownChart />
        <CountryBreakdownList />
      </div>
    </div>
  );
}
