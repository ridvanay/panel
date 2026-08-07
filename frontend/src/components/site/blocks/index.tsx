import type { Block } from "@/lib/page-builder/types";
import { HeroBlockView } from "./hero-block";
import { TextBlockView } from "./text-block";
import { ImageBlockView } from "./image-block";
import { GalleryBlockView } from "./gallery-block";
import { CtaBlockView } from "./cta-block";
import { FeaturedProductsBlockView } from "./featured-products-block";
import { FeaturedPortfolioBlockView } from "./featured-portfolio-block";

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
        }
      })}
    </>
  );
}
