import { z } from "zod";
import type {
  SliderTransitionEffect,
  SliderHeightMode,
  SlideBackgroundType,
  SliderNavigationTheme,
  SliderWidthMode,
} from "../../schemas/entities";
import type { SocialPlatform } from "@prisma/client";
import type { SliderLayer } from "../sliders/lib/layers";
import type { UpdateSiteAppearanceRequest } from "../appearance/appearance.schemas";

/**
 * `.claude/architect-scope-demo-template-import.md` §3 — `DemoTemplateDefinition` şeması
 * (BAĞLAYICI). Bu dosyadaki şekil, kararın §3'ündeki TypeScript arayüzüyle BİREBİR aynıdır;
 * alan eklemek/çıkarmak o dokümanın güncellenmesini gerektirir.
 *
 * `page.blocks`/`slider.slides[].layers` içerikleri BURADA yalnızca TİP GÜVENLİĞİ (derleme
 * zamanı) sağlar — §2'nin bağlayıcı ikinci katmanı (ÇALIŞMA ZAMANI Zod doğrulaması,
 * `pages.schemas.ts::PageBlockListSchema` / `sliders/lib/layers.ts::SlideLayersSchema`) AYRI ve
 * ZORUNLUDUR; `importer.ts` ve birim testleri her ikisini de uygular. Bu yüzden aşağıdaki
 * `PageNode` yerel tipi, frontend `lib/page-builder/types.ts::PageNode`'un TAMAMINI (23 blok
 * tipi) MODELLEMEZ — yalnızca `modern-architecture` (ve gelecekteki şablonların) fiilen
 * kullandığı alt kümeyi kapsar; backend bu dosyaları frontend paketinden import EDEMEZ (ayrı
 * dağıtılabilir servisler), bu yüzden yapısal bir yerel ayna tutulur.
 */

/* ---------------------------------------------------------------------------------------------
 * §3.3 — üretilecek kayıt hacmi üst sınırları (bağlayıcı)
 * ------------------------------------------------------------------------------------------- */

export const MAX_TEMPLATE_ASSETS = 24;
export const MAX_TEMPLATE_ASSET_BYTES = 512 * 1024; // dosya BAŞINA
export const MAX_TEMPLATE_PORTFOLIO_ITEMS = 12;
export const MAX_TEMPLATE_NAV_ITEMS = 30; // kök + alt, TOPLAM
export const MAX_TEMPLATE_FOOTER_COLUMNS = 6;

/* ---------------------------------------------------------------------------------------------
 * §3 — `DemoTemplateAsset`
 * ------------------------------------------------------------------------------------------- */

export interface DemoTemplateAsset {
  /** Şablon içinde benzersiz, kebab-case. `asset:<key>` token'ının gövdesi. */
  key: string;
  /** `assets/<templateKey>/` altındaki dosya adı. Yol ayracı İÇEREMEZ (§4.4 güvenlik). */
  file: string;
  /** `Media.altText` — a11y için ZORUNLU, boş olamaz. */
  altText: string;
}

/* ---------------------------------------------------------------------------------------------
 * §3.4 pratik gereği — §3'teki `navigation`/`appearance` alt tipleri
 * ------------------------------------------------------------------------------------------- */

export interface DemoTemplateNavItem {
  label: string;
  href: string;
  children?: { label: string; href: string }[];
}

/**
 * §7 — `UpdateSiteAppearanceRequest` gövdesiyle BİREBİR aynı şekil (tüm alanlar opsiyonel;
 * şablon yalnızca ihtiyaç duyduğu alt kümeyi doldurur, geri kalanı `SiteAppearance`'ın kendi
 * `DEFAULTS`'una düşer — bkz. `appearance.routes.ts::DEFAULTS`).
 */
export type DemoTemplateAppearance = UpdateSiteAppearanceRequest;

/* ---------------------------------------------------------------------------------------------
 * Sayfa builder — yerel yapısal `PageNode` aynası (yalnızca kullanılan blok tipleri)
 * ------------------------------------------------------------------------------------------- */

interface DemoBaseNode {
  id: string;
}

export interface DemoContainerBackgroundNone {
  type: "none";
}
export interface DemoContainerBackgroundColor {
  type: "color";
  value: string;
}
export interface DemoContainerBackgroundImage {
  type: "image";
  /** `asset:<key>` token'ı kabul eder — importer bunu gerçek `Media.url`'e çözer (§3.4). */
  value: string;
  position?: "center" | "top" | "bottom" | "left" | "right";
  size?: "cover" | "contain" | "auto";
  repeat?: "no-repeat" | "repeat";
  overlay?: { color: string; opacity: number };
}
export type DemoContainerBackground = DemoContainerBackgroundNone | DemoContainerBackgroundColor | DemoContainerBackgroundImage;

export interface DemoSpacing {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface DemoShapeDivider {
  type: "wave" | "slant" | "triangle" | "curve";
  color: string;
  height: number;
  flip: boolean;
}

export interface DemoContainerSettings {
  layout: "boxed" | "full-width";
  customWidth?: number;
  minHeight?: { value: number; unit: "px" | "vh" };
  direction: "row" | "column";
  justifyContent: "start" | "center" | "end" | "between" | "around" | "evenly";
  alignItems: "stretch" | "start" | "center" | "end";
  gap: number;
  padding: DemoSpacing;
  margin: DemoSpacing;
  background: DemoContainerBackground;
  widthFr?: number;
  topDivider?: DemoShapeDivider;
  bottomDivider?: DemoShapeDivider;
}

export interface DemoContainerNode extends DemoBaseNode {
  type: "container";
  settings: DemoContainerSettings;
  children: PageNode[];
}

export interface DemoAdvancedSliderNode extends DemoBaseNode {
  type: "advanced-slider";
  /** `ref:slider` token'ı kabul eder — importer bunu gerçek `Slider.id`'ye çözer (§3.4/§3.1). */
  data: { sliderId: string };
}

export interface DemoHeadingNode extends DemoBaseNode {
  type: "heading";
  data: { text: string; level: 1 | 2 | 3 | 4 | 5 | 6; align: "left" | "center" | "right"; underline: boolean };
}

export interface DemoTextNode extends DemoBaseNode {
  type: "text";
  data: { html: string };
}

export interface DemoIconBoxNode extends DemoBaseNode {
  type: "icon-box";
  data: { icon: string; heading: string; description: string; href?: string };
}

export interface DemoButtonNode extends DemoBaseNode {
  type: "button";
  data: {
    label: string;
    href: string;
    style: "solid" | "outline" | "ghost";
    size: "sm" | "md" | "lg";
    icon?: string;
    align: "left" | "center" | "right";
  };
}

export interface DemoCounterNode extends DemoBaseNode {
  type: "counter";
  data: { items: { id: string; value: number; prefix?: string; suffix?: string; label: string }[] };
}

export interface DemoCtaNode extends DemoBaseNode {
  type: "cta";
  data: {
    heading: string;
    buttonLabel: string;
    buttonHref: string;
    description?: string;
    align?: "left" | "center" | "right";
    style?: "plain" | "soft" | "solid" | "outline";
    secondaryButtonLabel?: string;
    secondaryButtonHref?: string;
  };
}

export interface DemoContactFormNode extends DemoBaseNode {
  type: "contact-form";
  data: { showTitle: boolean };
}

export interface DemoFeaturedPortfolioNode extends DemoBaseNode {
  type: "featured-portfolio";
  data: { heading?: string; limit: number; categoryId?: string };
}

/** Ağaçtaki herhangi bir düğüm — bu registry'nin FİİLEN kullandığı alt küme (bkz. dosya başlığı). */
export type PageNode =
  | DemoContainerNode
  | DemoAdvancedSliderNode
  | DemoHeadingNode
  | DemoTextNode
  | DemoIconBoxNode
  | DemoButtonNode
  | DemoCounterNode
  | DemoCtaNode
  | DemoContactFormNode
  | DemoFeaturedPortfolioNode;

/* ---------------------------------------------------------------------------------------------
 * §3 — `DemoTemplateDefinition` (ana şema)
 * ------------------------------------------------------------------------------------------- */

export interface DemoTemplateDefinition {
  /** Registry anahtarı, kebab-case, DB'de `DemoTemplateImport.templateKey`. */
  key: string;
  /** Semver. Şablon içeriği değişince ARTIRILIR (§6.4 yeniden uygulama raporu için). */
  version: string;
  name: string;
  description: string;
  /** Admin panelinde gösterilen önizleme — Media DEĞİL, frontend statiği (§4.5). */
  previewImageUrl: string;
  /** Filtreleme/rozet amaçlı serbest etiketler. */
  tags: string[];

  /** §4 — TÜM görseller burada, TEK yerde tanımlanır. */
  assets: DemoTemplateAsset[];

  /** §7 — `UpdateSiteAppearanceRequest` gövdesiyle BİREBİR aynı şekil. */
  appearance: DemoTemplateAppearance;

  /** Singleton site ayarları — yalnızca aşağıdaki 5 alan yazılır, başkası DEĞİL (§6.2). */
  settings: {
    siteName: string;
    tagline: string | null;
    headerCtaLabel: string | null;
    headerCtaHref: string | null;
    footerCopyrightText: string | null;
  };

  /** Maks. 2 seviye — `NavigationItem.parentId` kuralı (§6.2). */
  navigation: DemoTemplateNavItem[];
  footer: { columns: { title: string; links: { label: string; href: string }[] }[] };
  socialLinks: { platform: SocialPlatform; url: string }[];

  portfolio: {
    categories: { name: string; slug: string }[];
    items: {
      title: string;
      slug: string;
      summary: string | null;
      contentHtml: string;
      clientName: string | null;
      categorySlug: string | null;
      /** `assets[].key` referansı → `PortfolioItem.coverMediaId` (GERÇEK Media FK). */
      coverAssetKey: string | null;
      /** `assets[].key` referansları → `PortfolioImage.mediaId` (GERÇEK Media FK). */
      galleryAssetKeys: string[];
      order: number;
      status: "PUBLISHED";
    }[];
  };

  /** Hero Studio slider'ı. `null` = bu şablon slider getirmiyor. */
  slider: {
    name: string;
    slug: string;
    autoplay: boolean;
    intervalMs: number;
    loop: boolean;
    pauseOnHover: boolean;
    transitionEffect: SliderTransitionEffect;
    transitionDurationMs: number;
    heightMode: SliderHeightMode;
    heightPx: number | null;
    aspectRatioWidth: number;
    aspectRatioHeight: number;
    widthMode: SliderWidthMode;
    showArrows: boolean;
    showBullets: boolean;
    showProgressBar: boolean;
    navigationTheme: SliderNavigationTheme;
    slides: {
      label: string | null;
      isActive: boolean;
      bgType: SlideBackgroundType;
      /** `assets[].key` → `Slide.bgMediaId` (GERÇEK Media FK). */
      bgAssetKey: string | null;
      bgPositionX: number;
      bgPositionY: number;
      bgOverlayColor: string | null;
      bgOverlayOpacity: number;
      bgGradientFrom: string | null;
      bgGradientTo: string | null;
      bgGradientAngle: number;
      bgKenBurns: boolean;
      durationMs: number | null;
      linkHref: string | null;
      linkNewTab: boolean;
      /** `sliders/lib/layers.ts::SliderLayer[]` ile BİREBİR (Zod-türetilmiş çıktı tipi). */
      layers: SliderLayer[];
    }[];
  } | null;

  page: {
    title: string;
    slug: string;
    seoTitle: string | null;
    seoDescription: string | null;
    /** `PageNode[]` — çalışma zamanında `PageBlockListSchema`'dan geçirilir (§2). */
    blocks: PageNode[];
    /** true → `SiteSettings.homePageId` bu sayfaya YAZILIR (istek düzeyindeki `setAsHomePage`
     *  ile BİRLİKTE değerlendirilir — bkz. `importer.ts`, ikisi de true ise ana sayfa olur). */
    setAsHomePage: boolean;
  };
}

/* ---------------------------------------------------------------------------------------------
 * §3.3 — kayıt hacmi tavanlarının Zod ile zorlanması (registry.ts modül-yükleme anında çağırır)
 * ------------------------------------------------------------------------------------------- */

const DemoTemplateAssetShapeSchema = z.object({
  key: z.string().min(1),
  file: z
    .string()
    .min(1)
    .refine((f) => !f.includes("/") && !f.includes("\\"), "`file` yol ayracı içeremez (§4.4 güvenlik)."),
  altText: z.string().min(1, "`altText` boş olamaz (a11y, §4.4)."),
});

/** `GET /admin/demo-templates` özetinde `contents.navigationItems` VE §3.3 tavan kontrolünde ortak kullanılır. */
export function countNavItemsTotal(items: DemoTemplateNavItem[]): number {
  let total = 0;
  for (const item of items) {
    total += 1 + (item.children?.length ?? 0);
  }
  return total;
}

/**
 * §3.3'ün Zod ile zorlanması — `page.blocks`/`slider.slides[].layers` içeriği BURADA
 * DOĞRULANMAZ (o, `PageBlockListSchema`/`SlideLayersSchema`'nın işidir, §2 madde 3); bu şema
 * yalnızca kayıt HACMİ tavanlarını (§3.3) ve varlık dosya adı güvenliğini kontrol eder.
 */
export const DemoTemplateCapsSchema = z.object({
  assets: z.array(DemoTemplateAssetShapeSchema).max(MAX_TEMPLATE_ASSETS, `En fazla ${MAX_TEMPLATE_ASSETS} varlık olabilir.`),
  navigation: z.custom<DemoTemplateNavItem[]>().superRefine((items, ctx) => {
    const arr = items as DemoTemplateNavItem[];
    if (countNavItemsTotal(arr) > MAX_TEMPLATE_NAV_ITEMS) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Toplam navigasyon öğesi (kök + alt) en fazla ${MAX_TEMPLATE_NAV_ITEMS} olabilir.` });
    }
  }),
  footerColumns: z.array(z.unknown()).max(MAX_TEMPLATE_FOOTER_COLUMNS, `En fazla ${MAX_TEMPLATE_FOOTER_COLUMNS} footer sütunu olabilir.`),
  portfolioItems: z.array(z.unknown()).max(MAX_TEMPLATE_PORTFOLIO_ITEMS, `En fazla ${MAX_TEMPLATE_PORTFOLIO_ITEMS} portföy öğesi olabilir.`),
});

/** `registry.ts` her tanımı module-yükleme anında BUNUNLA doğrular — ihlal, uygulamanın açılışında/ilk importta patlar ("derlenmez/testten geçmez", §3.3). */
export function assertDemoTemplateCaps(definition: DemoTemplateDefinition): void {
  const result = DemoTemplateCapsSchema.safeParse({
    assets: definition.assets,
    navigation: definition.navigation,
    footerColumns: definition.footer.columns,
    portfolioItems: definition.portfolio.items,
  });
  if (!result.success) {
    const messages = result.error.issues.map((issue) => issue.message).join("; ");
    throw new Error(`Demo şablon tanımı "${definition.key}" §3.3 kayıt hacmi tavanlarını ihlal ediyor: ${messages}`);
  }

  const keys = new Set<string>();
  for (const asset of definition.assets) {
    if (keys.has(asset.key)) {
      throw new Error(`Demo şablon tanımı "${definition.key}": yinelenen assets[].key: "${asset.key}".`);
    }
    keys.add(asset.key);
  }
}
