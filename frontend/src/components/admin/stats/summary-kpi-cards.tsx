"use client";

import { motion } from "framer-motion";
import { AlertCircle } from "lucide-react";
import { useSummaryStats } from "@/hooks/use-stats";
import type { StatsRangeQuery } from "@/lib/api/stats";
import { StatCard } from "@/components/admin/stats/stat-card";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { computeDelta } from "@/lib/stats-summary";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";

const currencyFormatter = new Intl.NumberFormat("tr-TR", {
  style: "currency",
  currency: "TRY",
  maximumFractionDigits: 0,
});

function KpiCardSkeleton() {
  return (
    <Card className="space-y-3">
      <Skeleton className="h-4 w-24" />
      <Skeleton className="h-8 w-16" />
    </Card>
  );
}

const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.08 } },
};

const itemVariants = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.3 } },
};

interface SummaryKpiCardsProps {
  range: StatsRangeQuery;
}

/**
 * `GET /admin/stats/summary` — YALNIZCA ADMIN. Bu bileşen çağrıldığında istek atılır; EDITOR
 * oturumunda hiç MOUNT EDİLMEMELİDİR (403 gürültüsü/gereksiz istek — bkz. `admin/stats/page.tsx`
 * içindeki `isAdmin` koşullu render'ı, `enabled` bayrağı DEĞİL çünkü bu bileşen zaten koşullu
 * render altında).
 */
export function SummaryKpiCards({ range }: SummaryKpiCardsProps) {
  const query = useSummaryStats({ ...range, compare: true });

  if (query.isError) {
    return (
      <Alert variant="error">
        <span className="flex flex-wrap items-center justify-between gap-3">
          <span className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {friendlyErrorMessage(query.error)}
          </span>
          <Button type="button" variant="outline" size="sm" onClick={() => void query.refetch()}>
            Tekrar Dene
          </Button>
        </span>
      </Alert>
    );
  }

  const summary = query.data;

  return (
    <motion.div
      className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5"
      variants={containerVariants}
      initial="hidden"
      animate="visible"
    >
      {query.isPending || !summary ? (
        <>
          <KpiCardSkeleton />
          <KpiCardSkeleton />
          <KpiCardSkeleton />
          <KpiCardSkeleton />
          <KpiCardSkeleton />
        </>
      ) : (
        <>
          <motion.div variants={itemVariants}>
            <StatCard
              label="Sayfa görüntüleme"
              value={summary.pageViews.toLocaleString("tr-TR")}
              delta={computeDelta(summary.pageViews, summary.compare?.pageViews ?? 0)}
            />
          </motion.div>
          <motion.div variants={itemVariants}>
            <StatCard
              label="Blog görüntüleme"
              value={summary.postViews.toLocaleString("tr-TR")}
              delta={computeDelta(summary.postViews, summary.compare?.postViews ?? 0)}
            />
          </motion.div>
          <motion.div variants={itemVariants}>
            <StatCard
              label="Yeni kullanıcı"
              value={summary.newUsers.toLocaleString("tr-TR")}
              delta={computeDelta(summary.newUsers, summary.compare?.newUsers ?? 0)}
            />
          </motion.div>
          <motion.div variants={itemVariants}>
            <StatCard label="Aktif abonelik" value={summary.activeSubscriptions.toLocaleString("tr-TR")} />
          </motion.div>
          <motion.div variants={itemVariants}>
            <StatCard label="MRR" value={currencyFormatter.format(summary.mrrCents / 100)} />
          </motion.div>
        </>
      )}
    </motion.div>
  );
}
