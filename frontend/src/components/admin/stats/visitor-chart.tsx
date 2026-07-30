"use client";

import { Area, AreaChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card } from "@/components/ui/card";

// TODO: Prisma `PageView` modeli hazır olduğunda gerçek /admin/stats API verisiyle değiştirilecek.
const mockData = [
  { date: "1 Tem", visitors: 320, pageviews: 540 },
  { date: "5 Tem", visitors: 410, pageviews: 690 },
  { date: "10 Tem", visitors: 380, pageviews: 610 },
  { date: "15 Tem", visitors: 512, pageviews: 840 },
  { date: "20 Tem", visitors: 470, pageviews: 790 },
  { date: "25 Tem", visitors: 590, pageviews: 960 },
  { date: "29 Tem", visitors: 640, pageviews: 1040 },
];

export function VisitorChart() {
  return (
    <Card>
      <h3 className="text-sm font-medium text-foreground">Ziyaretçi trendi</h3>
      <p className="text-xs text-foreground/60">Son 30 gün · benzersiz ziyaretçi ve sayfa görüntüleme</p>

      <div className="mt-4 h-72 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={mockData} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
            <defs>
              <linearGradient id="visitorsFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--viz-series-1)" stopOpacity={0.1} />
                <stop offset="100%" stopColor="var(--viz-series-1)" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="pageviewsFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--viz-series-2)" stopOpacity={0.1} />
                <stop offset="100%" stopColor="var(--viz-series-2)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="0" />
            <XAxis
              dataKey="date"
              tick={{ fill: "var(--foreground)", opacity: 0.6, fontSize: 12 }}
              tickLine={false}
              axisLine={{ stroke: "var(--border)" }}
            />
            <YAxis
              tick={{ fill: "var(--foreground)", opacity: 0.6, fontSize: 12 }}
              tickLine={false}
              axisLine={false}
              width={40}
            />
            <Tooltip
              contentStyle={{
                background: "var(--surface)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                fontSize: 12,
              }}
              labelStyle={{ color: "var(--foreground)" }}
            />
            <Legend
              iconType="plainline"
              wrapperStyle={{ fontSize: 12, color: "var(--foreground)" }}
            />
            <Area
              type="monotone"
              dataKey="visitors"
              name="Ziyaretçi"
              stroke="var(--viz-series-1)"
              strokeWidth={2}
              fill="url(#visitorsFill)"
            />
            <Area
              type="monotone"
              dataKey="pageviews"
              name="Sayfa görüntüleme"
              stroke="var(--viz-series-2)"
              strokeWidth={2}
              fill="url(#pageviewsFill)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}
