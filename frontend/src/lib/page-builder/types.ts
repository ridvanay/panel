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

export type PageBlockGap = "none" | "sm" | "md" | "lg";
export type PageColumnVerticalAlign = "top" | "center" | "bottom";

export interface PageColumn {
  id: string;
  /** Göreli genişlik ağırlığı (CSS grid `fr` birimi) — varsayılan 1 (eşit pay). §10.17.3 v2. */
  width: number;
  /** En fazla 20 blok (§10.17.3). */
  blocks: LeafBlock[];
}

export interface ColumnsBlockData {
  gap: PageBlockGap;
  verticalAlign: PageColumnVerticalAlign;
  /** En az 2 sütun — üst sınır `MAX_COLUMNS_PER_ROW` (pratik bir UX sınırı değil, backend DoS koruması). */
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
/** Bir satırdaki üst sınır — pratik bir UX sınırı değil, salt backend DoS koruması (§10.17.3 v2). */
export const MAX_COLUMNS_PER_ROW = 24;
/** Bu eşiğin üzerinde editör okunabilirlik uyarısı gösterir ama İZİN VERMEYE devam eder. */
export const COLUMN_READABILITY_WARNING_THRESHOLD = 6;
