"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertCircle, ChevronLeft, ShieldAlert, Trash2, Upload } from "lucide-react";
import * as importApi from "@/lib/api/import";
import type { ImportJob } from "@/lib/api/types";
import { useAuth } from "@/context/auth-context";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { EmptyState } from "@/components/ui/empty-state";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { PageHeading } from "@/components/admin/page-heading";
import { ImportJobStatusBadge } from "@/components/admin/import/import-job-status-badge";
import { ImportPreviewPanel } from "@/components/admin/import/import-preview-panel";
import { ImportProgressPanel } from "@/components/admin/import/import-progress-panel";
import { ImportReportPanel } from "@/components/admin/import/import-report-panel";
import { importTypeLabel } from "@/components/admin/import/import-type-config";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";

/**
 * İçe aktarma işinin durumu URL'de `jobId` ile kalıcıdır (Next.js App Router dinamik
 * segment) — kullanıcı sayfadan ayrılıp geri dönebilir, sayfa yenilense dahi
 * `GET /admin/import/jobs/{jobId}` ile güncel durum yeniden çekilir. Bu, ayrı bir
 * client-side state/store gerektirmeden ARCHITECTURE.md §10.8'deki "iş kaybolmamalı"
 * gereksinimini karşılar.
 *
 * NOT (Next.js 16 breaking change — bkz. frontend/AGENTS.md): dinamik route `params`
 * artık bir `Promise`, `use()` ile açılır (mevcut `admin/blog/[postId]/page.tsx` ve
 * `admin/notifications/templates/[templateId]/page.tsx` ile AYNI pattern).
 */
export default function ImportJobDetailPage({ params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = use(params);
  const { user } = useAuth();
  const router = useRouter();
  const isAdmin = user?.role === "ADMIN";

  const [job, setJob] = useState<ImportJob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await importApi.getImportJob(jobId);
      setJob(data);
    } catch (err) {
      setError(friendlyErrorMessage(err));
    }
  }, [jobId]);

  useEffect(() => {
    if (!isAdmin) return;
    (async () => {
      await load();
    })();
  }, [isAdmin, load]);

  async function handleDelete() {
    setDeleting(true);
    try {
      await importApi.deleteImportJob(jobId);
      toast.success("İçe aktarma işi silindi.");
      router.push("/admin/import");
    } catch (err) {
      toast.error(friendlyErrorMessage(err));
      setDeleting(false);
      setDeleteConfirmOpen(false);
    }
  }

  if (!isAdmin) {
    return (
      <div className="space-y-6">
        <PageHeading icon={Upload} title="İçe Aktarma İşi" />
        <EmptyState
          icon={ShieldAlert}
          title="Bu bölüme erişiminiz yok"
          description="İçe aktarma yalnızca Admin rolündeki kullanıcılara açıktır."
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/admin/import"
          className="mb-3 inline-flex items-center gap-1 text-sm text-foreground/60 transition-colors hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" />
          İçe Aktarma İşlerine Dön
        </Link>
        <PageHeading
          icon={Upload}
          title={job?.filename ?? "İçe Aktarma İşi"}
          description={job ? `${importTypeLabel(job.type)} · ${job.format} · ${job.sizeBytes.toLocaleString("tr-TR")} bayt` : undefined}
          actions={
            job ? (
              <>
                <ImportJobStatusBadge status={job.status} />
                <Button
                  variant="outline"
                  onClick={() => setDeleteConfirmOpen(true)}
                  disabled={job.status === "PROCESSING"}
                  title={job.status === "PROCESSING" ? "İşlenen bir iş silinemez. Önce iptal edin." : undefined}
                >
                  <Trash2 className="h-4 w-4" />
                  Sil
                </Button>
              </>
            ) : undefined
          }
        />
      </div>

      {error && (
        <Alert variant="error">
          <span className="flex flex-wrap items-center justify-between gap-3">
            <span className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {error}
            </span>
            <Button type="button" variant="outline" size="sm" onClick={() => void load()}>
              Tekrar Dene
            </Button>
          </span>
        </Alert>
      )}

      {job === null ? (
        error ? null : (
          <div className="flex justify-center py-12">
            <Spinner className="h-6 w-6 text-primary" />
          </div>
        )
      ) : job.status === "PENDING" ? (
        <ImportPreviewPanel key={job.id} job={job} onStarted={setJob} />
      ) : job.status === "QUEUED" || job.status === "PROCESSING" ? (
        <ImportProgressPanel job={job} onUpdate={setJob} />
      ) : (
        <ImportReportPanel job={job} />
      )}

      <ConfirmDialog
        open={deleteConfirmOpen}
        onOpenChange={setDeleteConfirmOpen}
        title="İçe aktarma işini sil"
        description="Bu işin geçmiş kaydı ve hata listesi silinecek. Daha önce içe aktarılmış içerik ETKİLENMEZ (geri alma v1 kapsamında değildir)."
        confirmText="Sil"
        destructive
        loading={deleting}
        onConfirm={() => void handleDelete()}
      />
    </div>
  );
}
