"use client";

import { motion } from "framer-motion";
import { Area, AreaChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AlertCircle, PieChart as PieChartIcon, Users } from "lucide-react";
import { useUsersStats } from "@/hooks/use-stats";
import type { StatsRangeQuery } from "@/lib/api/stats";
import type { SiteRole } from "@/lib/api/types";
import { formatBucketLabel } from "@/lib/stats-range";
import { Card } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";
import { ChartTooltipContent } from "@/components/admin/stats/chart-tooltip";

// `.claude/architect-scope-rbac-5-tier.md` §1.2 — bağlayıcı TR etiketler.
const ROLE_LABELS: Record<SiteRole, string> = {
  ADMIN: "Süper Yönetici",
  MANAGER: "Yönetici",
  EDITOR: "Editör",
  CUSTOMER: "Müşteri",
  USER: "Standart Üye",
};

// Yeni hardcoded renk eklemek yerine mevcut dinamik accent/viz token'ları kullanılıyor (bkz.
// device-breakdown-chart.tsx'teki AYNI patern — 4/5 kategoriye çıkarken yeni bir renk İCAT
// EDİLMEDİ, sırayla viz-series-1/2 → primary → accent-400 → accent-300 zincirine devam edildi).
const ROLE_COLORS: Record<SiteRole, string> = {
  ADMIN: "var(--viz-series-1)",
  MANAGER: "var(--viz-series-2)",
  EDITOR: "var(--primary)",
  CUSTOMER: "var(--accent-400, #818cf8)",
  USER: "var(--accent-300, #a5b4fc)",
};

interface UsersStatsPanelProps {
  range: StatsRangeQuery;
  rangeLabel?: string;
}

/** `GET /admin/stats/users` — YALNIZCA ADMIN. Kayıt trendi (zaman serisi) + rol dağılımı (anlık). */
export function UsersStatsPanel({ range, rangeLabel }: UsersStatsPanelProps) {
  const query = useUsersStats(range);
  const data = query.data;
  const error = query.isError ? friendlyErrorMessage(query.error) : null;

  const chartData = data?.series.map((point) => ({
    ...point,
    label: formatBucketLabel(point.date, data.granularity),
  }));

  const roleData = data?.roleDistribution.map((item) => ({ ...item, label: ROLE_LABELS[item.role] })) ?? [];
  const totalUsers = roleData.reduce((sum, item) => sum + item.count, 0);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease: "easeOut" }}>
        <Card>
          <h2 className="text-sm font-medium text-foreground">Kullanıcı Kayıt Trendi</h2>
          <p className="text-xs text-foreground/60">{rangeLabel ?? "Seçili aralık"} · yeni kayıt sayısı</p>

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
          ) : !chartData || chartData.every((d) => d.count === 0) ? (
            <div className="flex h-64 items-center justify-center">
              <EmptyState icon={Users} title="Henüz kayıt yok" description="Seçili aralıkta yeni kullanıcı kaydı yok." className="border-none p-0" />
            </div>
          ) : (
            <div className="mt-4 h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                  <defs>
                    <linearGradient id="newUsersFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--viz-series-1)" stopOpacity={0.3} />
                      <stop offset="100%" stopColor="var(--viz-series-1)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="0" />
                  <XAxis dataKey="label" tick={{ fill: "var(--foreground)", opacity: 0.6, fontSize: 12 }} tickLine={false} axisLine={{ stroke: "var(--border)" }} />
                  <YAxis allowDecimals={false} tick={{ fill: "var(--foreground)", opacity: 0.6, fontSize: 12 }} tickLine={false} axisLine={false} width={32} />
                  <Tooltip content={ChartTooltipContent} />
                  <Area
                    type="monotone"
                    dataKey="count"
                    name="Yeni kullanıcı"
                    stroke="var(--viz-series-1)"
                    strokeWidth={2}
                    fill="url(#newUsersFill)"
                    dot={{ r: 3, strokeWidth: 0, fill: "var(--viz-series-1)" }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease: "easeOut", delay: 0.1 }}>
        <Card>
          <h2 className="text-sm font-medium text-foreground">Rol Dağılımı</h2>
          <p className="text-xs text-foreground/60">Anlık · tüm kullanıcı tablosu (dönemle sınırlı değil)</p>

          {error ? (
            <Alert variant="error" className="mt-4">
              <span className="flex items-center gap-2">
                <AlertCircle className="h-4 w-4 shrink-0" />
                {error}
              </span>
            </Alert>
          ) : query.isPending ? (
            <div className="flex h-64 items-center justify-center">
              <Spinner className="h-6 w-6 text-primary" />
            </div>
          ) : totalUsers === 0 ? (
            <EmptyState icon={PieChartIcon} title="Henüz veri yok" className="mt-4 border-none p-6" />
          ) : (
            <div className="mt-4 h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={roleData} dataKey="count" nameKey="label" innerRadius={55} outerRadius={85} paddingAngle={2}>
                    {roleData.map((item) => (
                      <Cell key={item.role} fill={ROLE_COLORS[item.role]} stroke="var(--surface)" strokeWidth={2} />
                    ))}
                  </Pie>
                  <Tooltip content={ChartTooltipContent} />
                  <Legend iconType="circle" wrapperStyle={{ fontSize: 12, color: "var(--foreground)" }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>
      </motion.div>
    </div>
  );
}
