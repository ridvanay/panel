"use client";

import { useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { BlockChrome, GalleryBlock } from "@/lib/page-builder/types";
import { GalleryLightbox } from "./gallery-lightbox";

/**
 * WordPress-tarzı çoklu görsel galeri public render — design-notes-page-builder-gallery.md madde B.
 * `layout` alanına göre 3 ayrı render dalı (Grid/Carousel/Masonry); eski kayıtlarda `layout` alanı
 * yoksa `?? "grid"` ile geriye dönük varsayılana düşülür.
 *
 * Her görsel bir lightbox tetikleyicisidir (`GalleryLightbox`) — tıklanan görselden başlayarak
 * tam ekran önizleme açar, ok tuşları/swipe ile gezinme, ESC/overlay ile kapama sağlar.
 */
export function GalleryBlockView({ block, chrome }: { block: GalleryBlock; chrome: BlockChrome }) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const images = block.data.images;
  const layout = block.data.layout ?? "grid";
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  if (images.length === 0) return null;

  function scrollByOneItem(direction: 1 | -1) {
    const container = scrollerRef.current;
    if (!container) return;
    container.scrollBy({ left: direction * container.clientWidth * 0.8, behavior: "smooth" });
  }

  function lightboxTriggerLabel(alt: string, index: number) {
    return alt ? `Görseli büyüt: ${alt}` : `Görseli büyüt: Görsel ${index + 1}`;
  }

  const lightbox = <GalleryLightbox images={images} index={lightboxIndex} onIndexChange={setLightboxIndex} />;

  if (layout === "carousel") {
    return (
      <>
        <div className={cn("relative", chrome === "page" && "px-4 py-8 sm:px-6")}>
          <div
            ref={scrollerRef}
            role="region"
            aria-label="Galeri, kaydırmalı görünüm"
            tabIndex={0}
            className="flex snap-x snap-mandatory gap-2 overflow-x-auto scroll-smooth [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {images.map((image, i) => (
              <figure
                key={i}
                className="aspect-[4/3] w-[78%] shrink-0 snap-center overflow-hidden rounded-lg border border-border/50 bg-muted sm:w-[46%] md:w-[31%]"
              >
                <button
                  type="button"
                  aria-label={lightboxTriggerLabel(image.alt, i)}
                  onClick={() => setLightboxIndex(i)}
                  className="block h-full w-full cursor-zoom-in outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- URL, medya kütüphanesinden gelecek, next/image remotePatterns henüz tanımlı değil */}
                  <img src={image.url} alt={image.alt} loading="lazy" className="h-full w-full object-cover" />
                </button>
              </figure>
            ))}
          </div>

          {images.length > 1 && (
            <>
              <button
                type="button"
                aria-label="Önceki görsel"
                onClick={() => scrollByOneItem(-1)}
                className="absolute left-2 top-1/2 hidden h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-background/90 text-foreground/70 shadow-md hover:bg-background hover:text-foreground sm:flex"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                type="button"
                aria-label="Sonraki görsel"
                onClick={() => scrollByOneItem(1)}
                className="absolute right-2 top-1/2 hidden h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-background/90 text-foreground/70 shadow-md hover:bg-background hover:text-foreground sm:flex"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </>
          )}
        </div>
        {lightbox}
      </>
    );
  }

  if (layout === "masonry") {
    return (
      <>
        <div
          className={cn(
            "columns-2 gap-2 [column-fill:balance] sm:columns-3",
            chrome === "page" && "px-4 py-8 sm:px-6"
          )}
        >
          {images.map((image, i) => (
            <figure key={i} className="mb-2 break-inside-avoid overflow-hidden rounded-lg border border-border/50 bg-muted">
              <button
                type="button"
                aria-label={lightboxTriggerLabel(image.alt, i)}
                onClick={() => setLightboxIndex(i)}
                className="block w-full cursor-zoom-in outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- URL, medya kütüphanesinden gelecek, next/image remotePatterns henüz tanımlı değil */}
                <img src={image.url} alt={image.alt} loading="lazy" className="block h-auto w-full" />
              </button>
            </figure>
          ))}
        </div>
        {lightbox}
      </>
    );
  }

  return (
    <>
      <div
        className={cn(
          "grid grid-cols-[repeat(auto-fit,minmax(140px,1fr))] gap-2 sm:grid-cols-[repeat(auto-fit,minmax(180px,1fr))] md:grid-cols-[repeat(auto-fit,minmax(160px,1fr))]",
          chrome === "page" && "px-4 py-8 sm:px-6"
        )}
      >
        {images.map((image, i) => (
          <figure key={i} className="aspect-square overflow-hidden rounded-lg border border-border/50 bg-muted">
            <button
              type="button"
              aria-label={lightboxTriggerLabel(image.alt, i)}
              onClick={() => setLightboxIndex(i)}
              className="block h-full w-full cursor-zoom-in outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- URL, medya kütüphanesinden gelecek, next/image remotePatterns henüz tanımlı değil */}
              <img src={image.url} alt={image.alt} loading="lazy" className="h-full w-full object-cover" />
            </button>
          </figure>
        ))}
      </div>
      {lightbox}
    </>
  );
}
