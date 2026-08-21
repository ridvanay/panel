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
  | "featured-portfolio"
  | "heading"
  | "button"
  | "icon-box"
  | "divider"
  | "video"
  | "accordion"
  | "tabs"
  | "counter"
  | "testimonial"
  | "pricing-table";

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

/** Görselin köşe yuvarlaklığı — sabit Tailwind sınıf tablosuna eşlenir (bkz. `site/blocks/image-block.tsx`). */
export type ImageRadius = "none" | "sm" | "md" | "lg" | "full";

export interface ImageBlock extends BaseNode {
  type: "image";
  data: {
    url: string;
    alt: string;
    /** §Faz "Medya & İnteraktif" — YENİ alanlar, hepsi OPSİYONEL (geriye dönük uyumluluk: eski
     *  kayıtlarda YOK, okuyan taraf `??` ile varsayılana düşer). */
    caption?: string;
    radius?: ImageRadius;
    /** `true` ise görsele tıklamak `gallery-lightbox.tsx`'i TEK görsellik bir dizi ile açar. */
    lightbox?: boolean;
  };
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

/**
 * CTA kutusunun görsel tonu — HAM CSS/renk DEĞERİ DEĞİL, sabit bir sınıf tablosuna eşlenen kısa
 * isimler (`ImageRadius`/`ButtonBlock.style` ile AYNI desen; konteynerin serbest `background`
 * sistemi BURADA KASITLI OLARAK KULLANILMAZ — CTA yalnızca tema paletinden birkaç hazır tonu
 * sunar, isteyen kullanıcı bloğu bir `container` içine koyup tam background kontrolü alır).
 * `plain` = bugünkü kutusuz görünüm (eski kayıtların ve yeni blokların VARSAYILANI).
 */
export type CtaStyle = "plain" | "soft" | "solid" | "outline";

export interface CtaBlock extends BaseNode {
  type: "cta";
  data: {
    heading: string; // MEVCUT şekil DEĞİŞMEZ — geriye dönük uyumluluk
    buttonLabel: string;
    buttonHref: string;
    /** §Faz "Pazarlama & Sosyal Kanıt" — YENİ alanlar, hepsi OPSİYONEL (geriye dönük uyumluluk:
     *  eski kayıtlarda YOK, okuyan taraf `??` ile varsayılana düşer — `ImageBlock` ile AYNI desen).
     *  Varsayılanlar bugünkü render'ı BİREBİR korur: `align ?? "center"`, `style ?? "plain"`. */
    description?: string;
    align?: TextAlign;
    style?: CtaStyle;
    /** İkincil (düşük vurgulu) buton. İkisi de DOLU değilse buton HİÇ render EDİLMEZ —
     *  yarım yapılandırma sessizce yok sayılır (etiketsiz/hedefsiz buton üretilmez). */
    secondaryButtonLabel?: string;
    secondaryButtonHref?: string;
  };
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

/** §Faz "Temel Elemanlar" — H1-H6, hizalama, opsiyonel alt çizgi vurgusu. */
export type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;
export type TextAlign = "left" | "center" | "right";

export interface HeadingBlock extends BaseNode {
  type: "heading";
  data: { text: string; level: HeadingLevel; align: TextAlign; underline: boolean };
}

/**
 * `style`/`size` HAM CSS DEĞERİ DEĞİL — `@/components/ui/link-button.tsx::LinkButton`'ın
 * `buttonVariants`'ına eşlenen kısa isimler (bkz. `site/blocks/button-block.tsx`). `icon`
 * VARSA `lib/page-builder/icon-options.ts::resolveIcon`'dan geçer — bilinmeyen/eski bir isim
 * güvenli bir varsayılana düşer, ASLA dinamik import/require yapılmaz.
 */
export interface ButtonBlock extends BaseNode {
  type: "button";
  data: { label: string; href: string; style: "solid" | "outline" | "ghost"; size: "sm" | "md" | "lg"; icon?: string; align: TextAlign };
}

/** İkon Kutusu — `icon` aynı `icon-options.ts` allowlist'inden. */
export interface IconBoxBlock extends BaseNode {
  type: "icon-box";
  data: { icon: string; heading: string; description: string; href?: string };
}

/**
 * Ayırıcı VE Boşluk TEK blok tipi olarak modellenir (kullanıcı isteğinde "Ayırıcı & Boşluk"
 * tek madde) — `variant` ayrımlar. `style` yalnızca `variant: "line"` iken anlamlıdır.
 */
export interface DividerBlock extends BaseNode {
  type: "divider";
  data: { variant: "line" | "space"; style: "solid" | "dashed"; height: number };
}

/**
 * §Faz "Medya & İnteraktif" — Video Oynatıcı. `url` sağlayıcıya göre farklı biçimlerde olabilir
 * (YouTube/Vimeo sayfa URL'i VEYA doğrudan `.mp4` dosya URL'i) — GERÇEK embed URL'i render
 * anında `lib/page-builder/video-embed.ts::getVideoEmbedUrl` ile HESAPLANIR, ham `url` HİÇBİR
 * ZAMAN doğrudan bir `<iframe src>`e YAZILMAZ (yalnızca sağlayıcının KENDİ domanindeki, id'si
 * regex ile ÇIKARILMIŞ bir embed URL'i inşa edilir) — bu, gelecekteki "Özel HTML" bloğunun da
 * izleyeceği "yapılandırılmış embed" güvenlik deseninin İLK örneğidir.
 */
export type VideoProvider = "youtube" | "vimeo" | "mp4";

export interface VideoBlock extends BaseNode {
  type: "video";
  data: { provider: VideoProvider; url: string; autoplay: boolean; muted: boolean };
}

/** Bir konteynerdeki toplam öğe sınırlarından (§5) BAĞIMSIZ, bloğa ÖZGÜ üst sınırlar — backend
 *  `pages.schemas.ts`teki `ACCORDION_MAX_ITEMS`/`TABS_MAX_ITEMS` ile SAYISAL OLARAK BİREBİR AYNI
 *  olmak zorundadır (bkz. dosya başlığındaki §5 aynı uyarı). */
export const ACCORDION_MAX_ITEMS = 20;
export const TABS_MAX_ITEMS = 10;

export interface AccordionQAItem {
  id: string;
  question: string;
  /** KASITLI OLARAK düz metin (HTML DEĞİL) — hem yeni bir sanitizasyon yolu AÇMAMAK için hem de
   *  Schema.org FAQPage JSON-LD çıktısının (bkz. site render) temiz/geçerli kalması için. */
  answer: string;
}

/** Akordiyon / SSS — Schema.org FAQPage JSON-LD üretir (bkz. `site/blocks/accordion-block.tsx`). */
export interface AccordionBlock extends BaseNode {
  type: "accordion";
  data: { items: AccordionQAItem[]; allowMultipleOpen: boolean };
}

export interface TabItem {
  id: string;
  label: string;
  /** `answer` ile AYNI gerekçe — düz metin, satır sonları paragraf olarak render edilir. */
  content: string;
}

export interface TabsBlock extends BaseNode {
  type: "tabs";
  data: { orientation: "horizontal" | "vertical"; items: TabItem[] };
}

/** §Faz "Pazarlama & Sosyal Kanıt" — bloğa ÖZGÜ üst sınırlar; `ACCORDION_MAX_ITEMS` ile AYNI
 *  gerekçe ve AYNI kural: backend `pages.schemas.ts` ile SAYISAL OLARAK BİREBİR AYNI olmak
 *  zorundadır (bkz. dosya başlığındaki §5 uyarısı). */
export const COUNTER_MAX_ITEMS = 8;
export const TESTIMONIAL_MAX_ITEMS = 12;
export const PRICING_MAX_PLANS = 6;
/** Plan BAŞINA özellik satırı sınırı (plan sayısından BAĞIMSIZ). */
export const PRICING_MAX_FEATURES = 15;

export interface CounterItem {
  id: string;
  /** KASITLI OLARAK sayı (string DEĞİL) — biçimlendirme (binlik ayracı) render anında
   *  `Intl.NumberFormat("tr-TR")` ile yapılır, kullanıcı "500.000" yazıp ayracı elle KURGULAMAZ.
   *  Metinsel varyasyonlar (`"500+"`, `"%98"`) `prefix`/`suffix` ile ifade edilir. */
  value: number;
  /** Sayının ÖNÜNE eklenen düz metin — ör. `"%"`, `"₺"`. */
  prefix?: string;
  /** Sayının ARKASINA eklenen düz metin — ör. `"+"`, `"K"`. */
  suffix?: string;
  label: string;
}

/** Sayaç / İstatistik — ör. "500+ Müşteri", "%98 Memnuniyet". */
export interface CounterBlock extends BaseNode {
  type: "counter";
  data: { items: CounterItem[] };
}

/** 1–5 arası tam yıldız — yarım yıldız KASITLI OLARAK DESTEKLENMEZ (MVP). */
export type TestimonialRating = 1 | 2 | 3 | 4 | 5;

export interface TestimonialItem {
  id: string;
  /** `AccordionQAItem.answer` ile AYNI gerekçe — düz metin (HTML DEĞİL), yeni bir sanitizasyon
   *  yolu açılmaz; satır sonları paragraf olarak render edilir. */
  quote: string;
  authorName: string;
  authorRole?: string;
  /** `ImageBlock.url`/`GalleryBlock.images[].url` ile AYNI serbestlik: göreli yol VEYA mutlak
   *  http(s) URL. Backend'de konteyner background görseliyle AYNI katılıkta protokol beyaz
   *  listesinden geçer (`SafeHrefSchema`) — `javascript:`/`data:` ASLA kabul edilmez. */
  avatarUrl?: string;
  rating?: TestimonialRating;
}

/** Müşteri Yorumları — sosyal kanıt kartları. */
export interface TestimonialBlock extends BaseNode {
  type: "testimonial";
  data: { items: TestimonialItem[] };
}

export interface PricingPlan {
  id: string;
  name: string;
  /** KASITLI OLARAK serbest metin (sayı DEĞİL) — `"₺299"`, `"Ücretsiz"`, `"Bize Sorun"` gibi
   *  biçimlerin HEPSİ geçerlidir; para birimi/biçim kararı içerik yazarına aittir. */
  price: string;
  /** Fiyatın yanında küçük punto ile gösterilen dönem — ör. `"/ay"`, `"/yıl"`. */
  period?: string;
  description?: string;
  /** Düz metin satırları; en fazla `PRICING_MAX_FEATURES` adet. */
  features: string[];
  /** `true` ise plan "öne çıkan" olarak vurgulanır. Birden fazla plan işaretlenebilir —
   *  tip seviyesinde "tek highlight" kısıtı YOKTUR, editör bunu bir UYARI ile bildirir. */
  highlighted?: boolean;
  buttonLabel: string;
  buttonHref: string;
}

/** Fiyatlandırma Tablosu — yan yana plan kartları. */
export interface PricingTableBlock extends BaseNode {
  type: "pricing-table";
  data: { plans: PricingPlan[] };
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
  | FeaturedPortfolioBlock
  | HeadingBlock
  | ButtonBlock
  | IconBoxBlock
  | DividerBlock
  | VideoBlock
  | AccordionBlock
  | TabsBlock
  | CounterBlock
  | TestimonialBlock
  | PricingTableBlock;

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
