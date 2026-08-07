"use client";

import { useState } from "react";
import { toast } from "sonner";
import { ImagePlus, Loader2, X } from "lucide-react";
import type { Media } from "@/lib/api/types";
import { Button } from "@/components/ui/button";
import { MediaPicker } from "@/components/admin/media/media-picker";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";

export interface GalleryImageItem {
  id: string;
  order: number;
  media: Media;
}

interface GalleryFieldProps {
  id: string;
  label: string;
  hint?: string;
  images: GalleryImageItem[];
  onAdd: (media: Media) => Promise<void>;
  onRemove: (imageId: string) => Promise<void>;
}

/**
 * Product/Portfolio galeri yönetimi — `MediaSelectField`ten (kapak görseli) FARKLI: tekil
 * değil ÇOKLU görsel ilişkisi yönetir ve her ekleme/kaldırma anında backend'e yazılır (formun
 * "Kaydet" akışına dahil DEĞİLDİR). Yalnızca kaydı zaten var olan (id sahibi) ürün/portföy
 * öğelerinde kullanılabilir — `POST .../images` var olan bir kayıt id'si gerektirir.
 */
export function GalleryField({ id, label, hint, images, onAdd, onRemove }: GalleryFieldProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);

  async function handlePick(media: Media) {
    setAdding(true);
    try {
      await onAdd(media);
      toast.success("Görsel galeriye eklendi.");
    } catch (err) {
      toast.error(friendlyErrorMessage(err));
    } finally {
      setAdding(false);
    }
  }

  async function handleRemove(imageId: string) {
    setRemovingId(imageId);
    try {
      await onRemove(imageId);
      toast.success("Görsel galeriden kaldırıldı.");
    } catch (err) {
      toast.error(friendlyErrorMessage(err));
    } finally {
      setRemovingId(null);
    }
  }

  return (
    <div className="space-y-1.5">
      <span id={`${id}-label`} className="block text-sm font-medium text-foreground">
        {label}
      </span>
      {hint && <p className="text-xs text-foreground/60">{hint}</p>}

      {images.length > 0 && (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6" role="list" aria-labelledby={`${id}-label`}>
          {images.map((image) => (
            <div
              key={image.id}
              role="listitem"
              className="group relative aspect-square overflow-hidden rounded-md border border-border"
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- galeri URL'si medya kütüphanesinden gelir, next/image remotePatterns henüz tanımlı değil */}
              <img src={image.media.url} alt={image.media.altText ?? ""} className="h-full w-full object-cover" />
              <button
                type="button"
                aria-label="Görseli galeriden kaldır"
                disabled={removingId === image.id}
                onClick={() => handleRemove(image.id)}
                className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white opacity-0 transition-opacity duration-300 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover:opacity-100 disabled:cursor-not-allowed"
              >
                {removingId === image.id ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <X className="h-3.5 w-3.5" />
                )}
              </button>
            </div>
          ))}
        </div>
      )}

      <Button type="button" variant="secondary" loading={adding} onClick={() => setPickerOpen(true)}>
        <ImagePlus className="h-4 w-4" />
        Görsel ekle
      </Button>

      <MediaPicker open={pickerOpen} onOpenChange={setPickerOpen} onSelect={handlePick} />
    </div>
  );
}
