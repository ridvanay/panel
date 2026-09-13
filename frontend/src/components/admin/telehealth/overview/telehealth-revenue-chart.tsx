"use client";

import { motion } from "framer-motion";
import { Area, AreaChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CircleDollarSign } from "lucide-react";
import type { TelehealthOverview, TelehealthOverviewSeriesPoint } from "@/lib/api/types";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { formatBucketLabel } from "@/lib/stats-range";
import { formatPriceFromCents } from "@/lib/format-price";
import { ChartTooltipContent } from "@/components/admin/stats/chart-tooltip";

interface TelehealthRevenueChartProps {
  data: TelehealthOverview;
  rangeLabel?: string;
}

interface RevenueChartDatum {
  label: string;
  gross: number;
  commission: number;
  net: number;
}

function toChartData(series: TelehealthOverviewSeriesPoint[], granularity: TelehealthOverview["granularity"]): RevenueChartDatum[] {
  return series.map((point) => ({
    label: formatBucketLabel(point.date, granularity),
    gross: point.grossCents / 100,
    commission: point.commissionCents / 100,
    net: point.netCents / 100,
  }));
}

/**
 * `revenue-stats-panel.tsx`'teki Recharts kurulumu (`ResponsiveContainer`/`ChartTooltipContent`/
 * renk paleti/`Card` çerçevesi) BİREBİR AYNI desende — yalnızca üç seri (brüt/net/komisyon).
 */
export function TelehealthRevenueChart({ data, rangeLabel }: TelehealthRevenueChartProps) {
  const chartData = toChartData(data.series, data.granularity);
  const isEmpty = chartData.every((d) => d.gross === 0 && d.commission === 0 && d.net === 0);
  const currencyFormatter = (value: number) => formatPriceFromCents(Math.round(value * 100), data.currency);

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease: "easeOut" }}>
      <Card>
        <h2 className="text-sm font-medium text-foreground">Gelir Trendi</h2>
        <p className="text-xs text-foreground/60">{rangeLabel ?? "Seçili aralık"} · brüt / net / komisyon</p>

        {isEmpty ? (
          <div className="flex h-64 items-center justify-center">
            <EmptyState
              icon={CircleDollarSign}
              title="Henüz gelir hareketi yok"
              description="Seçili aralıkta tamamlanmış seans bulunmuyor."
              className="border-none p-0"
            />
          </div>
        ) : (
          <div className="mt-4 h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                <defs>
                  <linearGradient id="telehealthGrossFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--viz-series-1)" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="var(--viz-series-1)" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="telehealthNetFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--viz-series-2)" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="var(--viz-series-2)" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="telehealthCommissionFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--danger)" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="var(--danger)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="0" />
                <XAxis dataKey="label" tick={{ fill: "var(--foreground)", opacity: 0.6, fontSize: 12 }} tickLine={false} axisLine={{ stroke: "var(--border)" }} />
                <YAxis
                  allowDecimals={false}
                  tick={{ fill: "var(--foreground)", opacity: 0.6, fontSize: 12 }}
                  tickLine={false}
                  axisLine={false}
                  width={56}
                  tickFormatter={currencyFormatter}
                />
                <Tooltip content={ChartTooltipContent} />
                <Legend iconType="plainline" wrapperStyle={{ fontSize: 12, color: "var(--foreground)" }} />
                <Area
                  type="monotone"
                  dataKey="gross"
                  name="Brüt"
                  stroke="var(--viz-series-1)"
                  strokeWidth={2}
                  fill="url(#telehealthGrossFill)"
                  dot={{ r: 3, strokeWidth: 0, fill: "var(--viz-series-1)" }}
                />
                <Area
                  type="monotone"
                  dataKey="net"
                  name="Net"
                  stroke="var(--viz-series-2)"
                  strokeWidth={2}
                  fill="url(#telehealthNetFill)"
                  dot={{ r: 3, strokeWidth: 0, fill: "var(--viz-series-2)" }}
                />
                <Area
                  type="monotone"
                  dataKey="commission"
                  name="Komisyon"
                  stroke="var(--danger)"
                  strokeWidth={2}
                  fill="url(#telehealthCommissionFill)"
                  dot={{ r: 3, strokeWidth: 0, fill: "var(--danger)" }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>
    </motion.div>
  );
}
