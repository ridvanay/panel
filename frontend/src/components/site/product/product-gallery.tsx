"use client";

import { useEffect, useState, type ReactNode } from "react";
import { GalleryLightbox } from "@/components/site/blocks/gallery-lightbox";
import { cn } from "@/lib/utils";

export interface ProductGalleryImage {
  url: string;
  alt: string;
}

interface ProductGalleryProps {
  /** Kapak + galeri görselleri (sırayla) — kapak varsa ilk sırada. */
  images: ProductGalleryImage[];
  /** Seçili varyasyonun görseli (varsa) — ana önizlemeyi bu görsele geçirir. */
  highlightUrl?: string | null;
  /** İndirim/Tükendi rozeti (design-notes §3: `left-4 top-4`, `size="lg"`). */
  badge?: ReactNode;
}

/**
 * PDP galerisi — mevcut `GalleryLightbox` (bkz. `blocks/gallery-lightbox.tsx`) yeniden
 * kullanılarak zoom/tam ekran davranışı GENİŞLETİLİR (yeni bir kütüphane EKLENMEDİ, bkz.
 * `.claude/design-notes-ecommerce-storefront.md` "Galeri + zoom" notu).
 */
export function ProductGallery({ images, highlightUrl, badge }: ProductGalleryProps) {
  const [activeUrl, setActiveUrl] = useState<string | null>(images[0]?.url ?? null);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  useEffect(() => {
    // Varyasyon seçimi değişince (`highlightUrl`) kullanıcının önceki thumbnail seçimini EZER —
    // bu "prop değişince state'i sıfırla" senkronizasyonu render sırasında türetilemez (kullanıcı
    // thumbnail'a tıklayıp `activeUrl`'i MANUEL değiştirebilir), bu yüzden effect gerekli.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setActiveUrl(highlightUrl ?? images[0]?.url ?? null);
    // `images` yalnızca ürün değişince değişir (server'dan sabit prop); `highlightUrl`
    // değişimini yakalamak yeterlidir, `images` referansı için de tazelenmesi güvenlidir.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlightUrl]);

  if (images.length === 0 && !highlightUrl) return null;

  const displayImages =
    highlightUrl && !images.some((image) => image.url === highlightUrl)
      ? [{ url: highlightUrl, alt: "" }, ...images]
      : images;

  const activeIndex = Math.max(
    0,
    displayImages.findIndex((image) => image.url === activeUrl)
  );
  const active = displayImages[activeIndex] ?? displayImages[0];

  return (
    <div>
      <div className="relative">
        {badge}
        <button
          type="button"
          aria-label="Görseli büyüt"
          onClick={() => setLightboxIndex(activeIndex)}
          className="block w-full cursor-zoom-in overflow-hidden rounded-lg"
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- kapak/galeri URL'si medya kütüphanesinden gelir, next/image remotePatterns henüz tanımlı değil */}
          <img src={active.url} alt={active.alt} className="w-full object-cover transition-transform duration-300 hover:scale-105" />
        </button>
      </div>

      {displayImages.length > 1 && (
        <div className="mt-3 grid grid-cols-4 gap-2 sm:grid-cols-5">
          {displayImages.map((image, index) => (
            <button
              key={`${image.url}-${index}`}
              type="button"
              aria-label={`Görsel ${index + 1}`}
              aria-current={image.url === active.url}
              onClick={() => setActiveUrl(image.url)}
              className={cn(
                "aspect-square overflow-hidden rounded-md border-2 transition-colors duration-150",
                image.url === active.url ? "border-primary" : "border-transparent hover:border-border"
              )}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- galeri URL'si medya kütüphanesinden gelir, next/image remotePatterns henüz tanımlı değil */}
              <img src={image.url} alt={image.alt} className="h-full w-full object-cover" loading="lazy" />
            </button>
          ))}
        </div>
      )}

      <GalleryLightbox images={displayImages} index={lightboxIndex} onIndexChange={setLightboxIndex} />
    </div>
  );
}
