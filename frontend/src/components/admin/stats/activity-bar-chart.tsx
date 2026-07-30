"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import * as statsApi from "@/lib/api/stats";
import type { DailyViewStats } from "@/lib/api/types";
import { Card } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { Alert } from "@/components/ui/alert";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";

const dateFormatter = new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "short" });

interface ActivityDatum {
  label: string;
  total: number;
}

function formatActivityData(rows: DailyViewStats[]): ActivityDatum[] {
  return rows.map((row) => ({
    label: dateFormatter.format(new Date(row.date)),
    total: row.pageViews + row.postViews,
  }));
}

export function ActivityBarChart() {
  const [data, setData] = useState<DailyViewStats[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        setData(await statsApi.getViewStats(7));
      } catch (err) {
        setError(friendlyErrorMessage(err));
      }
    })();
  }, []);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: "easeOut", delay: 0.1 }}
    >
      <Card>
        <h3 className="text-sm font-medium text-foreground">Haftalık aktivite</h3>
        <p className="text-xs text-foreground/60">Son 7 gün · toplam görüntülenme</p>

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
              <BarChart data={formatActivityData(data)} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                <defs>
                  <linearGradient id="activityFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--viz-series-1)" stopOpacity={0.95} />
                    <stop offset="100%" stopColor="var(--viz-series-1)" stopOpacity={0.35} />
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
                <Tooltip
                  cursor={{ fill: "var(--primary)", opacity: 0.08 }}
                  contentStyle={{
                    background: "var(--surface)",
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                  labelStyle={{ color: "var(--foreground)" }}
                />
                <Bar
                  dataKey="total"
                  name="Toplam görüntülenme"
                  fill="url(#activityFill)"
                  radius={[6, 6, 0, 0]}
                  maxBarSize={48}
                  style={{ filter: "drop-shadow(0 0 8px var(--viz-series-1))" }}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>
    </motion.div>
  );
}
