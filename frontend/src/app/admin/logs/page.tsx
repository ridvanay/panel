"use client";

import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { AlertCircle, CheckCircle2, Download, ScrollText, ShieldAlert, XCircle } from "lucide-react";
import * as logsApi from "@/lib/api/logs";
import type { AuditLog, AuditStatus } from "@/lib/api/types";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeading } from "@/components/admin/page-heading";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";
import { cn } from "@/lib/utils";
import { exportToCsv } from "@/lib/export-csv";

const STATUS_LABELS: Record<AuditStatus, string> = {
  SUCCESS: "Başarılı",
  FAILURE: "Hatalı",
  FORBIDDEN: "İzin Reddedildi",
};

const dateFormatter = new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short" });

function formatDate(iso: string): string {
  return dateFormatter.format(new Date(iso));
}

const STATUS_FILTERS: Array<{ label: string; value: AuditStatus | undefined }> = [
  { label: "Tümü", value: undefined },
  { label: "Başarılı", value: "SUCCESS" },
  { label: "Hatalı", value: "FAILURE" },
  { label: "İzin Reddedildi", value: "FORBIDDEN" },
];

const STATUS_CONFIG: Record<AuditStatus, { icon: typeof CheckCircle2; className: string }> = {
  SUCCESS: { icon: CheckCircle2, className: "bg-success/10 text-success" },
  FAILURE: { icon: XCircle, className: "bg-danger/10 text-danger" },
  FORBIDDEN: { icon: ShieldAlert, className: "bg-amber-500/10 text-amber-500" },
};

const listContainerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.04 },
  },
};

const listItemVariants = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.2 } },
};

export default function AdminLogsPage() {
  const [logs, setLogs] = useState<AuditLog[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<AuditStatus | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(async (status: AuditStatus | undefined) => {
    setLogs(null);
    setError(null);
    try {
      const page = await logsApi.listAuditLogs({ status });
      setLogs(page.items);
      setNextCursor(page.meta.nextCursor);
    } catch (err) {
      setError(friendlyErrorMessage(err));
    }
  }, []);

  useEffect(() => {
    (async () => {
      await load(statusFilter);
    })();
  }, [statusFilter, load]);

  async function handleLoadMore() {
    if (!nextCursor) return;
    setLoadingMore(true);
    try {
      const page = await logsApi.listAuditLogs({ cursor: nextCursor, status: statusFilter });
      setLogs((prev) => [...(prev ?? []), ...page.items]);
      setNextCursor(page.meta.nextCursor);
    } catch (err) {
      setError(friendlyErrorMessage(err));
    } finally {
      setLoadingMore(false);
    }
  }

  function handleExport() {
    if (!logs || logs.length === 0) return;
    exportToCsv("aktivite-loglari.csv", logs, [
      { key: "createdAt", label: "Tarih", format: (value) => new Date(value as string).toLocaleString("tr-TR") },
      { key: "actorEmail", label: "Kullanıcı", format: (value) => (value as string | null) ?? "Sistem" },
      { key: "action", label: "Eylem" },
      { key: "status", label: "Durum", format: (value) => STATUS_LABELS[value as AuditStatus] },
      {
        key: "targetType",
        label: "Hedef",
        format: (value, row) => {
          const targetType = value as string | null;
          const targetId = row.targetId;
          if (!targetType && !targetId) return "";
          return `${targetType ?? ""}${targetId ? `#${targetId}` : ""}`;
        },
      },
      { key: "ipAddress", label: "IP Adresi", format: (value) => (value as string | null) ?? "" },
    ]);
  }

  return (
    <div className="space-y-6">
      <PageHeading
        icon={ScrollText}
        title="Aktivite ve Güvenlik Günlükleri"
        description="Sistemde kimin ne zaman ne yaptığının kaydı."
        actions={
          <Button
            variant="outline"
            onClick={handleExport}
            disabled={logs === null || logs.length === 0}
          >
            <Download className="h-4 w-4" />
            Dışa Aktar
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        {STATUS_FILTERS.map((filter) => (
          <Button
            key={filter.label}
            size="sm"
            variant={statusFilter === filter.value ? "default" : "outline"}
            onClick={() => setStatusFilter(filter.value)}
          >
            {filter.label}
          </Button>
        ))}
      </div>

      {error && (
        <Alert variant="error">
          <span className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {error}
          </span>
        </Alert>
      )}

      {logs === null ? (
        <div className="flex justify-center py-12">
          <Spinner className="h-6 w-6 text-primary" />
        </div>
      ) : logs.length === 0 ? (
        <EmptyState icon={ScrollText} title="Henüz kayıt yok" description="Bu filtreyle eşleşen bir aktivite bulunamadı." />
      ) : (
        <>
          <Card className="overflow-hidden p-0">
            <motion.div
              className="divide-y divide-border"
              variants={listContainerVariants}
              initial="hidden"
              animate="visible"
            >
              {logs.map((log) => {
                const config = STATUS_CONFIG[log.status];
                const Icon = config.icon;
                const hasTarget = Boolean(log.targetType || log.targetId);
                return (
                  <motion.div key={log.id} variants={listItemVariants} className="flex items-start gap-3 p-4">
                    <span
                      className={cn(
                        "mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
                        config.className
                      )}
                    >
                      <Icon className="h-4 w-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="truncate text-sm font-medium text-foreground">{log.action}</p>
                        <span className="shrink-0 text-xs text-foreground/50">{formatDate(log.createdAt)}</span>
                      </div>
                      <p className="mt-0.5 truncate text-xs text-foreground/60">
                        {log.actorEmail ?? "Sistem"}
                        {log.ipAddress && <span className="text-foreground/40"> · {log.ipAddress}</span>}
                      </p>
                      {hasTarget && (
                        <p className="mt-1 truncate text-xs text-foreground/40">
                          Hedef: {log.targetType ?? "-"}
                          {log.targetId ? ` #${log.targetId}` : ""}
                        </p>
                      )}
                    </div>
                  </motion.div>
                );
              })}
            </motion.div>
          </Card>

          {nextCursor && (
            <div className="flex justify-center">
              <Button variant="outline" loading={loadingMore} onClick={handleLoadMore}>
                Daha fazla yükle
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
