"use client";

import { Copy } from "lucide-react";
import { toast } from "sonner";
import type { Media } from "@/lib/api/types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MediaThumbnail } from "@/components/admin/media/media-thumbnail";

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
          <MediaThumbnail
            src={media.url}
            alt={media.filename}
            className="max-h-[65vh] w-full rounded-lg border border-border object-contain"
            // `object-contain` + yalnızca `max-h-*` normal `<img>`de intrinsic en-boy oranına göre
            // gerçek yükseklik verir, ama boş bir placeholder `div`de bu YOKTUR (0 yükseklik) —
            // yükleme hatası durumunda somut bir kutu görünsün diye burada sabit bir yükseklik verilir.
            fallbackClassName="h-64 w-full rounded-lg border border-border"
            iconClassName="h-10 w-10"
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
