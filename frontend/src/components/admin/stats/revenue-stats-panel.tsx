"use client";

import { motion } from "framer-motion";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis, Area, AreaChart } from "recharts";
import { CircleDollarSign, TrendingDown } from "lucide-react";
import { useRevenueStats } from "@/hooks/use-stats";
import type { StatsRangeQuery } from "@/lib/api/stats";
import { formatBucketLabel } from "@/lib/stats-range";
import { Card } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";
import { ChartTooltipContent } from "@/components/admin/stats/chart-tooltip";

const currencyFormatter = new Intl.NumberFormat("tr-TR", {
  style: "currency",
  currency: "TRY",
  maximumFractionDigits: 0,
});

interface RevenueStatsPanelProps {
  range: StatsRangeQuery;
  rangeLabel?: string;
}

/** `GET /admin/stats/revenue` — YALNIZCA ADMIN. Yeni MRR zaman serisi + churn (bucket içi iptal sayısı). */
export function RevenueStatsPanel({ range, rangeLabel }: RevenueStatsPanelProps) {
  const query = useRevenueStats(range);
  const data = query.data;
  const error = query.isError ? friendlyErrorMessage(query.error) : null;

  const chartData = data?.series.map((point) => ({
    ...point,
    label: formatBucketLabel(point.date, data.granularity),
    newMrr: point.newMrrCents / 100,
  }));

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease: "easeOut" }}>
        <Card>
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-medium text-foreground">MRR Trendi</h2>
              <p className="text-xs text-foreground/60">{rangeLabel ?? "Seçili aralık"} · dönem içinde oluşan yeni MRR</p>
            </div>
            {data && (
              <div className="text-right">
                <p className="text-xs text-foreground/50">Anlık MRR</p>
                <p className="text-sm font-semibold text-foreground">{currencyFormatter.format(data.mrrCents / 100)}</p>
              </div>
            )}
          </div>

          {error ? (
            <Alert variant="error" className="mt-4">
              <span className="flex flex-wrap items-center justify-between gap-3">
                {error}
                <Button type="button" variant="outline" size="sm" onClick={() => void query.refetch()}>
                  Tekrar Dene
                </Button>
              </span>
            </Alert>
          ) : query.isPending ? (
            <div className="flex h-64 items-center justify-center">
              <Spinner className="h-6 w-6 text-primary" />
            </div>
          ) : !chartData || chartData.every((d) => d.newMrr === 0) ? (
            <div className="flex h-64 items-center justify-center">
              <EmptyState
                icon={CircleDollarSign}
                title="Henüz gelir hareketi yok"
                description="Seçili aralıkta yeni abonelik oluşmadı."
                className="border-none p-0"
              />
            </div>
          ) : (
            <div className="mt-4 h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                  <defs>
                    <linearGradient id="newMrrFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--viz-series-2)" stopOpacity={0.3} />
                      <stop offset="100%" stopColor="var(--viz-series-2)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="0" />
                  <XAxis dataKey="label" tick={{ fill: "var(--foreground)", opacity: 0.6, fontSize: 12 }} tickLine={false} axisLine={{ stroke: "var(--border)" }} />
                  <YAxis
                    allowDecimals={false}
                    tick={{ fill: "var(--foreground)", opacity: 0.6, fontSize: 12 }}
                    tickLine={false}
                    axisLine={false}
                    width={48}
                    tickFormatter={(value: number) => currencyFormatter.format(value)}
                  />
                  <Tooltip content={ChartTooltipContent} />
                  <Area
                    type="monotone"
                    dataKey="newMrr"
                    name="Yeni MRR"
                    stroke="var(--viz-series-2)"
                    strokeWidth={2}
                    fill="url(#newMrrFill)"
                    dot={{ r: 3, strokeWidth: 0, fill: "var(--viz-series-2)" }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease: "easeOut", delay: 0.1 }}>
        <Card>
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-medium text-foreground">Abonelik İptalleri (Churn)</h2>
              <p className="text-xs text-foreground/60">{rangeLabel ?? "Seçili aralık"} · dönem içinde iptal edilen abonelik</p>
            </div>
            {data && (
              <div className="text-right">
                <p className="text-xs text-foreground/50">Aktif abonelik</p>
                <p className="text-sm font-semibold text-foreground">{data.activeSubscriptions.toLocaleString("tr-TR")}</p>
              </div>
            )}
          </div>

          {error ? (
            <Alert variant="error" className="mt-4">
              {error}
            </Alert>
          ) : query.isPending ? (
            <div className="flex h-64 items-center justify-center">
              <Spinner className="h-6 w-6 text-primary" />
            </div>
          ) : !chartData || chartData.every((d) => d.churnedCount === 0) ? (
            <div className="flex h-64 items-center justify-center">
              <EmptyState icon={TrendingDown} title="Henüz iptal yok" description="Seçili aralıkta iptal edilen abonelik yok." className="border-none p-0" />
            </div>
          ) : (
            <div className="mt-4 h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                  <defs>
                    <linearGradient id="churnFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--danger)" stopOpacity={0.9} />
                      <stop offset="100%" stopColor="var(--danger)" stopOpacity={0.35} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="0" />
                  <XAxis dataKey="label" tick={{ fill: "var(--foreground)", opacity: 0.6, fontSize: 12 }} tickLine={false} axisLine={{ stroke: "var(--border)" }} />
                  <YAxis allowDecimals={false} tick={{ fill: "var(--foreground)", opacity: 0.6, fontSize: 12 }} tickLine={false} axisLine={false} width={32} />
                  <Tooltip cursor={{ fill: "var(--danger)", opacity: 0.08 }} content={ChartTooltipContent} />
                  <Legend iconType="plainline" wrapperStyle={{ fontSize: 12, color: "var(--foreground)" }} />
                  <Bar dataKey="churnedCount" name="İptal edilen abonelik" fill="url(#churnFill)" radius={[6, 6, 0, 0]} maxBarSize={40} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>
      </motion.div>
    </div>
  );
}
