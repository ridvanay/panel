"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, FileImage, FileText, Paperclip, Trash2, UploadCloud, X } from "lucide-react";
import * as telehealthApi from "@/lib/api/telehealth";
import { ApiClientError } from "@/lib/api/error";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";
import type { AppointmentDocument } from "@/lib/api/types";
import { Skeleton } from "@/components/ui/skeleton";
import { formatBytes } from "@/lib/format-bytes";
import { cn } from "@/lib/utils";

/**
 * `.claude/design-notes-telehealth.md` §12.3 — tıbbi belge yükleyici. Native HTML5 drag&drop
 * (`onDragOver`/`onDrop`/gizli `<input type="file">`) — code-quality-agent'ın "uploader için
 * yeni paket EKLENMEZ" kararı (§9.7.9). İstek başına 1 dosya, booking başına ≤5, ≤5MB,
 * PDF/PNG/JPG whitelist (sunucu sihirli-bayt ile de doğrular, SVG dahil whitelist dışı KESİN
 * reddedilir — §9.7.5 madde 4).
 */

const MAX_DOCUMENTS = 5;
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const ACCEPTED_MIME_TYPES = ["application/pdf", "image/png", "image/jpeg"];

interface UploadingItem {
  key: string;
  filename: string;
  progress: number;
}

interface ErrorItem {
  key: string;
  filename: string;
  message: string;
}

function DocumentTypeIcon({ mimeType, className }: { mimeType: string; className?: string }) {
  return mimeType === "application/pdf" ? (
    <FileText className={className} aria-hidden="true" />
  ) : (
    <FileImage className={className} aria-hidden="true" />
  );
}

interface DocumentUploaderProps {
  bookingId: string;
  accessToken?: string;
  /** Yükleyici yalnızca `healthDataConsent === true` verilmiş bir intake VARSA çağrılabilir (§9.7.5 madde 2). */
  disabled?: boolean;
  disabledReason?: string;
}

export function DocumentUploader({ bookingId, accessToken, disabled, disabledReason }: DocumentUploaderProps) {
  const [documents, setDocuments] = useState<AppointmentDocument[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState<UploadingItem[]>([]);
  const [errors, setErrors] = useState<ErrorItem[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const loadDocuments = useCallback(async () => {
    setLoadError(null);
    try {
      const list = await telehealthApi.listBookingDocuments(bookingId, accessToken);
      setDocuments(list.filter((d) => !d.deletedAt));
    } catch (err) {
      setLoadError(friendlyErrorMessage(err));
      setDocuments([]);
    }
  }, [bookingId, accessToken]);

  useEffect(() => {
    void loadDocuments();
  }, [loadDocuments]);

  const activeCount = (documents?.length ?? 0) + uploading.length;

  function validateClientSide(file: File): string | null {
    if (file.size > MAX_UPLOAD_BYTES) return "Dosya 5MB sınırını aşıyor.";
    if (!ACCEPTED_MIME_TYPES.includes(file.type)) {
      return "Desteklenmeyen dosya biçimi — yalnızca PDF, PNG veya JPG yükleyebilirsiniz.";
    }
    return null;
  }

  function handleFiles(files: FileList | null) {
    if (!files || files.length === 0 || disabled) return;
    const file = files[0]!;
    const key = `${file.name}-${Date.now()}`;

    if (activeCount >= MAX_DOCUMENTS) {
      setErrors((prev) => [...prev, { key, filename: file.name, message: "En fazla 5 belge yükleyebilirsiniz." }]);
      return;
    }

    const clientError = validateClientSide(file);
    if (clientError) {
      setErrors((prev) => [...prev, { key, filename: file.name, message: clientError }]);
      return;
    }

    setUploading((prev) => [...prev, { key, filename: file.name, progress: 0 }]);

    telehealthApi
      .uploadBookingDocument(bookingId, file, {
        accessToken,
        onProgress: (percent) => setUploading((prev) => prev.map((u) => (u.key === key ? { ...u, progress: percent } : u))),
      })
      .then((document) => {
        setUploading((prev) => prev.filter((u) => u.key !== key));
        setDocuments((prev) => [...(prev ?? []), document]);
      })
      .catch((err) => {
        setUploading((prev) => prev.filter((u) => u.key !== key));
        const message =
          err instanceof ApiClientError && err.code === "DOCUMENT_LIMIT_REACHED"
            ? "En fazla 5 belge yükleyebilirsiniz."
            : err instanceof ApiClientError && err.code === "UNSUPPORTED_DOCUMENT_TYPE"
              ? "Desteklenmeyen dosya biçimi — yalnızca PDF, PNG veya JPG yükleyebilirsiniz."
              : friendlyErrorMessage(err);
        setErrors((prev) => [...prev, { key, filename: file.name, message }]);
      });
  }

  async function handleRemove(document: AppointmentDocument) {
    try {
      await telehealthApi.deleteBookingDocument(document.id, accessToken);
      setDocuments((prev) => (prev ?? []).filter((d) => d.id !== document.id));
    } catch (err) {
      setErrors((prev) => [...prev, { key: `${document.id}-remove`, filename: document.filename, message: friendlyErrorMessage(err) }]);
    }
  }

  if (documents === null) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-24 w-full rounded-[var(--site-radius)]" />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex items-start gap-3 rounded-[var(--site-radius)] border border-danger/30 bg-danger/10 p-3">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-danger" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-danger">{loadError}</p>
          <button type="button" onClick={() => void loadDocuments()} className="mt-1 text-xs font-medium text-danger underline-offset-4 hover:underline">
            Tekrar dene
          </button>
        </div>
      </div>
    );
  }

  const atLimit = activeCount >= MAX_DOCUMENTS;

  return (
    <div className="space-y-2">
      {disabled ? (
        <p className="rounded-[var(--site-radius)] border border-border bg-muted/50 px-4 py-3 text-sm text-foreground/60">
          {disabledReason ?? "Belge yüklemek için önce sağlık verisi paylaşım iznini onaylayın."}
        </p>
      ) : atLimit ? (
        <div className="flex items-center gap-2 rounded-[var(--site-radius)] border border-border bg-muted/50 px-4 py-3 text-sm text-foreground/60">
          <Paperclip className="h-4 w-4 shrink-0" aria-hidden="true" />
          Belge sınırına ulaşıldı (5/5) — yeni bir belge eklemeden önce mevcut bir belgeyi kaldırın.
        </div>
      ) : (
        <div
          role="button"
          tabIndex={0}
          onClick={() => inputRef.current?.click()}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
          }}
          onDragEnter={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragOver={(e) => e.preventDefault()}
          onDragLeave={(e) => {
            e.preventDefault();
            setDragOver(false);
          }}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            handleFiles(e.dataTransfer.files);
          }}
          className={cn(
            "flex flex-col items-center gap-2 rounded-[var(--site-radius)] border-2 border-dashed p-8 text-center transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2 focus-visible:ring-offset-surface",
            dragOver ? "border-primary bg-primary/5" : "border-border bg-surface hover:border-primary/40 hover:bg-primary/5"
          )}
        >
          <UploadCloud className={cn("h-8 w-8", dragOver ? "text-primary" : "text-foreground/40")} aria-hidden="true" />
          {dragOver ? (
            <p className="text-sm font-medium text-primary">Bırakmak için serbest bırakın</p>
          ) : (
            <>
              <p className="text-sm font-medium text-foreground">
                Dosyaları buraya sürükleyin veya <span className="text-primary underline-offset-4">seçmek için tıklayın</span>
              </p>
              <p className="text-xs text-foreground/50">PDF, PNG veya JPG · maksimum 5MB</p>
            </>
          )}
          <input
            ref={inputRef}
            type="file"
            className="sr-only"
            accept={ACCEPTED_MIME_TYPES.join(",")}
            onChange={(e) => {
              handleFiles(e.target.files);
              e.target.value = "";
            }}
          />
        </div>
      )}

      {uploading.map((item) => (
        <div key={item.key} className="flex items-center gap-3 rounded-[var(--site-radius)] border border-border bg-surface p-3">
          <FileText className="h-5 w-5 shrink-0 text-foreground/40" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-foreground">{item.filename}</p>
            <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-primary transition-all duration-150" style={{ width: `${item.progress}%` }} />
            </div>
          </div>
          <span className="shrink-0 text-xs tabular-nums text-foreground/50">%{item.progress}</span>
        </div>
      ))}

      {documents.map((document) => (
        <div key={document.id} className="flex items-center gap-3 rounded-[var(--site-radius)] border border-border bg-surface p-3">
          <DocumentTypeIcon mimeType={document.mimeType} className="h-5 w-5 shrink-0 text-foreground/40" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-foreground">{document.filename}</p>
            <p className="text-xs text-foreground/50">{formatBytes(document.sizeBytes)}</p>
          </div>
          <button
            type="button"
            aria-label={`${document.filename} dosyasını kaldır`}
            onClick={() => void handleRemove(document)}
            className="shrink-0 text-foreground/40 hover:text-danger"
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      ))}

      {errors.map((error) => (
        <div key={error.key} className="flex items-start gap-3 rounded-[var(--site-radius)] border border-danger/30 bg-danger/10 p-3">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-danger" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-danger">{error.filename}</p>
            <p className="text-xs text-danger/80">{error.message}</p>
          </div>
          <button
            type="button"
            aria-label="Hatayı kapat"
            onClick={() => setErrors((prev) => prev.filter((e) => e.key !== error.key))}
            className="shrink-0 text-danger/60 hover:text-danger"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      ))}
    </div>
  );
}
