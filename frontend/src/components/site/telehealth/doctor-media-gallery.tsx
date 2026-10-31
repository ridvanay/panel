"use client";

import { useState } from "react";
import { Play } from "lucide-react";
import type { DoctorShowcaseMedia, DoctorShowcasePhoto, DoctorShowcaseVideo } from "@/lib/api/types";
import type { TelehealthStrings } from "@/lib/i18n/site-dictionaries";
import { fillReview, useReviewStrings } from "@/lib/i18n/use-review-strings";
import { GalleryLightbox } from "@/components/site/blocks/gallery-lightbox";
import { SafeImage } from "@/components/site/safe-image";
import { DoctorVideoModal } from "@/components/site/telehealth/doctor-video-modal";
import { localThumbnail } from "@/components/site/telehealth/video-facade";

/**
 * Paket AE — "Foto/Video": tek ızgara. Fotoğraflar lightbox'ta açılır; videolar posterle gösterilir ve modalda oynar
 * (yüklenen MP4 yalnızca modal açılınca oluşturulur; YouTube/Vimeo facade'ı korunur).
 */
export function DoctorMediaGallery({ media, telehealthDict }: { media: DoctorShowcaseMedia[]; telehealthDict: Pick<TelehealthStrings, "videoUnsupported"> }) {
  const { t } = useReviewStrings();
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [activeVideo, setActiveVideo] = useState<DoctorShowcaseVideo | null>(null);
  const photos = media.filter((m): m is DoctorShowcasePhoto => m.kind === "photo");
  if (media.length === 0) return null;

  return (
    <div>
      <ul className="grid grid-cols-2 gap-3 md:grid-cols-3">
        {media.map((item) => {
          if (item.kind === "photo") {
            const index = photos.findIndex((p) => p.id === item.id);
            return (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => setLightboxIndex(index)}
                  aria-label={fillReview(t.openPhotoAria, { alt: item.alt })}
                  className="group relative block aspect-[4/3] w-full overflow-hidden rounded-[var(--site-radius)] border border-border bg-muted outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  <SafeImage src={item.url} alt={item.alt} fill sizes="(min-width: 768px) 33vw, 50vw" className="object-cover transition-transform duration-300 group-hover:scale-105" />
                </button>
                {item.title && <p className="mt-1.5 text-xs text-foreground/70">{item.title}</p>}
              </li>
            );
          }
          const title = item.title?.trim() || item.alt?.trim() || t.videoFallbackTitle;
          const poster = localThumbnail(item.thumbnailUrl);
          return (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => setActiveVideo(item)}
                aria-label={fillReview(t.playVideoAria, { title })}
                className="group relative block aspect-[4/3] w-full overflow-hidden rounded-[var(--site-radius)] border border-border bg-black outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                {poster ? (
                  // eslint-disable-next-line @next/next/no-img-element -- kendi sunucumuzdaki poster/küçük resim (medya kütüphanesi)
                  <img src={poster} alt="" loading="lazy" decoding="async" className="absolute inset-0 h-full w-full object-cover" />
                ) : (
                  <span aria-hidden="true" className="absolute inset-0 bg-gradient-to-br from-[var(--site-secondary)] to-black" />
                )}
                <span className="absolute inset-0 bg-black/25 transition-colors duration-300 group-hover:bg-black/35" aria-hidden="true" />
                <span className="absolute inset-0 flex items-center justify-center" aria-hidden="true">
                  <span className="flex h-12 w-12 items-center justify-center rounded-full bg-white/90 text-black shadow-lg transition-transform duration-300 group-hover:scale-110">
                    <Play className="h-5 w-5 fill-current rtl:-scale-x-100" />
                  </span>
                </span>
              </button>
              <p className="mt-1.5 text-xs font-medium text-foreground/80">{title}</p>
            </li>
          );
        })}
      </ul>
      {photos.length > 0 && <GalleryLightbox images={photos.map((p) => ({ url: p.url, alt: p.alt }))} index={lightboxIndex} onIndexChange={setLightboxIndex} />}
      <DoctorVideoModal video={activeVideo} unsupportedLabel={telehealthDict.videoUnsupported} onClose={() => setActiveVideo(null)} />
    </div>
  );
}
