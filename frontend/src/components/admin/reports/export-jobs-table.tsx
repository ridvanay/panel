"use client";

import { toast } from "sonner";
import { AlertCircle, Download, FileArchive, Lock } from "lucide-react";
import { flattenExportJobs, useDownloadExportJob, useExportJobsList } from "@/hooks/use-export-jobs";
import type { ExportJob } from "@/lib/api/types";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";
import { ExportJobStatusBadge } from "./export-job-status-badge";
import { EXPORT_FILE_FORMAT_LABELS, EXPORT_JOB_TYPE_LABELS } from "./export-labels";

const dateFormatter = new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short" });

function formatDate(iso: string | null): string {
  return iso ? dateFormatter.format(new Date(iso)) : "—";
}

function isExpired(job: ExportJob): boolean {
  return job.expiresAt !== null && new Date(job.expiresAt).getTime() < Date.now();
}

function canDownload(job: ExportJob): boolean {
  return job.status === "COMPLETED" && !isExpired(job);
}

/**
 * Dışa aktarma geçmişi — `admin/import/page.tsx`'teki iş listesi tablosuyla AYNI görsel dil.
 * Süregelen (`PENDING`/`PROCESSING`) işler `useExportJobsList`'in `refetchInterval`'ı sayesinde
 * kendiliğinden güncellenir; sayfa yenilemeye gerek yok.
 */
export function ExportJobsTable() {
  const query = useExportJobsList();
  const download = useDownloadExportJob();
  const jobs = flattenExportJobs(query.data?.pages);

  async function handleDownload(job: ExportJob) {
    try {
      await download.mutateAsync(job);
    } catch (err) {
      toast.error(friendlyErrorMessage(err));
    }
  }

  if (query.isError) {
    return (
      <Alert variant="error">
        <span className="flex flex-wrap items-center justify-between gap-3">
          <span className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {friendlyErrorMessage(query.error)}
          </span>
          <Button type="button" variant="outline" size="sm" onClick={() => void query.refetch()}>
            Tekrar Dene
          </Button>
        </span>
      </Alert>
    );
  }

  if (query.isPending) {
    return (
      <Card className="space-y-2">
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
      </Card>
    );
  }

  if (jobs.length === 0) {
    return (
      <EmptyState
        icon={FileArchive}
        title="Henüz dışa aktarma işi yok"
        description="Yukarıdan yeni bir dışa aktarma oluşturarak başlayın."
      />
    );
  }

  return (
    <div className="space-y-4">
      <Card className="overflow-hidden p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Tip</TableHead>
              <TableHead>Format</TableHead>
              <TableHead>Durum</TableHead>
              <TableHead>Oluşturan</TableHead>
              <TableHead>Oluşturulma</TableHead>
              <TableHead>Süre Sonu</TableHead>
              <TableHead className="text-right">İndir</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {jobs.map((job) => (
              <TableRow key={job.id}>
                <TableCell className="font-medium text-foreground">
                  <span className="flex items-center gap-1.5">
                    {EXPORT_JOB_TYPE_LABELS[job.type]}
                    {job.containsPii && (
                      <span title="Ham/maskesiz kişisel veri içeriyor">
                        <Lock className="h-3.5 w-3.5 text-warning" aria-label="Ham/maskesiz kişisel veri içeriyor" />
                      </span>
                    )}
                  </span>
                </TableCell>
                <TableCell>
                  <Badge>{EXPORT_FILE_FORMAT_LABELS[job.format]}</Badge>
                </TableCell>
                <TableCell>
                  <div className="space-y-1">
                    <ExportJobStatusBadge status={job.status} />
                    {job.status === "FAILED" && job.errorSummary && (
                      <p className="max-w-[220px] truncate text-xs text-danger" title={job.errorSummary}>
                        {job.errorSummary}
                      </p>
                    )}
                  </div>
                </TableCell>
                <TableCell className="text-foreground/60">{job.createdBy?.name ?? "—"}</TableCell>
                <TableCell className="text-foreground/60">{formatDate(job.createdAt)}</TableCell>
                <TableCell className={isExpired(job) ? "text-danger" : "text-foreground/60"}>
                  {job.expiresAt ? formatDate(job.expiresAt) : "—"}
                  {isExpired(job) && " (süresi doldu)"}
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={!canDownload(job)}
                    loading={download.isPending && download.variables?.id === job.id}
                    aria-label={`${EXPORT_JOB_TYPE_LABELS[job.type]} raporunu indir`}
                    onClick={() => void handleDownload(job)}
                  >
                    <Download className="h-3.5 w-3.5" />
                    İndir
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      {query.hasNextPage && (
        <div className="flex justify-center">
          <Button variant="outline" loading={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>
            Daha fazla yükle
          </Button>
        </div>
      )}
    </div>
  );
}
