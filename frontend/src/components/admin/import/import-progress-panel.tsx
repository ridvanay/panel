"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import * as importApi from "@/lib/api/import";
import type { ImportJob } from "@/lib/api/types";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { cn } from "@/lib/utils";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";
import { isImportJobFinished } from "./import-labels";

const POLL_INTERVAL_MS = 2000;

/**
 * `ProgressBar` — `components/admin/system/health-panel.tsx`'teki YEREL (dışa
 * aktarılmamış) `ProgressBar` ile AYNI görsel dili kullanır (`bg-surface-muted` track +
 * `bg-{tone}` dolgu, `transition-all duration-500`); burada tekrar kullanılabilir hâle
 * getirmek için kopyalanmadı, aynı sınıflar yeniden yazıldı — YENİ bir görsel dil DEĞİL.
 */
function ProgressBar({ percent }: { percent: number }) {
  const clamped = Math.min(100, Math.max(0, percent));
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-surface-muted">
      <div
        className={cn("h-full rounded-full bg-primary transition-all duration-500")}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}

interface ImportProgressPanelProps {
  job: ImportJob;
  /** Her poll'de (ve iş sonlandığında) güncel iş nesnesini üst bileşene taşır. */
  onUpdate: (job: ImportJob) => void;
}

/**
 * `status: QUEUED | PROCESSING` iken gösterilir. openapi.yaml + ARCHITECTURE.md §10.8.1
 * kararı gereği realtime altyapı (SSE/WebSocket) YOK — `GET /admin/import/jobs/{jobId}`
 * ucu **2 saniyede bir** poll edilir. `status` sonlanınca (`COMPLETED|FAILED|CANCELLED`)
 * poll durur ve bir kerelik toast bildirimi gösterilir.
 */
export function ImportProgressPanel({ job, onUpdate }: ImportProgressPanelProps) {
  const [cancelling, setCancelling] = useState(false);
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false);
  const [pollError, setPollError] = useState<string | null>(null);
  const notifiedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const updated = await importApi.getImportJob(job.id);
        if (cancelled) return;
        setPollError(null);
        onUpdate(updated);
        if (isImportJobFinished(updated.status) && !notifiedRef.current) {
          notifiedRef.current = true;
          if (updated.status === "COMPLETED") {
            toast.success(
              `İçe aktarma tamamlandı: ${updated.totalCount} kayıttan ${updated.successCount} başarılı, ${updated.errorCount} hata.`
            );
          } else if (updated.status === "FAILED") {
            toast.error(updated.errorSummary ?? "İçe aktarma başarısız oldu.");
          } else {
            toast.message("İçe aktarma iptal edildi.");
          }
        }
      } catch (err) {
        if (!cancelled) setPollError(friendlyErrorMessage(err));
      }
    }

    if (isImportJobFinished(job.status)) return;

    void poll();
    const interval = setInterval(() => {
      void poll();
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
    // job.id değiştiğinde (farklı bir işe navigasyon) yeniden başlatılmalı; `job.status`
    // her poll sonucunda zaten `onUpdate` ile üst bileşende güncellenip bu bileşen
    // unmount edilecek (bkz. [jobId]/page.tsx), bu yüzden ek bağımlılık gerekmez.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job.id]);

  async function handleCancel() {
    setCancelling(true);
    try {
      const updated = await importApi.cancelImportJob(job.id);
      onUpdate(updated);
      setCancelConfirmOpen(false);
      toast.success("İptal talebi alındı.");
    } catch (err) {
      toast.error(friendlyErrorMessage(err));
    } finally {
      setCancelling(false);
    }
  }

  const percent = job.totalCount > 0 ? (job.processedCount / job.totalCount) * 100 : 0;

  return (
    <Card className="space-y-4">
      <div className="flex items-center gap-2 text-foreground">
        <Loader2 className="h-4 w-4 animate-spin text-primary" aria-hidden="true" />
        <h2 className="admin-h2">
          {job.status === "QUEUED" ? "Kuyrukta bekliyor" : "İşleniyor"}
        </h2>
      </div>

      <p className="admin-text-secondary">
        Bu sayfadan ayrılabilirsiniz — işlem sunucu tarafında devam eder, geri döndüğünüzde güncel durumu görürsünüz.
      </p>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-sm text-foreground/70">
          <span>
            {job.processedCount} / {job.totalCount} kayıt işlendi
          </span>
          <span>%{percent.toFixed(0)}</span>
        </div>
        <ProgressBar percent={percent} />
      </div>

      <div className="flex flex-wrap gap-4 text-sm text-foreground/60">
        <span>Başarılı: {job.successCount}</span>
        <span>Hata: {job.errorCount}</span>
        <span>Atlanan: {job.skippedCount}</span>
      </div>

      {pollError && <Alert variant="error">{pollError} — otomatik yeniden denenecek.</Alert>}

      <div className="flex justify-end border-t border-border pt-4">
        <Button variant="outline" onClick={() => setCancelConfirmOpen(true)}>
          İşi İptal Et
        </Button>
      </div>

      <ConfirmDialog
        open={cancelConfirmOpen}
        onOpenChange={setCancelConfirmOpen}
        title="İçe aktarmayı iptal et"
        description="Şu ana kadar işlenmiş kayıtlar GERİ ALINMAZ, yalnızca kalan kayıtların işlenmesi durdurulur. Emin misiniz?"
        confirmText="İptal Et"
        destructive
        loading={cancelling}
        onConfirm={() => void handleCancel()}
      />
    </Card>
  );
}
