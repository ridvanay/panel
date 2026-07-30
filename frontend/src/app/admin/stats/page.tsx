"use client";

import { useEffect, useState } from "react";
import * as statsApi from "@/lib/api/stats";
import { StatCard } from "@/components/admin/stats/stat-card";
import { VisitorChart } from "@/components/admin/stats/visitor-chart";
import { Alert } from "@/components/ui/alert";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";

interface Totals {
  pageViews: number;
  postViews: number;
}

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
      <div>
        <h1 className="text-2xl font-semibold text-foreground">İstatistikler</h1>
        <p className="mt-1 text-sm text-foreground/60">Son 30 gün sayfa ve blog görüntülenme verileri.</p>
      </div>

      {error && <Alert variant="error">{error}</Alert>}

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Sayfa görüntüleme" value={totals ? totals.pageViews.toLocaleString("tr-TR") : "—"} />
        <StatCard label="Blog görüntüleme" value={totals ? totals.postViews.toLocaleString("tr-TR") : "—"} />
        <StatCard
          label="Toplam görüntülenme"
          value={totals ? (totals.pageViews + totals.postViews).toLocaleString("tr-TR") : "—"}
        />
      </div>

      <VisitorChart />
    </div>
  );
}
