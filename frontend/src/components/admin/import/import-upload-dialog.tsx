"use client";

import { useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { UploadCloud } from "lucide-react";
import * as importApi from "@/lib/api/import";
import type { ImportJobType } from "@/lib/api/types";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";
import { IMPORT_TYPE_CONFIGS, importTypeConfig } from "./import-type-config";

interface ImportUploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Yükleme başarılı olup önizleme (`status: PENDING`) hazır olunca çağrılır. */
  onCreated: (jobId: string) => void;
}

/**
 * "İçe Aktar" akışının 1. ADIMI: dosya türü seçimi + yükleme. `POST /admin/import/jobs`
 * HİÇBİR kayıt oluşturmaz — yalnızca dosyayı ayrıştırıp önizleme üretir (bkz. openapi.yaml
 * `Import` tag'i, ARCHITECTURE.md §10.8). Başarılı yüklemede `[jobId]` detay sayfasına
 * yönlendirilir; önizleme/onay orada gösterilir.
 *
 * NOT (ui-designer gözden geçirmeli): projede daha önce sürükle-bırak (drag-and-drop) bir
 * yükleme alanı yoktu (mevcut `image-upload-field.tsx` yalnızca buton + gizli `<input>`
 * kullanıyor). Burada büyük dosya yükleme UX'i için en sade/mevcut pattern'lere (dashed
 * border `EmptyState` görünümü, `admin-link` metin linki) en yakın şekilde yeni bir
 * dropzone inşa edildi — bu YENİ bir görsel karardır.
 */
export function ImportUploadDialog({ open, onOpenChange, onCreated }: ImportUploadDialogProps) {
  const [type, setType] = useState<ImportJobType>("PAGES");
  const [dragActive, setDragActive] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const config = importTypeConfig(type);

  function reset() {
    setType("PAGES");
    setDragActive(false);
    setUploading(false);
    setError(null);
  }

  function handleOpenChange(next: boolean) {
    if (!next && !uploading) reset();
    if (!uploading) onOpenChange(next);
  }

  async function handleFile(file: File) {
    setError(null);
    setUploading(true);
    try {
      const job = await importApi.createImportJob(file, type);
      reset();
      onOpenChange(false);
      onCreated(job.id);
    } catch (err) {
      setError(friendlyErrorMessage(err));
    } finally {
      setUploading(false);
    }
  }

  function handleInputChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) void handleFile(file);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragActive(false);
    if (uploading) return;
    const file = event.dataTransfer.files?.[0];
    if (file) void handleFile(file);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Yeni İçe Aktarma</DialogTitle>
          <DialogDescription>
            Bir dosya türü seçip yükleyin — kayıt oluşturmadan önce size bir önizleme göstereceğiz.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div role="radiogroup" aria-label="İçe aktarma türü" className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {IMPORT_TYPE_CONFIGS.map((option) => {
              const Icon = option.icon;
              const active = option.type === type;
              return (
                <button
                  key={option.type}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  disabled={uploading}
                  onClick={() => setType(option.type)}
                  className={cn(
                    "flex items-start gap-2.5 rounded-lg border p-3 text-left transition-all duration-300",
                    active ? "border-primary bg-primary/5" : "border-border hover:bg-muted"
                  )}
                >
                  <span
                    className={cn(
                      "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md",
                      active ? "bg-primary/15 text-primary" : "bg-muted text-foreground/60"
                    )}
                  >
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-foreground">{option.label}</span>
                    <span className="block text-xs text-foreground/60">
                      {option.formatHint} · {option.maxSizeLabel} · {option.maxRecordsLabel}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>

          <div
            onDragOver={(e) => {
              e.preventDefault();
              if (!uploading) setDragActive(true);
            }}
            onDragLeave={() => setDragActive(false)}
            onDrop={handleDrop}
            className={cn(
              "flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-8 text-center transition-all duration-300",
              dragActive ? "border-primary bg-primary/5" : "border-border",
              uploading && "pointer-events-none opacity-60"
            )}
          >
            <UploadCloud className="h-8 w-8 text-foreground/40" aria-hidden="true" />
            <p className="text-sm text-foreground/70">
              Dosyayı buraya sürükleyip bırakın veya{" "}
              <button type="button" className="admin-link" onClick={() => fileInputRef.current?.click()}>
                bilgisayardan seçin
              </button>
            </p>
            <p className="text-xs text-foreground/50">{config.description}</p>
            <input
              ref={fileInputRef}
              type="file"
              accept={config.accept}
              aria-label={`${config.label} dosyası seç`}
              className="hidden"
              disabled={uploading}
              onChange={handleInputChange}
            />
          </div>

          {uploading && (
            <p className="flex items-center gap-2 text-sm text-foreground/60" role="status">
              <Spinner className="h-4 w-4" />
              Dosya yükleniyor ve önizleme hazırlanıyor…
            </p>
          )}

          {error && <Alert variant="error">{error}</Alert>}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => handleOpenChange(false)} disabled={uploading}>
            Vazgeç
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
