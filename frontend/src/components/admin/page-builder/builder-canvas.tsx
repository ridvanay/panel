import { ArrowUp, ArrowDown, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { blockRegistry } from "@/lib/page-builder/registry";
import type { Block } from "@/lib/page-builder/types";
import { HeroBlockEditor } from "./blocks/hero-block";
import { TextBlockEditor } from "./blocks/text-block";
import { ImageBlockEditor } from "./blocks/image-block";
import { GalleryBlockEditor } from "./blocks/gallery-block";
import { CtaBlockEditor } from "./blocks/cta-block";
import { FeaturedProductsBlockEditor } from "./blocks/featured-products-block";
import { FeaturedPortfolioBlockEditor } from "./blocks/featured-portfolio-block";

function BlockEditor({ block, onChange }: { block: Block; onChange: (block: Block) => void }) {
  switch (block.type) {
    case "hero":
      return <HeroBlockEditor block={block} onChange={onChange} />;
    case "text":
      return <TextBlockEditor block={block} onChange={onChange} />;
    case "image":
      return <ImageBlockEditor block={block} onChange={onChange} />;
    case "gallery":
      return <GalleryBlockEditor block={block} onChange={onChange} />;
    case "cta":
      return <CtaBlockEditor block={block} onChange={onChange} />;
    case "featured-products":
      return <FeaturedProductsBlockEditor block={block} onChange={onChange} />;
    case "featured-portfolio":
      return <FeaturedPortfolioBlockEditor block={block} onChange={onChange} />;
  }
}

export function BuilderCanvas({ blocks, onChange }: { blocks: Block[]; onChange: (blocks: Block[]) => void }) {
  if (blocks.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-foreground/50">
        Henüz blok yok — yukarıdan bir blok ekleyin.
      </div>
    );
  }

  function updateBlock(index: number, updated: Block) {
    onChange(blocks.map((b, i) => (i === index ? updated : b)));
  }

  function removeBlock(index: number) {
    onChange(blocks.filter((_, i) => i !== index));
  }

  function moveBlock(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= blocks.length) return;
    const next = [...blocks];
    [next[index], next[target]] = [next[target]!, next[index]!];
    onChange(next);
  }

  return (
    <div className="space-y-4">
      {blocks.map((block, index) => (
        <Card key={block.id}>
          <div className="flex items-center justify-between border-b border-border pb-3">
            <span className="text-sm font-medium text-foreground">{blockRegistry[block.type].label}</span>
            <div className="flex gap-1">
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Yukarı taşı"
                onClick={() => moveBlock(index, -1)}
                disabled={index === 0}
              >
                <ArrowUp />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Aşağı taşı"
                onClick={() => moveBlock(index, 1)}
                disabled={index === blocks.length - 1}
              >
                <ArrowDown />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Bloğu sil"
                onClick={() => removeBlock(index)}
              >
                <Trash2 />
              </Button>
            </div>
          </div>
          <div className="pt-4">
            <BlockEditor block={block} onChange={(updated) => updateBlock(index, updated)} />
          </div>
        </Card>
      ))}
    </div>
  );
}
