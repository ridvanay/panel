import type { Block } from "@/lib/page-builder/types";
import { HeroBlockView } from "./hero-block";
import { TextBlockView } from "./text-block";
import { ImageBlockView } from "./image-block";
import { GalleryBlockView } from "./gallery-block";
import { CtaBlockView } from "./cta-block";
import { FeaturedProductsBlockView } from "./featured-products-block";
import { FeaturedPortfolioBlockView } from "./featured-portfolio-block";
import { ColumnsBlockView } from "./columns-block";

/**
 * §10.17.5 — `columns` dalı kendini bir kez özyineler (sütun içindeki bloklar AYNI switch'ten
 * geçer). `columns` şema düzeyinde `columns`/`hero` İÇEREMEZ (derinlik ≤1, backend zod ile
 * zorlanır), bu yüzden sonsuz özyineleme riski yoktur.
 */
export function BlockRenderer({ blocks }: { blocks: Block[] }) {
  return (
    <>
      {blocks.map((block) => {
        switch (block.type) {
          case "hero":
            return <HeroBlockView key={block.id} block={block} />;
          case "text":
            return <TextBlockView key={block.id} block={block} />;
          case "image":
            return <ImageBlockView key={block.id} block={block} />;
          case "gallery":
            return <GalleryBlockView key={block.id} block={block} />;
          case "cta":
            return <CtaBlockView key={block.id} block={block} />;
          case "featured-products":
            return <FeaturedProductsBlockView key={block.id} block={block} />;
          case "featured-portfolio":
            return <FeaturedPortfolioBlockView key={block.id} block={block} />;
          case "columns":
            return <ColumnsBlockView key={block.id} block={block} />;
        }
      })}
    </>
  );
}
