"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import type { BlockChrome, ImageBlock, ImageRadius } from "@/lib/page-builder/types";
import { GalleryLightbox } from "./gallery-lightbox";

const RADIUS_CLASS: Record<ImageRadius, string> = {
  none: "",
  sm: "rounded-md",
  md: "rounded-lg",
  lg: "rounded-2xl",
  full: "rounded-full",
};

/** `chrome` bu blokta davranışsal fark YARATMAZ — bugün de gutter'sız (edge-to-edge), yalnızca
 *  arayüz tutarlılığı için `BlockRenderer`'ın diğer yaprak görünümleriyle AYNI imzayı taşır. */
export function ImageBlockView({ block }: { block: ImageBlock; chrome: BlockChrome }) {
  const { url, alt, caption, radius, lightbox } = block.data;
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const radiusClass = RADIUS_CLASS[radius ?? "none"];

  const img = (
    // eslint-disable-next-line @next/next/no-img-element -- URL, medya kütüphanesinden gelecek, next/image remotePatterns henüz tanımlı değil
    <img src={url} alt={alt} className={cn("w-full", radiusClass)} />
  );

  return (
    <figure>
      {lightbox ? (
        <>
          <button
            type="button"
            aria-label={alt ? `Görseli büyüt: ${alt}` : "Görseli büyüt"}
            onClick={() => setLightboxOpen(true)}
            className={cn("block w-full cursor-zoom-in outline-none focus-visible:ring-3 focus-visible:ring-ring/50", radiusClass)}
          >
            {img}
          </button>
          <GalleryLightbox
            images={[{ url, alt }]}
            index={lightboxOpen ? 0 : null}
            onIndexChange={(index) => setLightboxOpen(index !== null)}
          />
        </>
      ) : (
        img
      )}
      {caption && <figcaption className="mt-2 text-center text-sm text-foreground/60">{caption}</figcaption>}
    </figure>
  );
}
