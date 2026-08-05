"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertCircle, AlertTriangle, CheckCircle2, Info, SkipForward, XCircle } from "lucide-react";
import * as importApi from "@/lib/api/import";
import type { ImportJob, ImportJobError } from "@/lib/api/types";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";

const dateFormatter = new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short" });

function formatDate(iso: string): string {
  return dateFormatter.format(new Date(iso));
}

const STATUS_CONFIG: Record<ImportJob["status"], { icon: typeof CheckCircle2; className: string; label: string }> = {
  PENDING: { icon: Info, className: "text-foreground/60", label: "Onay bekliyor" },
  QUEUED: { icon: Info, className: "text-foreground/60", label: "Kuyrukta" },
  PROCESSING: { icon: Info, className: "text-primary", label: "İşleniyor" },
  COMPLETED: { icon: CheckCircle2, className: "text-success", label: "Tamamlandı" },
  FAILED: { icon: XCircle, className: "text-danger", label: "Başarısız" },
  CANCELLED: { icon: AlertTriangle, className: "text-foreground/60", label: "İptal edildi" },
};

interface ImportReportPanelProps {
  job: ImportJob;
}

/**
 * `status: COMPLETED | FAILED | CANCELLED` iken gösterilen özet rapor — "150 kayıttan 147
 * başarılı, 3 hata" + satır-bazlı hata/atlama listesi (`GET .../errors`, cursor sayfalı,
 * bkz. openapi.yaml). Atlanan (`skipped`) satırlar da aynı listede, `severity` ile ayrılır.
 */
export function ImportReportPanel({ job }: ImportReportPanelProps) {
  const config = STATUS_CONFIG[job.status];
  const Icon = config.icon;

  const [errors, setErrors] = useState<ImportJobError[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const hasRowIssues = job.errorCount > 0 || job.skippedCount > 0;

  const load = useCallback(async () => {
    setErrors(null);
    setError(null);
    try {
      const page = await importApi.listImportJobErrors(job.id, {});
      setErrors(page.items);
      setNextCursor(page.meta.nextCursor);
      setTruncated(page.meta.truncated ?? false);
    } catch (err) {
      setError(friendlyErrorMessage(err));
    }
  }, [job.id]);

  useEffect(() => {
    if (!hasRowIssues) return;
    (async () => {
      await load();
    })();
  }, [hasRowIssues, load]);

  async function handleLoadMore() {
    if (!nextCursor) return;
    setLoadingMore(true);
    try {
      const page = await importApi.listImportJobErrors(job.id, { cursor: nextCursor });
      setErrors((prev) => [...(prev ?? []), ...page.items]);
      setNextCursor(page.meta.nextCursor);
      setTruncated(page.meta.truncated ?? false);
    } catch (err) {
      setError(friendlyErrorMessage(err));
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <div className="space-y-6">
      <Card className="space-y-3">
        <div className="flex items-center gap-2">
          <Icon className={`h-5 w-5 ${config.className}`} aria-hidden="true" />
          <h2 className="admin-h2">{config.label}</h2>
        </div>

        {job.status === "FAILED" && job.errorSummary && (
          <Alert variant="error">{job.errorSummary}</Alert>
        )}

        <p className="admin-body">
          <strong className="text-foreground">{job.totalCount}</strong> kayıttan{" "}
          <strong className="text-success">{job.successCount}</strong> başarılı,{" "}
          <strong className="text-danger">{job.errorCount}</strong> hata
          {job.skippedCount > 0 && (
            <>
              , <strong className="text-warning">{job.skippedCount}</strong> atlandı
            </>
          )}
          .
        </p>

        {job.status === "COMPLETED" && (
          <p className="admin-text-secondary">
            İçe aktarılan içeriği geri almak isterseniz ilgili listeden toplu seçip çöpe taşıyabilirsiniz
            (geri alma v1 kapsamında otomatik değildir).
          </p>
        )}
      </Card>

      {hasRowIssues && (
        <Card className="space-y-3 p-0">
          <div className="flex flex-wrap items-center justify-between gap-2 p-4 pb-0">
            <div>
              <h3 className="admin-h3">Satır Bazlı Hatalar ve Atlamalar</h3>
              <p className="admin-text-secondary">Kaynak dosyadaki satır numarasıyla eşleşir.</p>
            </div>
            {truncated && (
              <Badge tone="warning">
                <AlertCircle className="h-3.5 w-3.5" />
                1.000 satır sınırı aşıldı, bazı kayıtlar gösterilmiyor
              </Badge>
            )}
          </div>

          {error && (
            <div className="px-4">
              <Alert variant="error">
                <span className="flex flex-wrap items-center justify-between gap-3">
                  {error}
                  <Button type="button" variant="outline" size="sm" onClick={() => void load()}>
                    Tekrar Dene
                  </Button>
                </span>
              </Alert>
            </div>
          )}

          {errors === null ? (
            <div className="flex justify-center py-8">
              <span className="text-sm text-foreground/50">Yükleniyor…</span>
            </div>
          ) : errors.length === 0 ? (
            <div className="p-4">
              <EmptyState icon={CheckCircle2} title="Hata satırı bulunamadı" />
            </div>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-16">Satır</TableHead>
                    <TableHead className="w-28">Tür</TableHead>
                    <TableHead>Neden</TableHead>
                    <TableHead>Alan</TableHead>
                    <TableHead>Kaynak</TableHead>
                    <TableHead className="text-right">Tarih</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {errors.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="font-medium text-foreground">{row.rowNumber}</TableCell>
                      <TableCell>
                        <Badge tone={row.severity === "error" ? "danger" : "warning"}>
                          {row.severity === "error" ? (
                            <>
                              <XCircle className="h-3 w-3" /> Hata
                            </>
                          ) : (
                            <>
                              <SkipForward className="h-3 w-3" /> Atlandı
                            </>
                          )}
                        </Badge>
                      </TableCell>
                      <TableCell className="max-w-[320px] whitespace-normal text-foreground/80">{row.message}</TableCell>
                      <TableCell className="text-foreground/60">{row.field ?? "—"}</TableCell>
                      <TableCell className="max-w-[160px] truncate text-foreground/60" title={row.sourceRef ?? undefined}>
                        {row.sourceRef ?? "—"}
                      </TableCell>
                      <TableCell className="text-right text-foreground/50">{formatDate(row.createdAt)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              {nextCursor && (
                <div className="flex justify-center p-4 pt-0">
                  <Button variant="outline" size="sm" loading={loadingMore} onClick={handleLoadMore}>
                    Daha fazla yükle
                  </Button>
                </div>
              )}
            </>
          )}
        </Card>
      )}
    </div>
  );
}
