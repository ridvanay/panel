"use client";

import { Copy } from "lucide-react";
import { toast } from "sonner";
import type { Media } from "@/lib/api/types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface MediaPreviewDialogProps {
  media: Media | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Galeri kartına tıklandığında görseli tam boyutlu gösteren sade bir önizleme/lightbox diyaloğu.
 * `confirm-dialog.tsx`'in kurulduğu `dialog.tsx` primitiflerinin üzerine kuruludur.
 */
export function MediaPreviewDialog({ media, open, onOpenChange }: MediaPreviewDialogProps) {
  async function handleCopy() {
    if (!media) return;
    await navigator.clipboard.writeText(media.url);
    toast.success("Görsel URL'si kopyalandı.");
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="truncate pr-8" title={media?.filename}>
            {media?.filename ?? "Önizleme"}
          </DialogTitle>
          {media && <DialogDescription>{formatSize(media.sizeBytes)}</DialogDescription>}
        </DialogHeader>
        {media && (
          // eslint-disable-next-line @next/next/no-img-element -- yüklenen medya URL'si, next/image remotePatterns henüz tanımlı değil
          <img
            src={media.url}
            alt={media.filename}
            className="max-h-[65vh] w-full rounded-lg border border-border object-contain"
          />
        )}
        <div className="flex justify-end">
          <Button type="button" variant="outline" onClick={handleCopy}>
            <Copy className="h-4 w-4" />
            URL&apos;yi kopyala
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
