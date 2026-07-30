"use client";

import { useCallback, useEffect, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { AlertCircle, Copy, Image as ImageIcon, UploadCloud } from "lucide-react";
import * as mediaApi from "@/lib/api/media";
import type { Media } from "@/lib/api/types";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import { EmptyState } from "@/components/ui/empty-state";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { MediaPreviewDialog } from "@/components/admin/media-preview-dialog";
import { PageHeading } from "@/components/admin/page-heading";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";
import { cn } from "@/lib/cn";

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface UploadProgress {
  total: number;
  done: number;
}

const galleryContainerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.04 },
  },
};

const galleryItemVariants = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.25 } },
};

export default function AdminMediaPage() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragCounterRef = useRef(0);
  const [items, setItems] = useState<Media[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Media | null>(null);
  const [previewMedia, setPreviewMedia] = useState<Media | null>(null);

  const load = useCallback(async () => {
    try {
      const page = await mediaApi.listMedia();
      setItems(page.items);
    } catch (err) {
      setError(friendlyErrorMessage(err));
    }
  }, []);

  useEffect(() => {
    (async () => {
      await load();
    })();
  }, [load]);

  async function handleFiles(fileList: FileList | File[]) {
    const files = Array.from(fileList);
    if (files.length === 0) return;

    const imageFiles = files.filter((file) => file.type.startsWith("image/"));
    const skippedCount = files.length - imageFiles.length;
    if (skippedCount > 0) {
      toast.error(
        skippedCount === 1
          ? "1 dosya görsel formatında olmadığı için atlandı."
          : `${skippedCount} dosya görsel formatında olmadığı için atlandı.`
      );
    }
    if (imageFiles.length === 0) return;

    setUploading(true);
    setUploadProgress({ total: imageFiles.length, done: 0 });
    setError(null);

    let successCount = 0;
    let failCount = 0;

    for (const file of imageFiles) {
      try {
        await mediaApi.uploadMedia(file);
        successCount += 1;
      } catch (err) {
        failCount += 1;
        setError(friendlyErrorMessage(err));
      } finally {
        setUploadProgress((prev) => (prev ? { ...prev, done: prev.done + 1 } : prev));
      }
    }

    setUploading(false);
    setUploadProgress(null);

    if (successCount > 0 && failCount === 0) {
      toast.success(successCount === 1 ? "1 görsel yüklendi." : `${successCount} görsel yüklendi.`);
    } else if (successCount > 0 && failCount > 0) {
      toast.success(`${successCount} görsel yüklendi, ${failCount} görsel başarısız oldu.`);
    } else if (failCount > 0) {
      toast.error(failCount === 1 ? "Görsel yüklenemedi." : `${failCount} görsel yüklenemedi.`);
    }

    if (successCount > 0) {
      await load();
    }
  }

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const files = event.target.files;
    event.target.value = "";
    if (!files || files.length === 0) return;
    await handleFiles(files);
  }

  function handleDragEnter(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    dragCounterRef.current += 1;
    if (event.dataTransfer.types.includes("Files")) {
      setDragActive(true);
    }
  }

  function handleDragOver(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
  }

  function handleDragLeave(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    dragCounterRef.current = Math.max(dragCounterRef.current - 1, 0);
    if (dragCounterRef.current === 0) {
      setDragActive(false);
    }
  }

  async function handleDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    dragCounterRef.current = 0;
    setDragActive(false);
    const files = event.dataTransfer.files;
    if (files && files.length > 0) {
      await handleFiles(files);
    }
  }

  async function handleDelete() {
    if (!pendingDelete) return;
    const mediaId = pendingDelete.id;
    setDeletingId(mediaId);
    try {
      await mediaApi.deleteMedia(mediaId);
      toast.success("Görsel silindi.");
      setPendingDelete(null);
      await load();
    } catch (err) {
      setError(friendlyErrorMessage(err));
    } finally {
      setDeletingId(null);
    }
  }

  async function handleCopy(url: string) {
    await navigator.clipboard.writeText(url);
    toast.success("Görsel URL'si kopyalandı.");
  }

  const pendingPlaceholderCount = uploadProgress ? Math.max(uploadProgress.total - uploadProgress.done, 0) : 0;

  return (
    <div className="space-y-6">
      <PageHeading
        icon={ImageIcon}
        title="Medya Kütüphanesi"
        description="Yüklenen görseller ve dosyalar."
        actions={
          <>
            <Button loading={uploading} onClick={() => fileInputRef.current?.click()}>
              Görsel yükle
            </Button>
            <input
              ref={fileInputRef}
              id="media-upload-input"
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={handleFileChange}
            />
          </>
        }
      />

      {error && (
        <Alert variant="error">
          <span className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {error}
          </span>
        </Alert>
      )}

      <label
        htmlFor="media-upload-input"
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-10 text-center transition-all duration-300",
          dragActive
            ? "border-primary bg-primary/5 shadow-md shadow-primary/10"
            : "border-border/70 bg-surface/70 backdrop-blur-xl hover:border-primary/50 hover:bg-muted/40"
        )}
      >
        <span
          className={cn(
            "flex h-11 w-11 items-center justify-center rounded-full transition-colors",
            dragActive ? "bg-primary/10 text-primary" : "bg-muted text-foreground/50"
          )}
        >
          <UploadCloud className="h-5 w-5" />
        </span>
        <div className="space-y-1">
          <p className="text-sm font-medium text-foreground">Görselleri buraya sürükleyin</p>
          <p className="text-sm text-foreground/60">veya tıklayıp bilgisayarınızdan seçin</p>
        </div>
        {uploadProgress && (
          <p className="text-xs font-medium text-primary">
            {uploadProgress.done}/{uploadProgress.total} yüklendi
          </p>
        )}
      </label>

      {items === null ? (
        <div className="flex justify-center py-12">
          <Spinner className="h-6 w-6 text-primary" />
        </div>
      ) : items.length === 0 && pendingPlaceholderCount === 0 ? (
        <EmptyState
          icon={ImageIcon}
          title="Henüz görsel yüklenmedi"
          description="Yukarıdaki alana sürükleyip bırakarak veya tıklayarak görsel yükleyebilirsiniz."
        />
      ) : (
        <motion.div
          className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4"
          variants={galleryContainerVariants}
          initial="hidden"
          animate="visible"
        >
          {Array.from({ length: pendingPlaceholderCount }).map((_, index) => (
            <motion.div key={`pending-${index}`} variants={galleryItemVariants}>
              <Card className="space-y-2 p-3">
                <div className="flex aspect-square w-full items-center justify-center rounded-md bg-muted">
                  <Spinner className="h-6 w-6 text-foreground/40" />
                </div>
                <div className="h-3 w-3/4 animate-pulse rounded bg-muted" />
                <div className="h-3 w-10 animate-pulse rounded bg-muted" />
              </Card>
            </motion.div>
          ))}
          {items.map((media) => (
            <motion.div
              key={media.id}
              variants={galleryItemVariants}
              whileHover={{ y: -4 }}
              transition={{ duration: 0.2 }}
            >
              <Card className="space-y-2 p-3">
                <div className="group relative">
                  <button
                    type="button"
                    onClick={() => setPreviewMedia(media)}
                    aria-label={`${media.filename} önizlemesini aç`}
                    className="block w-full cursor-zoom-in overflow-hidden rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element -- yüklenen medya URL'si, next/image remotePatterns henüz tanımlı değil */}
                    <img
                      src={media.url}
                      alt=""
                      className="aspect-square w-full object-cover transition-transform duration-200 group-hover:scale-105"
                    />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleCopy(media.url)}
                    aria-label={`${media.filename} URL'sini kopyala`}
                    className="absolute top-2 right-2 flex h-8 w-8 items-center justify-center rounded-lg bg-foreground/60 text-background opacity-0 backdrop-blur transition-opacity focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover:opacity-100"
                  >
                    <Copy className="h-4 w-4" />
                  </button>
                </div>
                <p className="truncate text-xs font-medium text-foreground" title={media.filename}>
                  {media.filename}
                </p>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-foreground/50">{formatSize(media.sizeBytes)}</span>
                  <Button variant="ghost" size="sm" onClick={() => setPendingDelete(media)}>
                    Sil
                  </Button>
                </div>
              </Card>
            </motion.div>
          ))}
        </motion.div>
      )}

      <MediaPreviewDialog
        media={previewMedia}
        open={previewMedia !== null}
        onOpenChange={(open) => {
          if (!open) setPreviewMedia(null);
        }}
      />

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
        title="Görseli sil"
        description={pendingDelete ? `"${pendingDelete.filename}" görselini silmek istediğinize emin misiniz?` : undefined}
        confirmText="Sil"
        destructive
        loading={deletingId === pendingDelete?.id}
        onConfirm={handleDelete}
      />
    </div>
  );
}
