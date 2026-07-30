"use client";

import { useEffect, useState, type ComponentType, type ReactNode } from "react";
import { motion } from "framer-motion";
import * as systemApi from "@/lib/api/system";
import type { SystemHealthDto } from "@/lib/api/types";
import { Card } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { Alert } from "@/components/ui/alert";
import { cn } from "@/lib/cn";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";
import { AlertCircle, Clock, Cpu, Database, Gauge, HardDrive, MemoryStick } from "lucide-react";

const POLL_INTERVAL_MS = 10000;

/** Bayt değerini otomatik olarak B/KB/MB/GB birimine çevirir. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unitIndex]}`;
}

/** Saniyeyi "X gün Y saat Z dakika" gibi okunaklı bir metne çevirir. */
function formatUptime(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return "—";
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);

  const parts: string[] = [];
  if (days > 0) parts.push(`${days} gün`);
  if (hours > 0) parts.push(`${hours} saat`);
  if (days === 0 && minutes > 0) parts.push(`${minutes} dakika`);
  if (parts.length === 0) parts.push("1 dakikadan az");

  return parts.join(" ");
}

function pingTone(ms: number): "success" | "warning" | "danger" {
  if (ms < 50) return "success";
  if (ms < 200) return "warning";
  return "danger";
}

const toneTextClasses: Record<"success" | "warning" | "danger", string> = {
  success: "text-success",
  warning: "text-amber-500 dark:text-amber-400",
  danger: "text-danger",
};

const toneBarClasses: Record<"success" | "warning" | "danger", string> = {
  success: "bg-success",
  warning: "bg-amber-500 dark:bg-amber-400",
  danger: "bg-danger",
};

interface MetricCardProps {
  icon: ComponentType<{ className?: string }>;
  label: string;
  children: ReactNode;
  note?: ReactNode;
}

function MetricCard({ icon: Icon, label, children, note }: MetricCardProps) {
  return (
    <Card className="space-y-3">
      <div className="flex items-center gap-2 text-foreground/60">
        <Icon className="h-4 w-4" />
        <p className="text-sm font-medium">{label}</p>
      </div>
      <div>{children}</div>
      {note && <p className="text-xs text-foreground/50">{note}</p>}
    </Card>
  );
}

function ProgressBar({ percent, tone = "primary" }: { percent: number; tone?: "primary" | "success" | "warning" | "danger" }) {
  const clamped = Math.min(100, Math.max(0, percent));
  const barClass = tone === "primary" ? "bg-primary" : toneBarClasses[tone];
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-surface-muted">
      <div className={cn("h-full rounded-full transition-all duration-500", barClass)} style={{ width: `${clamped}%` }} />
    </div>
  );
}

const gridVariants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.06 } },
};

const cardVariants = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0 },
};

export function HealthPanel() {
  const [health, setHealth] = useState<SystemHealthDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const result = await systemApi.getSystemHealth();
        if (!cancelled) {
          setHealth(result);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError(friendlyErrorMessage(err));
      }
    }

    poll();
    const interval = setInterval(poll, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  if (error && health === null) {
    return (
      <Alert variant="error">
        <span className="flex items-center gap-2">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
        </span>
      </Alert>
    );
  }

  if (health === null) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Spinner className="h-6 w-6 text-primary" />
      </div>
    );
  }

  const pingSeverity = pingTone(health.dbPingMs);
  const ramPercent = health.memoryTotalBytes > 0 ? (health.memoryUsedBytes / health.memoryTotalBytes) * 100 : 0;
  const isWindows = health.platform === "win32";
  const loadAverage1min = health.loadAverage[0];

  const dbQuotaPercent =
    health.dbQuotaBytes !== null && health.dbQuotaBytes > 0 ? (health.dbSizeBytes / health.dbQuotaBytes) * 100 : null;
  const mediaQuotaPercent =
    health.mediaStorageQuotaBytes !== null && health.mediaStorageQuotaBytes > 0
      ? (health.mediaStorageBytes / health.mediaStorageQuotaBytes) * 100
      : null;

  return (
    <div className="space-y-4">
      {error && (
        <Alert variant="error">
          <span className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {error} — son bilinen değerler gösteriliyor.
          </span>
        </Alert>
      )}

      <motion.div
        className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
        variants={gridVariants}
        initial="hidden"
        animate="show"
      >
        <motion.div variants={cardVariants}>
          <MetricCard icon={Gauge} label="Veritabanı Ping">
            <p className={cn("text-2xl font-semibold", toneTextClasses[pingSeverity])}>{health.dbPingMs} ms</p>
          </MetricCard>
        </motion.div>

        <motion.div variants={cardVariants}>
          <MetricCard icon={MemoryStick} label="RAM Kullanımı">
            <div className="space-y-2">
              <p className="text-2xl font-semibold text-foreground">%{ramPercent.toFixed(0)}</p>
              <ProgressBar percent={ramPercent} />
              <p className="text-xs text-foreground/50">
                {formatBytes(health.memoryUsedBytes)} / {formatBytes(health.memoryTotalBytes)}
              </p>
            </div>
          </MetricCard>
        </motion.div>

        <motion.div variants={cardVariants}>
          <MetricCard icon={MemoryStick} label="Bu Süreç (Process) Belleği">
            <p className="text-2xl font-semibold text-foreground">{formatBytes(health.processMemoryBytes)}</p>
          </MetricCard>
        </motion.div>

        <motion.div variants={cardVariants}>
          <MetricCard
            icon={Cpu}
            label="CPU Ortalama Yük (1 dk)"
            note={
              isWindows
                ? "Bu metrik Windows'ta Node.js API sınırlaması nedeniyle kullanılamıyor."
                : undefined
            }
          >
            <p className="text-2xl font-semibold text-foreground">{isWindows ? "—" : loadAverage1min.toFixed(2)}</p>
          </MetricCard>
        </motion.div>

        <motion.div variants={cardVariants}>
          <MetricCard icon={Database} label="Veritabanı Boyutu">
            <div className="space-y-2">
              <p className="text-2xl font-semibold text-foreground">{formatBytes(health.dbSizeBytes)}</p>
              {dbQuotaPercent !== null ? (
                <>
                  <ProgressBar percent={dbQuotaPercent} />
                  <p className="text-xs text-foreground/50">
                    {formatBytes(health.dbSizeBytes)} / {formatBytes(health.dbQuotaBytes as number)}
                  </p>
                </>
              ) : (
                <p className="text-xs text-foreground/50">Kota bilgisi mevcut değil.</p>
              )}
            </div>
          </MetricCard>
        </motion.div>

        <motion.div variants={cardVariants}>
          <MetricCard icon={HardDrive} label="Medya Depolama">
            <div className="space-y-2">
              <p className="text-2xl font-semibold text-foreground">{formatBytes(health.mediaStorageBytes)}</p>
              {mediaQuotaPercent !== null ? (
                <>
                  <ProgressBar percent={mediaQuotaPercent} />
                  <p className="text-xs text-foreground/50">
                    {formatBytes(health.mediaStorageBytes)} / {formatBytes(health.mediaStorageQuotaBytes as number)}
                  </p>
                </>
              ) : (
                <p className="text-xs text-foreground/50">Kota bilgisi mevcut değil.</p>
              )}
            </div>
          </MetricCard>
        </motion.div>

        <motion.div variants={cardVariants}>
          <MetricCard icon={Clock} label="Çalışma Süresi (Uptime)">
            <p className="text-2xl font-semibold text-foreground">{formatUptime(health.uptimeSeconds)}</p>
          </MetricCard>
        </motion.div>
      </motion.div>

      <p className="text-xs text-foreground/40">
        Son güncelleme: {new Date(health.checkedAt).toLocaleString("tr-TR")} · platform: {health.platform} · her{" "}
        {POLL_INTERVAL_MS / 1000} saniyede bir otomatik yenilenir.
      </p>
    </div>
  );
}
