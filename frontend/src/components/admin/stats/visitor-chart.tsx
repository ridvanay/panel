"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Area, AreaChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import * as statsApi from "@/lib/api/stats";
import type { DailyViewStats } from "@/lib/api/types";
import { Card } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { Alert } from "@/components/ui/alert";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";
import { ChartTooltipContent } from "@/components/admin/stats/chart-tooltip";

const dateFormatter = new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "short" });

function formatChartData(rows: DailyViewStats[]) {
  return rows.map((row) => ({
    ...row,
    label: dateFormatter.format(new Date(row.date)),
  }));
}

export function VisitorChart() {
  const [data, setData] = useState<DailyViewStats[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        setData(await statsApi.getViewStats(30));
      } catch (err) {
        setError(friendlyErrorMessage(err));
      }
    })();
  }, []);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: "easeOut" }}
    >
      <Card>
        <h3 className="text-sm font-medium text-foreground">Görüntülenme trendi</h3>
        <p className="text-xs text-foreground/60">Son 30 gün · sayfa ve blog görüntülenmeleri</p>

        {error ? (
          <Alert variant="error" className="mt-4">
            {error}
          </Alert>
        ) : data === null ? (
          <div className="flex h-72 items-center justify-center">
            <Spinner className="h-6 w-6 text-primary" />
          </div>
        ) : (
          <div className="mt-4 h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={formatChartData(data)} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
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
