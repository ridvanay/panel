"use client";

import { useEffect, useState, type MouseEvent, type ReactNode } from "react";
import { Image as ImageIcon } from "lucide-react";
import { GalleryLightbox } from "@/components/site/blocks/gallery-lightbox";
import { SafeImage } from "@/components/site/safe-image";
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

const MAIN_IMAGE_SIZES = "(min-width: 1024px) 50vw, 100vw";
const THUMBNAIL_SIZES = "(min-width: 640px) 20vw, 25vw";

/**
 * PDP galerisi — mevcut `GalleryLightbox` (bkz. `blocks/gallery-lightbox.tsx`) yeniden
 * kullanılarak zoom/tam ekran davranışı GENİŞLETİLİR (yeni bir kütüphane EKLENMEDİ, bkz.
 * `.claude/design-notes-ecommerce-storefront.md` "Galeri + zoom" notu).
 *
 * `.claude/architect-scope-products-catalog.md` §4.1 kök neden #2 düzeltmesi: görselsiz üründe
 * artık `null` DEĞİL, `page-header.tsx`'in SPLIT boş-durum diliyle AYNI bir yer tutucu render
 * edilir. `.claude/design-notes-products-catalog.md` §4.2 — imleç-takipli büyüteç (yalnızca
 * `scale` geçişlidir, `transformOrigin` konumu imleçle BİRLİKTE, transitionsız güncellenir).
 */
export function ProductGallery({ images, highlightUrl, badge }: ProductGalleryProps) {
  const [activeUrl, setActiveUrl] = useState<string | null>(images[0]?.url ?? null);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [zoom, setZoom] = useState<{ x: number; y: number; active: boolean }>({ x: 50, y: 50, active: false });

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

  if (images.length === 0 && !highlightUrl) {
    return (
      <div className="flex aspect-square w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-surface-muted text-foreground/40">
        <ImageIcon className="h-10 w-10" aria-hidden="true" />
        <span className="text-sm text-foreground/60">Görsel mevcut değil</span>
      </div>
    );
  }

  const displayImages =
    highlightUrl && !images.some((image) => image.url === highlightUrl)
      ? [{ url: highlightUrl, alt: "" }, ...images]
      : images;

  const activeIndex = Math.max(
    0,
    displayImages.findIndex((image) => image.url === activeUrl)
  );
  const active = displayImages[activeIndex] ?? displayImages[0];

  function handleMouseMove(event: MouseEvent<HTMLButtonElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * 100;
    const y = ((event.clientY - rect.top) / rect.height) * 100;
    // Yalnızca konum — TRANSITIONSUZ (imleçten geri kalmasın), `active` (scale) AYRI state.
    setZoom({ x, y, active: true });
  }

  function handleMouseLeave() {
    setZoom((prev) => ({ ...prev, active: false }));
  }

  return (
    <div>
      <div className="relative">
        {badge}
        <button
          type="button"
          aria-label="Görseli büyüt"
          onClick={() => setLightboxIndex(activeIndex)}
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
          className="relative block aspect-square w-full cursor-zoom-in overflow-hidden rounded-lg bg-surface-muted"
        >
          <SafeImage
            src={active.url}
            alt={active.alt}
            fill
            sizes={MAIN_IMAGE_SIZES}
            priority
            className="object-cover transition-transform duration-200 ease-out"
            style={{
              transformOrigin: `${zoom.x}% ${zoom.y}%`,
              transform: zoom.active ? "scale(2)" : "scale(1)",
            }}
          />
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
                "relative aspect-square overflow-hidden rounded-md border-2 transition-colors duration-150",
                image.url === active.url ? "border-primary" : "border-transparent hover:border-border"
              )}
            >
              <SafeImage src={image.url} alt={image.alt} fill sizes={THUMBNAIL_SIZES} className="object-cover" />
            </button>
          ))}
        </div>
      )}

      <GalleryLightbox images={displayImages} index={lightboxIndex} onIndexChange={setLightboxIndex} />
    </div>
  );
}
