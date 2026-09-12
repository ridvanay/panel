"use client";

import { useEffect, useState } from "react";
import { Check, ExternalLink, FileImage, FileText, StickyNote } from "lucide-react";
import * as telehealthApi from "@/lib/api/telehealth";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";
import type { AppointmentDocument } from "@/lib/api/types";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { formatBytes } from "@/lib/format-bytes";
import { cn } from "@/lib/utils";

/**
 * `.claude/design-notes-telehealth.md` §13.3 — güvenli belge önizleme modalı (doktor görünümü).
 * §12.5.4'ün eski TEK davranışı (her satır `window.open` ile yeni sekmede blob açar) KALDIRILIR,
 * yerine modal İÇİNDE gömülü önizleme gelir. Dialog artık İKİ AYRI bölüm gösterir: hasta notu
 * (varsayılan GİZLİ, "Görüntüle" tıklanınca `getBookingIntake` ile çekilir — her okuma sunucuda
 * `logAudit("telehealth.intake_note.accessed")` üretir, §9.7.5 madde 6, bu yüzden dialog HER
 * açıldığında OTOMATİK çekilmez) ve belgeler (çoklu belge seçici + gömülü önizleme).
 *
 * `<iframe>` güvenlik varsayılanı (security-agent yerine orkestratör tarafından belirlendi):
 * `sandbox="allow-same-origin"` — script çalıştırma/top-navigasyon/form gönderimi İZİN VERİLMEZ,
 * blob içeriği aynı origin'den geldiği için görüntüleyici yine de çalışır.
 */

interface BookingDocumentsDialogProps {
  bookingId: string;
  /** `AppointmentBooking.hasIntakeNote` — hasta notu bölümünü render edip etmeyeceğimizi belirler. */
  hasIntakeNote: boolean;
  accessToken?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function BookingDocumentsDialog({ bookingId, hasIntakeNote, accessToken, open, onOpenChange }: BookingDocumentsDialogProps) {
  const [documents, setDocuments] = useState<AppointmentDocument[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  const [openingExternalId, setOpeningExternalId] = useState<string | null>(null);

  const [noteRevealed, setNoteRevealed] = useState(false);
  const [loadingNote, setLoadingNote] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  // Belge listesi — dialog her açıldığında sıfırdan çekilir, seçim/not durumu sıfırlanır.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!open) return;
      if (!cancelled) {
        setDocuments(null);
        setError(null);
        setSelectedDocId(null);
        setNoteRevealed(false);
        setNote(null);
      }
      try {
        const list = await telehealthApi.listBookingDocuments(bookingId, accessToken);
        const visible = list.filter((d) => !d.deletedAt);
        if (!cancelled) {
          setDocuments(visible);
          setSelectedDocId(visible[0]?.id ?? null);
        }
      } catch (err) {
        if (!cancelled) setError(friendlyErrorMessage(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, bookingId, accessToken]);

  // Seçili belgenin gömülü önizlemesi — belge değiştiğinde önceki blob URL temizlenir (cleanup).
  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    (async () => {
      if (!open || !selectedDocId) {
        if (!cancelled) setPreviewUrl(null);
        return;
      }
      if (!cancelled) {
        setLoadingPreview(true);
        setPreviewError(null);
        setPreviewUrl(null);
      }
      try {
        const { blob } = await telehealthApi.fetchDocumentContentBlob(selectedDocId, accessToken);
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setPreviewUrl(objectUrl);
      } catch (err) {
        if (!cancelled) setPreviewError(friendlyErrorMessage(err));
      } finally {
        if (!cancelled) setLoadingPreview(false);
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [open, selectedDocId, accessToken]);

  async function revealNote() {
    setLoadingNote(true);
    try {
      const intake = await telehealthApi.getBookingIntake(bookingId, accessToken);
      setNote(intake.note);
      setNoteRevealed(true);
    } catch (err) {
      setError(friendlyErrorMessage(err));
    } finally {
      setLoadingNote(false);
    }
  }

  async function openInNewTab(document: AppointmentDocument) {
    setOpeningExternalId(document.id);
    try {
      const { blob } = await telehealthApi.fetchDocumentContentBlob(document.id, accessToken);
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank", "noopener,noreferrer");
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      setError(friendlyErrorMessage(err));
    } finally {
      setOpeningExternalId(null);
    }
  }

  const selectedDoc = documents?.find((d) => d.id === selectedDocId) ?? null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Tıbbi Belgeler</DialogTitle>
          <DialogDescription>Bu rezervasyon için yüklenen belgeler ve hasta notu.</DialogDescription>
        </DialogHeader>

        {error && <Alert variant="error">{error}</Alert>}

        {hasIntakeNote && (
          <div className="rounded-[var(--site-radius)] border border-border bg-muted/30 p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-foreground/50">
                <StickyNote className="h-3.5 w-3.5" aria-hidden="true" />
                Hasta Notu
              </p>
              {!noteRevealed && (
                <Button type="button" variant="outline" size="sm" onClick={() => void revealNote()} loading={loadingNote}>
                  Görüntüle
                </Button>
              )}
            </div>
            {noteRevealed && (
              <p className="mt-2 whitespace-pre-line text-sm text-foreground/80">{note ?? "Bu rezervasyon için not girilmemiş."}</p>
            )}
          </div>
        )}

        {documents === null ? (
          <div className="space-y-2">
            <Skeleton className="h-14 w-full rounded-[var(--site-radius)]" />
            <Skeleton className="h-14 w-full rounded-[var(--site-radius)]" />
          </div>
        ) : documents.length === 0 ? (
          <p className="text-sm text-foreground/60">Bu rezervasyon için yüklenmiş bir belge yok.</p>
        ) : (
          <>
            {documents.length > 1 && (
              <div className="flex flex-wrap gap-2">
                {documents.map((doc) => {
                  const selected = doc.id === selectedDocId;
                  return (
                    <button
                      key={doc.id}
                      type="button"
                      onClick={() => setSelectedDocId(doc.id)}
                      aria-pressed={selected}
                      className={cn(
                        "inline-flex max-w-[200px] items-center gap-1.5 rounded-[var(--site-radius)] border px-3 py-1.5 text-xs font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2 focus-visible:ring-offset-surface",
                        selected
                          ? "border-2 border-transparent bg-primary text-primary-foreground ring-2 ring-offset-2 ring-offset-surface ring-primary"
                          : "border-border bg-surface text-foreground hover:border-primary/50 hover:bg-primary/5"
                      )}
                    >
                      {selected ? (
                        <Check className="h-3 w-3 shrink-0" aria-hidden="true" />
                      ) : doc.mimeType === "application/pdf" ? (
                        <FileText className="h-3 w-3 shrink-0" aria-hidden="true" />
                      ) : (
                        <FileImage className="h-3 w-3 shrink-0" aria-hidden="true" />
                      )}
                      <span className="truncate">{doc.filename}</span>
                    </button>
                  );
                })}
              </div>
            )}

            {selectedDoc && (
              <div className="mt-3 overflow-hidden rounded-[var(--site-radius)] border border-border bg-muted/30">
                <div className="flex items-center justify-between gap-2 border-b border-border/60 px-3 py-2">
                  <span className="min-w-0 truncate text-sm font-medium text-foreground">{selectedDoc.filename}</span>
                  <div className="flex shrink-0 items-center gap-2 text-xs text-foreground/50">
                    {formatBytes(selectedDoc.sizeBytes)}
                    <button
                      type="button"
                      disabled={openingExternalId === selectedDoc.id}
                      onClick={() => void openInNewTab(selectedDoc)}
                      className="flex items-center gap-1 text-foreground/50 hover:text-primary disabled:opacity-60"
                      aria-label="Yeni sekmede aç"
                    >
                      <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </div>
                </div>

                <div className="flex h-[420px] items-center justify-center">
                  {loadingPreview ? (
                    <Skeleton className="h-full w-full rounded-none" />
                  ) : previewError ? (
                    <Alert variant="error" className="m-3">
                      {previewError}
                    </Alert>
                  ) : previewUrl && selectedDoc.mimeType === "application/pdf" ? (
                    <iframe src={previewUrl} title={selectedDoc.filename} sandbox="allow-same-origin" className="h-full w-full" />
                  ) : previewUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element -- geçici blob: URL önizlemesi, next/image blob: şemasını DESTEKLEMEZ
                    <img src={previewUrl} alt={selectedDoc.filename} className="h-full w-full object-contain" />
                  ) : null}
                </div>
              </div>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
