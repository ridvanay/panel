"use client";

import { useState } from "react";
import type { DoctorShowcaseMedia, DoctorShowcasePhoto, DoctorShowcaseVideo } from "@/lib/api/types";
import { fillReview, useReviewStrings } from "@/lib/i18n/use-review-strings";
import { GalleryLightbox } from "@/components/site/blocks/gallery-lightbox";
import { SafeImage } from "@/components/site/safe-image";
import { VideoFacade } from "@/components/site/telehealth/video-facade";

/**
 * Paket Y — "Photos & Videos": fotoğraf ızgarası (+ lightbox: klavye, kaydırma, ESC) ve video facade'ları.
 * Fotoğraflar `next/image` (uygun `sizes`, tembel yükleme) ile gelir; alt metin zorunludur (sunucu kuralı).
 */
export function DoctorMediaGallery({ media }: { media: DoctorShowcaseMedia[] }) {
  const { t } = useReviewStrings();
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const photos = media.filter((m): m is DoctorShowcasePhoto => m.kind === "photo");
  const videos = media.filter((m): m is DoctorShowcaseVideo => m.kind === "video");
  if (photos.length === 0 && videos.length === 0) return null;

  return (
    <div className="space-y-8">
      {photos.length > 0 && (
        <div>
          {videos.length > 0 && <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-foreground/50">{t.photosHeading}</h3>}
          <ul className="grid grid-cols-2 gap-3 md:grid-cols-3">
            {photos.map((photo, index) => (
              <li key={photo.id}>
                <button
                  type="button"
                  onClick={() => setLightboxIndex(index)}
                  aria-label={fillReview(t.openPhotoAria, { alt: photo.alt })}
                  className="group relative block aspect-[4/3] w-full overflow-hidden rounded-[var(--site-radius)] border border-border bg-muted outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  <SafeImage
                    src={photo.url}
                    alt={photo.alt}
                    fill
                    sizes="(min-width: 768px) 33vw, 50vw"
                    className="object-cover transition-transform duration-300 group-hover:scale-105"
                  />
                </button>
                {photo.title && <p className="mt-1.5 text-xs text-foreground/70">{photo.title}</p>}
              </li>
            ))}
          </ul>
          <GalleryLightbox images={photos.map((p) => ({ url: p.url, alt: p.alt }))} index={lightboxIndex} onIndexChange={setLightboxIndex} />
        </div>
      )}

      {videos.length > 0 && (
        <div>
          {photos.length > 0 && <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-foreground/50">{t.videosHeading}</h3>}
          <ul className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {videos.map((video) => (
              <li key={video.id}>
                <VideoFacade video={video} />
                {video.title && <p className="mt-2 text-sm font-medium text-foreground">{video.title}</p>}
                {video.description && <p className="mt-0.5 text-xs text-foreground/60">{video.description}</p>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
