"use client";

import { useEffect, useState } from "react";
import * as pagesApi from "@/lib/api/pages";
import * as blogApi from "@/lib/api/blog";
import * as statsApi from "@/lib/api/stats";
import { StatCard } from "@/components/admin/stats/stat-card";
import { VisitorChart } from "@/components/admin/stats/visitor-chart";
import { Alert } from "@/components/ui/alert";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";

interface Summary {
  totalPages: number;
  publishedPosts: number;
  monthPageViews: number;
  monthPostViews: number;
}

function isSameMonth(dateKey: string, reference: Date): boolean {
  const [year, month] = dateKey.split("-").map(Number);
  return year === reference.getUTCFullYear() && month === reference.getUTCMonth() + 1;
}

export default function AdminDashboardPage() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [pages, posts, viewStats] = await Promise.all([
          pagesApi.listPages(),
          blogApi.listPosts(),
          statsApi.getViewStats(30),
        ]);

        const now = new Date();
        const monthStats = viewStats.filter((row) => isSameMonth(row.date, now));

        setSummary({
          totalPages: pages.items.length,
          publishedPosts: posts.items.filter((post) => post.status === "PUBLISHED").length,
          monthPageViews: monthStats.reduce((sum, row) => sum + row.pageViews, 0),
          monthPostViews: monthStats.reduce((sum, row) => sum + row.postViews, 0),
        });
      } catch (err) {
        setError(friendlyErrorMessage(err));
      }
    })();
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Genel Bakış</h1>
        <p className="mt-1 text-sm text-foreground/60">Sitenizin son durumu.</p>
      </div>

      {error && <Alert variant="error">{error}</Alert>}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Toplam sayfa" value={summary ? summary.totalPages.toLocaleString("tr-TR") : "—"} />
        <StatCard label="Yayında blog yazısı" value={summary ? summary.publishedPosts.toLocaleString("tr-TR") : "—"} />
        <StatCard label="Bu ay sayfa görüntüleme" value={summary ? summary.monthPageViews.toLocaleString("tr-TR") : "—"} />
        <StatCard label="Bu ay blog görüntüleme" value={summary ? summary.monthPostViews.toLocaleString("tr-TR") : "—"} />
      </div>

      <VisitorChart />
    </div>
  );
}
