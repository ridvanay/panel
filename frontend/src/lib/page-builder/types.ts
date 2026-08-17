export type BlockType =
  | "hero"
  | "text"
  | "image"
  | "gallery"
  | "cta"
  | "featured-products"
  | "featured-portfolio"
  | "columns";

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

/**
 * §10.17 — sütun konteynerinin İÇİNE konabilen bloklar. `columns` (derinlik en fazla 1) ve
 * `hero` (tam-bleed banner, dar bir sütunda anlamsız) HARİÇ — mimar kararı, ARCHITECTURE.md
 * §10.17.3.
 */
export type LeafBlock =
  | TextBlock
  | ImageBlock
  | GalleryBlock
  | CtaBlock
  | FeaturedProductsBlock
  | FeaturedPortfolioBlock;

export type PageColumnCount = 2 | 3;
/** columnCount=2 → "1-1"|"2-1"|"1-2"; columnCount=3 → yalnızca "1-1-1". Uyumsuzluk 422 (backend). */
export type PageColumnRatio = "1-1" | "2-1" | "1-2" | "1-1-1";
export type PageBlockGap = "none" | "sm" | "md" | "lg";
export type PageColumnVerticalAlign = "top" | "center" | "bottom";

export interface PageColumn {
  id: string;
  /** En fazla 20 blok (§10.17.3). */
  blocks: LeafBlock[];
}

export interface ColumnsBlockData {
  columnCount: PageColumnCount;
  ratio: PageColumnRatio;
  gap: PageBlockGap;
  verticalAlign: PageColumnVerticalAlign;
  /** Uzunluğu `columnCount` ile EŞİT olmalıdır (422). */
  columns: PageColumn[];
}

/**
 * "Tam Genişlik" bir DEĞER DEĞİL, bu bloğun YOKLUĞUDUR — bkz. `lib/page-builder/columns.ts`
 * (wrap/unwrap işlemleri) ve ARCHITECTURE.md §10.17.3.
 */
export interface ColumnsBlock extends BaseBlock {
  type: "columns";
  data: ColumnsBlockData;
}

export type Block =
  | HeroBlock
  | TextBlock
  | ImageBlock
  | GalleryBlock
  | CtaBlock
  | FeaturedProductsBlock
  | FeaturedPortfolioBlock
  | ColumnsBlock;

/**
 * dnd-kit çok-konteynerli sürükle-bırak için konteyner kimliği SÖZLEŞMESİ: kök liste "root",
 * her sütun "col:<column.id>" (§10.17.6).
 */
export type BuilderContainerId = "root" | `col:${string}`;

export const MAX_BLOCKS_PER_COLUMN = 20;
export const MAX_TOTAL_BLOCKS = 200;
