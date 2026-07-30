export type BlockType = "hero" | "text" | "image" | "gallery" | "cta";

interface BaseBlock {
  id: string;
  type: BlockType;
}

export interface HeroBlock extends BaseBlock {
  type: "hero";
  data: { heading: string; subheading?: string; imageUrl?: string };
}

export interface TextBlock extends BaseBlock {
  type: "text";
  data: { html: string };
}

export interface ImageBlock extends BaseBlock {
  type: "image";
  data: { url: string; alt: string };
}

export interface GalleryBlock extends BaseBlock {
  type: "gallery";
  data: { images: { url: string; alt: string }[] };
}

export interface CtaBlock extends BaseBlock {
  type: "cta";
  data: { heading: string; buttonLabel: string; buttonHref: string };
}

export type Block = HeroBlock | TextBlock | ImageBlock | GalleryBlock | CtaBlock;
