export type BlockType = "hero" | "text" | "image" | "gallery" | "cta" | "featured-products" | "featured-portfolio";

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

/**
 * §Faz 4 Site Şablonu — `products`/`portfolio` modülleri kapalıyken bu bloklar public tarafta
 * SESSİZCE hiçbir şey render ETMEZ (bkz. components/site/blocks). Şablon SADECE ÖNERİ niteliğinde,
 * bu bloklar herhangi bir modülü otomatik açmaz/kapatmaz.
 */
export interface FeaturedProductsBlock extends BaseBlock {
  type: "featured-products";
  data: { heading?: string; limit: number; categoryId?: string };
}

export interface FeaturedPortfolioBlock extends BaseBlock {
  type: "featured-portfolio";
  data: { heading?: string; limit: number; categoryId?: string };
}

export type Block =
  | HeroBlock
  | TextBlock
  | ImageBlock
  | GalleryBlock
  | CtaBlock
  | FeaturedProductsBlock
  | FeaturedPortfolioBlock;
