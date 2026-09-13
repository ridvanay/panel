"use client";

import { useCallback, useEffect, useState } from "react";
import { Download, Film, Trash2 } from "lucide-react";
import * as telehealthApi from "@/lib/api/telehealth";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";
import type { ConsultationRecording } from "@/lib/api/types";
import { Button, buttonVariants } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { formatBytes } from "@/lib/format-bytes";
import { cn } from "@/lib/utils";

/** `"12:34"` — kayıt süresi (saniye → mm:ss), yalnızca bu panele özgü küçük bir yardımcı. */
function formatDurationSeconds(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

interface RecordingAccessPanelProps {
  appointmentId: string;
  accessToken?: string;
  /**
   * Yalnızca hasta tarafında `true` verilir — doktor tarafında "Sil" butonu HİÇ RENDER EDİLMEZ
   * (backend zaten `DELETE .../recording`'i doktor için `404` ile reddeder, ama UI baştan
   * göstermez — §F5 bağlayıcı kural).
   */
  canDelete: boolean;
}

/**
 * `.claude/architect-scope-telehealth-recording.md` F5 — hasta VE doktor booking/randevu detay
 * görünümlerine gömülen paylaşılan panel. Yalnızca `status === "COMPLETED" && downloadable` iken
 * görünür; aksi halde (kayıt yok, henüz işleniyor, reddedildi vb.) SESSİZCE hiçbir şey RENDER ETMEZ
 * — bu panel destekleyici bir eklentidir, barındığı sayfanın kendi ana loading/error/empty
 * durumları zaten ayrıca yönetilir (bkz. `patient-booking-detail-panel.tsx`/
 * `booking-documents-dialog.tsx`).
 */
export function RecordingAccessPanel({ appointmentId, accessToken, canDelete }: RecordingAccessPanelProps) {
  const [recording, setRecording] = useState<ConsultationRecording | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    try {
      const result = await telehealthApi.getRecordingStatus(appointmentId, accessToken);
      setRecording(result);
      setError(null);
    } catch (err) {
      setRecording(null);
      setError(friendlyErrorMessage(err));
    }
  }, [appointmentId, accessToken]);

  useEffect(() => {
    (async () => {
      await load();
    })();
  }, [load]);

  async function handleDelete() {
    setDeleting(true);
    try {
      const result = await telehealthApi.deleteRecording(appointmentId, accessToken);
      setRecording(result);
      setConfirmOpen(false);
    } catch (err) {
      setError(friendlyErrorMessage(err));
    } finally {
      setDeleting(false);
    }
  }

  if (recording === undefined) return null;
  if (error && !recording) return null;
  if (!recording || recording.status !== "COMPLETED" || !recording.downloadable) return null;

  const watchUrl = telehealthApi.getRecordingContentUrl(appointmentId, { accessToken, disposition: "inline" });
  const downloadUrl = telehealthApi.getRecordingContentUrl(appointmentId, { accessToken, disposition: "attachment" });

  return (
    <div className="rounded-[var(--site-radius)] border border-border bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Film className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
          Görüşme Kaydı
        </p>
        <div className="flex items-center gap-2 text-xs text-foreground/50">
          {recording.durationSeconds !== null && <span>{formatDurationSeconds(recording.durationSeconds)}</span>}
          {recording.fileSizeBytes !== null && <span>{formatBytes(recording.fileSizeBytes)}</span>}
        </div>
      </div>

      {error && <p className="mt-2 text-xs text-danger">{error}</p>}

      <div className="mt-3 flex flex-wrap gap-2">
        <a
          href={watchUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(buttonVariants({ variant: "outline", size: "sm" }), "rounded-[var(--site-radius)]")}
        >
          İzle
        </a>
        <a href={downloadUrl} className={cn(buttonVariants({ variant: "outline", size: "sm" }), "rounded-[var(--site-radius)]")}>
          <Download className="h-3.5 w-3.5" aria-hidden="true" />
          İndir
        </a>
        {canDelete && (
          <Button type="button" variant="destructive" size="sm" onClick={() => setConfirmOpen(true)}>
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
            Sil
          </Button>
        )}
      </div>

      {canDelete && (
        <ConfirmDialog
          open={confirmOpen}
          onOpenChange={setConfirmOpen}
          title="Görüşme kaydını sil"
          description="Bu görüşme kaydı kalıcı olarak silinecek. Bu işlem geri alınamaz."
          confirmText="Sil"
          tone="danger"
          loading={deleting}
          onConfirm={() => void handleDelete()}
        />
      )}
    </div>
  );
}
