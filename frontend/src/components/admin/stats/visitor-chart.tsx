"use client";

import { motion } from "framer-motion";
import { Area, AreaChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useViewStats } from "@/hooks/use-stats";
import type { StatsRangeQuery } from "@/lib/api/stats";
import type { DailyViewStats } from "@/lib/api/types";
import { BarChart3 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";
import { ChartTooltipContent } from "@/components/admin/stats/chart-tooltip";

const dateFormatter = new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "short" });

function formatChartData(rows: DailyViewStats[]) {
  return rows.map((row) => ({
    ...row,
    label: dateFormatter.format(new Date(row.date)),
  }));
}

interface VisitorChartProps {
  /** Son kaç günün verisi çekilecek. Verilmezse mevcut varsayılan (30) korunur. */
  days?: number;
  /** Verilirse `days` yerine kullanılır — `/admin/stats/page.tsx`'teki tarih aralığı filtresi. */
  range?: StatsRangeQuery;
  /** Grafik başlığı altındaki alt metin — filtre bağlamına göre üst bileşen özelleştirebilir. */
  rangeLabel?: string;
}

export function VisitorChart({ days = 30, range, rangeLabel }: VisitorChartProps) {
  const query = useViewStats(range ?? { days });
  const data = query.data ?? null;
  const error = query.isError ? friendlyErrorMessage(query.error) : null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: "easeOut" }}
    >
      <Card>
        <h2 className="text-sm font-medium text-foreground">Görüntülenme trendi</h2>
        <p className="text-xs text-foreground/60">{rangeLabel ?? `Son ${days} gün`} · sayfa ve blog görüntülenmeleri</p>

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
          <div className="flex h-72 items-center justify-center">
            <Spinner className="h-6 w-6 text-primary" />
          </div>
        ) : data && data.every((d) => d.pageViews === 0 && d.postViews === 0) ? (
          <div className="flex h-72 items-center justify-center">
            <EmptyState
              icon={BarChart3}
              title="Henüz görüntülenme verisi yok"
              description="Seçili aralıkta sayfa veya blog görüntülenmesi kaydedilmedi."
              className="border-none p-0"
            />
          </div>
        ) : (
          <div className="mt-4 h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={formatChartData(data ?? [])} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                <defs>
                  <linearGradient id="pageViewsFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--viz-series-1)" stopOpacity={0.25} />
                    <stop offset="100%" stopColor="var(--viz-series-1)" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="postViewsFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--viz-series-2)" stopOpacity={0.25} />
                    <stop offset="100%" stopColor="var(--viz-series-2)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="0" />
                <XAxis
                  dataKey="label"
                  tick={{ fill: "var(--foreground)", opacity: 0.6, fontSize: 12 }}
                  tickLine={false}
                  axisLine={{ stroke: "var(--border)" }}
                />
                <YAxis
                  allowDecimals={false}
                  tick={{ fill: "var(--foreground)", opacity: 0.6, fontSize: 12 }}
                  tickLine={false}
                  axisLine={false}
                  width={40}
                />
                <Tooltip content={ChartTooltipContent} />
                <Legend iconType="plainline" wrapperStyle={{ fontSize: 12, color: "var(--foreground)" }} />
                <Area
                  type="monotone"
                  dataKey="pageViews"
                  name="Sayfa görüntüleme"
                  stroke="var(--viz-series-1)"
                  strokeWidth={2}
                  fill="url(#pageViewsFill)"
                  style={{ filter: "drop-shadow(0 0 6px var(--viz-series-1))" }}
                  dot={{ r: 3, strokeWidth: 0, fill: "var(--viz-series-1)" }}
                  activeDot={{ r: 5, style: { filter: "drop-shadow(0 0 6px var(--viz-series-1))" } }}
                />
                <Area
                  type="monotone"
                  dataKey="postViews"
                  name="Blog görüntüleme"
                  stroke="var(--viz-series-2)"
                  strokeWidth={2}
                  fill="url(#postViewsFill)"
                  style={{ filter: "drop-shadow(0 0 6px var(--viz-series-2))" }}
                  dot={{ r: 3, strokeWidth: 0, fill: "var(--viz-series-2)" }}
                  activeDot={{ r: 5, style: { filter: "drop-shadow(0 0 6px var(--viz-series-2))" } }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>
    </motion.div>
  );
}
