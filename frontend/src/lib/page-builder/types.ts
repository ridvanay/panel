// ============================================================================
// Page-builder hiyerarşik konteyner (container) veri modeli — v3.
// Kaynak: `.claude/design-notes-page-builder-containers.md` §3 (BİREBİR uygulama).
// Backend karşılığı: `backend/src/modules/pages/pages.schemas.ts` — sayısal sabitler
// (bkz. §5 aşağıda) ARALARINDA SAYISAL OLARAK BİREBİR AYNI olmak zorundadır.
// ============================================================================

// ============================================================================
// 1) İÇERİK BLOKLARI — data şekilleri BİREBİR DEĞİŞMEZ (geriye dönük uyumluluk)
// ============================================================================

export type ContentBlockType =
  | "hero"
  | "text"
  | "image"
  | "gallery"
  | "cta"
  | "featured-products"
  | "featured-portfolio";

/** Kanonik konteyner düğümü. */
export type ContainerNodeType = "container";

/** v1/v2'de üretilmiş, ARTIK ÜRETİLMEYEN şekil — yalnızca `normalize.ts` tanır. */
export type LegacyBlockType = "columns";

export type BlockType = ContentBlockType | ContainerNodeType;

interface BaseNode {
  id: string;
}

export interface HeroBlock extends BaseNode {
  type: "hero";
  data: { heading: string; subheading?: string; imageUrl?: string };
}

export interface TextBlock extends BaseNode {
  type: "text";
  data: { html: string };
}

export interface ImageBlock extends BaseNode {
  type: "image";
  data: { url: string; alt: string };
}

/** Galeri bloğunun görsel düzeni — bkz. `.claude/design-notes-page-builder-gallery.md`. */
export type GalleryLayout = "grid" | "carousel" | "masonry";

export interface GalleryBlock extends BaseNode {
  type: "gallery";
  data: {
    images: { url: string; alt: string }[]; // MEVCUT şekil DEĞİŞMEZ — geriye dönük uyumluluk
    /**
     * Eski kayıtlarda YOK olabilir — okuyan taraf `block.data.layout ?? "grid"` ile
     * varsayılana düşer (bkz. `components/site/blocks/gallery-block.tsx`).
     */
    layout: GalleryLayout;
  };
}

export interface CtaBlock extends BaseNode {
  type: "cta";
  data: { heading: string; buttonLabel: string; buttonHref: string };
}

/**
 * §Faz 4 Site Şablonu — `products`/`portfolio` modülleri kapalıyken bu bloklar public tarafta
 * SESSİZCE hiçbir şey render ETMEZ (bkz. components/site/blocks). Şablon SADECE ÖNERİ niteliğinde,
 * bu bloklar herhangi bir modülü otomatik açmaz/kapatmaz.
 */
export interface FeaturedProductsBlock extends BaseNode {
  type: "featured-products";
  data: { heading?: string; limit: number; categoryId?: string };
}

export interface FeaturedPortfolioBlock extends BaseNode {
  type: "featured-portfolio";
  data: { heading?: string; limit: number; categoryId?: string };
}

/**
 * `children` TAŞIMAYAN düğümler. v2'nin `LeafBlock`'undan farkı: `hero` ARTIK DAHİLDİR
 * (§3.4 mimar dokümanı — tam-genişlik ihtiyacı artık `container.settings.layout: "full-width"`
 * ile karşılanıyor, tip seviyesinde yasaklamaya gerek kalmadı).
 */
export type ContentBlock =
  | HeroBlock
  | TextBlock
  | ImageBlock
  | GalleryBlock
  | CtaBlock
  | FeaturedProductsBlock
  | FeaturedPortfolioBlock;

/** @deprecated v2 adı — yalnızca geçiş sırasında import kırılmasın diye. Yeni kodda `ContentBlock` kullanın. */
export type LeafBlock = ContentBlock;

// ============================================================================
// 2) KONTEYNER
// ============================================================================

/** `boxed` = ortalanmış içerik kuyusu (max-width + güvenli gutter). `full-width` = kenardan kenara. */
export type ContainerLayout = "boxed" | "full-width";

export type ContainerDirection = "row" | "column";

/**
 * CSS `justify-content` karşılıkları — HAM CSS DEĞERİ SAKLANMAZ (`"flex-start"` gibi),
 * Tailwind sınıf son eki saklanır. Gerekçe: depolanan değer asla doğrudan CSS'e
 * enterpole edilmez, sabit bir sınıf tablosundan geçer (bkz. `container-block.tsx`).
 */
export type ContainerJustify = "start" | "center" | "end" | "between" | "around" | "evenly";

/** CSS `align-items` karşılıkları — aynı gerekçe. */
export type ContainerAlign = "stretch" | "start" | "center" | "end";

export type ContainerLengthUnit = "px" | "vh";

/** Sayısal, birimi enum — serbest CSS string'i DEĞİL. */
export interface ContainerLength {
  value: number;
  unit: ContainerLengthUnit;
}

/** Dört kenar, **piksel** cinsinden tam sayı. Negatif değer YASAK (bkz. mimar §5.2/§13.4). */
export interface ContainerSpacing {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export type ContainerBackgroundPosition = "center" | "top" | "bottom" | "left" | "right";
export type ContainerBackgroundSize = "cover" | "contain" | "auto";
export type ContainerBackgroundRepeat = "no-repeat" | "repeat";

/**
 * Ayrık birlik (discriminated union) — `{ type: "color", value }` ile
 * `{ type: "image", value }` aynı `value` alanını PAYLAŞMAZ; şema seviyesinde
 * farklı doğrulama kuralları uygulanır (hex regex vs. protokol beyaz listeli URL kontrolü).
 */
export type ContainerBackground =
  | { type: "none" }
  | { type: "color"; value: string }
  | {
      type: "image";
      value: string;
      position: ContainerBackgroundPosition;
      size: ContainerBackgroundSize;
      repeat: ContainerBackgroundRepeat;
    };

export interface ContainerSettings {
  /** `boxed` → ortalanmış + `maxWidth`; `full-width` → `w-full`. */
  layout: ContainerLayout;
  /** YALNIZCA `layout: "boxed"` iken anlamlı. Verilmezse `DEFAULT_CONTAINER_MAX_WIDTH` (1170). */
  customWidth?: number;
  minHeight?: ContainerLength;

  direction: ContainerDirection;
  justifyContent: ContainerJustify;
  alignItems: ContainerAlign;
  /** Piksel. `gap-*` Tailwind sınıfı DEĞİL — dinamik değer, inline style. */
  gap: number;

  padding: ContainerSpacing;
  margin: ContainerSpacing;
  background: ContainerBackground;

  /**
   * Bu konteynerin, `direction: "row"` olan EBEVEYNİ içindeki göreli genişlik ağırlığı.
   * CSS: `flex: <widthFr> 1 0%` (yani `flex-grow`). v2'deki `PageColumn.width` (`fr`)
   * ile SAYISAL OLARAK BİREBİR AYNI anlam — `1fr 2fr` ≡ `flex-grow: 1` + `flex-grow: 2`.
   * Ebeveyn `direction: "column"` ise veya düğüm kökteyse YOK SAYILIR.
   * `customWidth` ile KARIŞTIRILMAMALI: o, konteynerin KENDİ dış max-width'i (px).
   */
  widthFr?: number;
}

export interface ContainerNode extends BaseNode {
  type: "container";
  settings: ContainerSettings;
  children: PageNode[];
}

/** Ağaçtaki herhangi bir düğüm. `Page.blocks` = `PageNode[]` (kök dizi = örtük konteyner). */
export type PageNode = ContainerNode | ContentBlock;

/** @deprecated v2 adı — yeni kodda `PageNode`. */
export type Block = PageNode;

// ============================================================================
// 3) LEGACY OKUMA TİPLERİ — YALNIZCA `normalize.ts` kullanır, başka hiçbir yer DEĞİL
// ============================================================================

export type PageBlockGap = "none" | "sm" | "md" | "lg";
export type PageColumnVerticalAlign = "top" | "center" | "bottom";

/** @deprecated v1/v2 şekli — sadece `normalizePageNodes` girdisi olarak tanınır. */
export interface LegacyPageColumn {
  id: string;
  width?: number;
  blocks: unknown[];
}

/** @deprecated v1/v2 şekli. `data.columnCount`/`data.ratio` v1 kalıntılarıdır. */
export interface LegacyColumnsBlock {
  id: string;
  type: "columns";
  data: {
    gap?: PageBlockGap;
    verticalAlign?: PageColumnVerticalAlign;
    columns?: LegacyPageColumn[];
    columnCount?: number;
    ratio?: string;
  };
}

/** @deprecated v2 tip adı — yeni kodda kullanılmaz, yalnızca eski import'lar için tutulur. */
export type ColumnsBlockData = LegacyColumnsBlock["data"];
/** @deprecated v2 tip adı. */
export type ColumnsBlock = LegacyColumnsBlock;
/** @deprecated v2 tip adı — bkz. `LegacyPageColumn`. */
export type PageColumn = LegacyPageColumn;

// ============================================================================
// 4) dnd-kit SÖZLEŞMESİ
// ============================================================================

/**
 * Konteyner kimliği sözleşmesi v3: kök liste `"root"`, her konteyner
 * `"container:<node.id>"`. v2'nin `"col:<column.id>"` biçimi KALDIRILDI
 * (sütun artık ayrı bir varlık değil, sıradan bir `container`).
 */
export type BuilderContainerId = "root" | `container:${string}`;

// ============================================================================
// 5) SINIRLAR (backend `pages.schemas.ts` ile SAYISAL OLARAK AYNI OLMAK ZORUNDA)
// ============================================================================

/** Kök = 1. Bir konteyner en fazla 4. seviyede olabilir → yaprak bloklar en fazla 5. seviyede. */
export const MAX_CONTAINER_DEPTH = 4;
/**
 * Bir konteynerin doğrudan çocuk sayısı (v2'nin 20 ve 24'ünün birleşimi).
 *
 * NETLEŞTİRME (security-agent ön denetimi §13.2, architect onayı): bu sınır YALNIZCA gerçek
 * `container.children` dizilerine uygulanır. Kök `Page.blocks` dizisi bir "konteyner" DEĞİLDİR
 * (§2.2 — "örtük root container", ayarları serileştirilmez) ve bu sınıra TABİ DEĞİLDİR; kökte
 * yalnızca `MAX_TOTAL_PAGE_NODES` (300) ve `MAX_PAGE_BLOCKS_BYTES` geçerlidir. `containers.ts`
 * içindeki `insertNode`/`moveNode` bu ayrımı uygular: `parentId === "root"` iken çocuk-sayısı
 * kontrolü YAPILMAZ, yalnızca `parentId` bir `container:<id>` iken yapılır.
 */
export const MAX_CHILDREN_PER_CONTAINER = 24;
/** Sayfa başına TOPLAM düğüm (konteynerler DAHİL) — v2'nin 200'ünden yükseltildi. */
export const MAX_TOTAL_PAGE_NODES = 300;
/** Bu eşiğin üzerinde `direction: "row"` konteynerde okunabilirlik UYARISI (engelleyici DEĞİL). */
export const ROW_CHILDREN_READABILITY_WARNING_THRESHOLD = 6;
/** `layout: "boxed"` varsayılan max-width (px) — inline style, Tailwind sınıfı değil. */
export const DEFAULT_CONTAINER_MAX_WIDTH = 1170;
export const MIN_CONTAINER_MAX_WIDTH = 320;
export const MAX_CONTAINER_MAX_WIDTH = 1920;
/** Galeri bloğu başına en fazla görsel — DEĞİŞMEDİ. */
export const GALLERY_MAX_IMAGES = 30;

/** @deprecated v2 adları — geçiş süresince alias, sonra silinir. */
export const MAX_BLOCKS_PER_COLUMN = MAX_CHILDREN_PER_CONTAINER;
/** @deprecated v2 adı. */
export const MAX_COLUMNS_PER_ROW = MAX_CHILDREN_PER_CONTAINER;
/** @deprecated v2 adı. */
export const MAX_TOTAL_BLOCKS = MAX_TOTAL_PAGE_NODES;
/** @deprecated v2 adı. */
export const COLUMN_READABILITY_WARNING_THRESHOLD = ROW_CHILDREN_READABILITY_WARNING_THRESHOLD;

// ============================================================================
// 6) VARSAYILANLAR — tek kaynak, backend zod `.default()` değerleriyle BİREBİR aynı olmalı
// ============================================================================

export const DEFAULT_CONTAINER_SETTINGS: ContainerSettings = {
  layout: "boxed",
  direction: "column",
  justifyContent: "start",
  alignItems: "stretch",
  gap: 16,
  padding: { top: 0, right: 0, bottom: 0, left: 0 },
  margin: { top: 0, right: 0, bottom: 0, left: 0 },
  background: { type: "none" },
};

/** `BlockRenderer`'a geçilen, bir düğümün "kendi dış boşluğunu taşıyıp taşımadığı" bilgisi (§6.3). */
export type BlockChrome = "page" | "bare";
