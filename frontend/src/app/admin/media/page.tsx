"use client";

import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import { toast } from "sonner";
import * as mediaApi from "@/lib/api/media";
import type { Media } from "@/lib/api/types";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function AdminMediaPage() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<Media[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

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

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setUploading(true);
    try {
      await mediaApi.uploadMedia(file);
      await load();
    } catch (err) {
      setError(friendlyErrorMessage(err));
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete(mediaId: string) {
    if (!confirm("Bu görseli silmek istediğinize emin misiniz?")) return;
    setDeletingId(mediaId);
    try {
      await mediaApi.deleteMedia(mediaId);
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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Medya Kütüphanesi</h1>
          <p className="mt-1 text-sm text-foreground/60">Yüklenen görseller ve dosyalar.</p>
        </div>
        <Button loading={uploading} onClick={() => fileInputRef.current?.click()}>
          Görsel yükle
        </Button>
        <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileChange} />
      </div>

      {error && <Alert variant="error">{error}</Alert>}

      {items === null ? (
        <div className="flex justify-center py-12">
          <Spinner className="h-6 w-6 text-primary" />
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-md border border-dashed border-border p-10 text-center text-sm text-foreground/60">
          Henüz görsel yüklenmedi.
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
          {items.map((media) => (
            <Card key={media.id} className="space-y-2 p-3">
              <button type="button" onClick={() => handleCopy(media.url)} className="block w-full">
                {/* eslint-disable-next-line @next/next/no-img-element -- yüklenen medya URL'si, next/image remotePatterns henüz tanımlı değil */}
                <img src={media.url} alt={media.filename} className="aspect-square w-full rounded-md object-cover" />
              </button>
              <p className="truncate text-xs font-medium text-foreground" title={media.filename}>
                {media.filename}
              </p>
              <div className="flex items-center justify-between">
                <span className="text-xs text-foreground/50">{formatSize(media.sizeBytes)}</span>
                <Button variant="ghost" size="sm" loading={deletingId === media.id} onClick={() => handleDelete(media.id)}>
                  Sil
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
