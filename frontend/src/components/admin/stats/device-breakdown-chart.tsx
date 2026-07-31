"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import * as statsApi from "@/lib/api/stats";
import type { DeviceBreakdownItem, DeviceType } from "@/lib/api/types";
import { Card } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { Alert } from "@/components/ui/alert";
import { EmptyState } from "@/components/ui/empty-state";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";
import { PieChart as PieChartIcon } from "lucide-react";
import { ChartTooltipContent } from "@/components/admin/stats/chart-tooltip";

const DEVICE_LABELS: Record<DeviceType, string> = {
  MOBILE: "Mobil",
  DESKTOP: "Masaüstü",
  TABLET: "Tablet",
  UNKNOWN: "Bilinmiyor",
};

// Yeni hardcoded renk eklemek yerine mevcut dinamik accent/viz token'ları kullanılıyor.
const DEVICE_COLORS: Record<DeviceType, string> = {
  DESKTOP: "var(--viz-series-1)",
  MOBILE: "var(--viz-series-2)",
  TABLET: "var(--primary)",
  UNKNOWN: "var(--accent-400, #818cf8)",
};

interface DeviceBreakdownChartProps {
  /** Son kaç günün verisi çekilecek. Verilmezse mevcut varsayılan (30) korunur. */
  days?: number;
}

export function DeviceBreakdownChart({ days = 30 }: DeviceBreakdownChartProps) {
  const [devices, setDevices] = useState<DeviceBreakdownItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setDevices(null);
      setError(null);
      try {
        const breakdown = await statsApi.getBreakdown(days);
        setDevices(breakdown.devices);
      } catch (err) {
        setError(friendlyErrorMessage(err));
      }
    })();
  }, [days]);

  const total = devices?.reduce((sum, item) => sum + item.count, 0) ?? 0;
  // Tooltip/Legend'in Türkçe etiket gösterebilmesi için görsel katmanda
  // bir `label` alanı ekleniyor; API verisi/şekli değişmiyor.
  const chartData = devices?.map((item) => ({ ...item, label: DEVICE_LABELS[item.type] })) ?? [];

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: "easeOut" }}
    >
      <Card>
        <h3 className="text-sm font-medium text-foreground">Cihaz Dağılımı</h3>
        <p className="text-xs text-foreground/60">Son {days} gün · ziyaretçi cihaz türü</p>

        {error ? (
          <Alert variant="error" className="mt-4">
            {error}
          </Alert>
        ) : devices === null ? (
          <div className="flex h-64 items-center justify-center">
            <Spinner className="h-6 w-6 text-primary" />
          </div>
        ) : total === 0 ? (
          <EmptyState icon={PieChartIcon} title="Henüz veri yok" className="mt-4 border-none p-6" />
        ) : (
          <div className="mt-4 h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={chartData}
                  dataKey="count"
                  nameKey="label"
                  innerRadius={55}
                  outerRadius={85}
                  paddingAngle={2}
                >
                  {devices.map((item) => (
                    <Cell
                      key={item.type}
                      fill={DEVICE_COLORS[item.type]}
                      stroke="var(--surface)"
                      strokeWidth={2}
                      style={{ filter: `drop-shadow(0 0 4px ${DEVICE_COLORS[item.type]})` }}
                    />
                  ))}
                </Pie>
                <Tooltip content={ChartTooltipContent} />
                <Legend
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  formatter={(value: any, entry: any) => {
                    const payload = entry?.payload as DeviceBreakdownItem | undefined;
                    return payload ? DEVICE_LABELS[payload.type] : value;
                  }}
                  iconType="circle"
                  wrapperStyle={{ fontSize: 12, color: "var(--foreground)" }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>
    </motion.div>
  );
}
