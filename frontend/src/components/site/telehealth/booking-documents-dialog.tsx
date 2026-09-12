"use client";

import { useEffect, useState } from "react";
import { FileImage, FileText } from "lucide-react";
import * as telehealthApi from "@/lib/api/telehealth";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";
import type { AppointmentDocument } from "@/lib/api/types";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert } from "@/components/ui/alert";
import { formatBytes } from "@/lib/format-bytes";

/**
 * `.claude/design-notes-telehealth.md` §12.5.4 — belge önizleme (doktor görünümü). Görüntüleme
 * yeni bir sekmede, tarayıcının kendi PDF/resim görüntüleyicisine bırakılır — özel bir ışık kutusu
 * İCAT EDİLMEZ. `GET .../documents/{id}/content` yalnızca `Authorization: Bearer`/`?t=` ile
 * yetkilendirdiğinden düz bir `<a href>` KULLANILAMAZ (bkz. `lib/api/telehealth.ts::
 * fetchDocumentContentBlob` başlık yorumu) — içerik BLOB olarak alınıp yeni sekmede açılır; her
 * açılış sunucuda `logAudit("telehealth.intake_document.accessed")` üretir (§9.7.5 madde 6).
 */

interface BookingDocumentsDialogProps {
  bookingId: string;
  accessToken?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function BookingDocumentsDialog({ bookingId, accessToken, open, onOpenChange }: BookingDocumentsDialogProps) {
  const [documents, setDocuments] = useState<AppointmentDocument[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openingId, setOpeningId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      if (!cancelled) {
        setDocuments(null);
        setError(null);
      }
      try {
        const list = await telehealthApi.listBookingDocuments(bookingId, accessToken);
        if (!cancelled) setDocuments(list.filter((d) => !d.deletedAt));
      } catch (err) {
        if (!cancelled) setError(friendlyErrorMessage(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, bookingId, accessToken]);

  async function handleOpen(document: AppointmentDocument) {
    setOpeningId(document.id);
    try {
      const { blob } = await telehealthApi.fetchDocumentContentBlob(document.id, accessToken);
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank", "noopener,noreferrer");
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      setError(friendlyErrorMessage(err));
    } finally {
      setOpeningId(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Yüklenen Belgeler</DialogTitle>
        </DialogHeader>

        {error && <Alert variant="error">{error}</Alert>}

        {documents === null ? (
          <div className="space-y-2">
            <Skeleton className="h-14 w-full rounded-[var(--site-radius)]" />
            <Skeleton className="h-14 w-full rounded-[var(--site-radius)]" />
          </div>
        ) : documents.length === 0 ? (
          <p className="text-sm text-foreground/60">Bu rezervasyon için yüklenmiş bir belge yok.</p>
        ) : (
          <div className="space-y-2">
            {documents.map((document) => (
              <button
                key={document.id}
                type="button"
                disabled={openingId === document.id}
                onClick={() => void handleOpen(document)}
                className="flex w-full items-center gap-3 rounded-[var(--site-radius)] border border-border bg-surface p-3 text-left transition-colors hover:border-primary/40 disabled:opacity-60"
              >
                {document.mimeType === "application/pdf" ? (
                  <FileText className="h-5 w-5 shrink-0 text-foreground/40" aria-hidden="true" />
                ) : (
                  <FileImage className="h-5 w-5 shrink-0 text-foreground/40" aria-hidden="true" />
                )}
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{document.filename}</span>
                <span className="shrink-0 text-xs text-foreground/50">{formatBytes(document.sizeBytes)}</span>
              </button>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
