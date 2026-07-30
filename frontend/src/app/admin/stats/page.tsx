"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import * as statsApi from "@/lib/api/stats";
import { StatCard } from "@/components/admin/stats/stat-card";
import { VisitorChart } from "@/components/admin/stats/visitor-chart";
import { PageHeading } from "@/components/admin/page-heading";
import { Alert } from "@/components/ui/alert";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";
import { AlertCircle, BarChart3 } from "lucide-react";

interface Totals {
  pageViews: number;
  postViews: number;
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
  const [totals, setTotals] = useState<Totals | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const viewStats = await statsApi.getViewStats(30);
        setTotals({
          pageViews: viewStats.reduce((sum, row) => sum + row.pageViews, 0),
          postViews: viewStats.reduce((sum, row) => sum + row.postViews, 0),
        });
      } catch (err) {
        setError(friendlyErrorMessage(err));
      }
    })();
  }, []);

  return (
    <div className="space-y-6">
      <PageHeading
        icon={BarChart3}
        title="İstatistikler"
        description="Son 30 gün sayfa ve blog görüntülenme verileri."
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
        className="grid gap-4 sm:grid-cols-3"
        variants={statsContainerVariants}
        initial="hidden"
        animate="visible"
      >
        <motion.div variants={statsItemVariants}>
          <StatCard label="Sayfa görüntüleme" value={totals ? totals.pageViews.toLocaleString("tr-TR") : "—"} />
        </motion.div>
        <motion.div variants={statsItemVariants}>
          <StatCard label="Blog görüntüleme" value={totals ? totals.postViews.toLocaleString("tr-TR") : "—"} />
        </motion.div>
        <motion.div variants={statsItemVariants}>
          <StatCard
            label="Toplam görüntülenme"
            value={totals ? (totals.pageViews + totals.postViews).toLocaleString("tr-TR") : "—"}
          />
        </motion.div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.15 }}
      >
        <VisitorChart />
      </motion.div>
    </div>
  );
}
