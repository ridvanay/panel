"use client";

import { motion } from "framer-motion";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CalendarClock } from "lucide-react";
import type { TelehealthOverview } from "@/lib/api/types";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { formatBucketLabel } from "@/lib/stats-range";
import { ChartTooltipContent } from "@/components/admin/stats/chart-tooltip";

interface TelehealthAppointmentsChartProps {
  data: TelehealthOverview;
  rangeLabel?: string;
}

/**
 * `activity-bar-chart.tsx`'teki Recharts kurulumu BİREBİR AYNI desende — tamamlanan vs iptal
 * edilen randevu sayısı, bucket bazında yan yana çubuklar.
 */
export function TelehealthAppointmentsChart({ data, rangeLabel }: TelehealthAppointmentsChartProps) {
  const chartData = data.series.map((point) => ({
    label: formatBucketLabel(point.date, data.granularity),
    completed: point.completedCount,
    cancelled: point.cancelledCount,
  }));
  const isEmpty = chartData.every((d) => d.completed === 0 && d.cancelled === 0);

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease: "easeOut", delay: 0.1 }}>
      <Card>
        <h2 className="text-sm font-medium text-foreground">Randevu Aktivitesi</h2>
        <p className="text-xs text-foreground/60">{rangeLabel ?? "Seçili aralık"} · tamamlanan / iptal edilen</p>

        {isEmpty ? (
          <div className="flex h-72 items-center justify-center">
            <EmptyState
              icon={CalendarClock}
              title="Henüz randevu aktivitesi yok"
              description="Seçili aralıkta tamamlanan veya iptal edilen randevu kaydedilmedi."
              className="border-none p-0"
            />
          </div>
        ) : (
          <div className="mt-4 h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                <defs>
                  <linearGradient id="telehealthCompletedFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--viz-series-1)" stopOpacity={0.95} />
                    <stop offset="100%" stopColor="var(--viz-series-1)" stopOpacity={0.35} />
                  </linearGradient>
                  <linearGradient id="telehealthCancelledFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--danger)" stopOpacity={0.9} />
                    <stop offset="100%" stopColor="var(--danger)" stopOpacity={0.35} />
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
                <Tooltip cursor={{ fill: "var(--primary)", opacity: 0.08 }} content={ChartTooltipContent} />
                <Legend iconType="plainline" wrapperStyle={{ fontSize: 12, color: "var(--foreground)" }} />
                <Bar dataKey="completed" name="Tamamlanan" fill="url(#telehealthCompletedFill)" radius={[6, 6, 0, 0]} maxBarSize={40} />
                <Bar dataKey="cancelled" name="İptal edilen" fill="url(#telehealthCancelledFill)" radius={[6, 6, 0, 0]} maxBarSize={40} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>
    </motion.div>
  );
}
