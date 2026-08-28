/**
 * Gelişmiş Slider / Hero Studio — TS tipleri. Kaynak: `.claude/architect-scope-advanced-slider.md`
 * (bağlayıcı) ve `docs/architecture/openapi.yaml` (`Sliders` tag'i, TEK doğruluk kaynağı). Backend
 * karşılığı: `backend/src/modules/sliders/sliders.schemas.ts` + `backend/src/schemas/entities.ts`.
 * Bu dosyadaki şekiller o dosyalarla BİREBİR aynı olmak ZORUNDADIR.
 */
import type { Media } from "@/lib/api/types";

export type SliderTransitionEffect = "slide" | "fade" | "cube" | "zoom";

/** `full-screen` → `100svh` (`100vh` DEĞİL). Sıfır CLS'in tek kaynağı — bkz. architect §5.2. */
export type SliderHeightMode = "full-screen" | "custom-px" | "aspect-ratio";

/** Düz renk için AYRI tip YOK — `gradient` ile `bgGradientFrom == bgGradientTo` verilir. */
export type SlideBackgroundType = "image" | "video" | "gradient";

/** Slayt ZEMİNİNİN açık/koyu olduğunu adlandırır, kromanın kendi rengini DEĞİL. */
export type SliderNavigationTheme = "light" | "dark";

export type SliderLayerType = "heading" | "text" | "button" | "image" | "badge";

export type SliderLayerOrigin =
  | "top-left"
  | "top-center"
  | "top-right"
  | "middle-left"
  | "middle-center"
  | "middle-right"
  | "bottom-left"
  | "bottom-center"
  | "bottom-right";

export interface SliderLayerPosition {
  xPercent: number;
  yPercent: number;
  origin: SliderLayerOrigin;
  /** px, hizalama ön ayarından sonra ince ayar. Varsayılan 0. */
  offsetX?: number;
  offsetY?: number;
  /** Slayt genişliğinin yüzdesi. Verilmezse içerik kadar (`auto`). */
  widthPercent?: number;
  zIndex?: number;
}

export interface SliderLayerStylePadding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** HAM CSS KABUL EDİLMEZ — her alan kapalı bir küme veya sınırlı sayısal aralıktır. */
export interface SliderLayerStyle {
  color?: string;
  backgroundColor?: string;
  backgroundOpacity?: number;
  fontFamily?: "inherit" | "heading" | "body";
  fontSize?: number;
  fontWeight?: 300 | 400 | 500 | 600 | 700 | 800 | 900;
  lineHeight?: number;
  letterSpacing?: number;
  textAlign?: "left" | "center" | "right";
  textTransform?: "none" | "uppercase";
  padding?: SliderLayerStylePadding;
  borderRadius?: number;
  opacity?: number;
  shadow?: "none" | "sm" | "md" | "lg";
  maxWidthPx?: number;
}

export type SliderLayerInEffect =
  | "none"
  | "fade"
  | "fade-up"
  | "fade-down"
  | "slide-in-left"
  | "slide-in-right"
  | "zoom-in"
  | "flip-up";

export interface SliderLayerAnimation {
  inEffect: SliderLayerInEffect;
  /** ms, 50 adımlarla. Slaytın AKTİF OLDUĞU ANDAN (`t=0`) itibaren ölçülür. */
  delayMs: number;
  durationMs: number;
  easing?: "linear" | "ease-out" | "ease-in-out" | "spring";
}

/** `content` BİLİNÇLİ OLARAK override EDİLEMEZ (v1 sınırı) — bkz. architect §2.4. */
export interface SliderLayerResponsiveOverride {
  hidden?: boolean;
  position?: Partial<SliderLayerPosition>;
  style?: SliderLayerStyle;
  animation?: Partial<SliderLayerAnimation>;
}

/** Masaüstü için ANAHTAR YOKTUR — kök alanlar masaüstüdür. */
export interface SliderLayerResponsive {
  tablet?: SliderLayerResponsiveOverride;
  mobile?: SliderLayerResponsiveOverride;
}

interface SliderLayerBase {
  /** İstemcide üretilen kararlı kimlik (`registry.ts::newId` deseni). */
  id: string;
  position: SliderLayerPosition;
  style: SliderLayerStyle;
  animation: SliderLayerAnimation;
  responsive?: SliderLayerResponsive;
}

export interface HeadingLayerContent {
  text: string;
  level?: 1 | 2 | 3;
}
export interface TextLayerContent {
  text: string;
}
export interface ButtonLayerContent {
  label: string;
  href: string;
  variant: "solid" | "outline" | "ghost";
  size: "sm" | "md" | "lg";
  icon?: string;
}
export interface ImageLayerContent {
  url: string;
  alt: string;
}
export interface BadgeLayerContent {
  text: string;
}

/** `type` üzerinden ayrık birlik — `content` şekli tipe göre değişir. */
export type SliderLayer =
  | (SliderLayerBase & { type: "heading"; content: HeadingLayerContent })
  | (SliderLayerBase & { type: "text"; content: TextLayerContent })
  | (SliderLayerBase & { type: "button"; content: ButtonLayerContent })
  | (SliderLayerBase & { type: "image"; content: ImageLayerContent })
  | (SliderLayerBase & { type: "badge"; content: BadgeLayerContent });

/** Admin DTO — `label` ve pasif slaytlar DAHİL. */
export interface Slide {
  id: string;
  order: number;
  isActive: boolean;
  label: string | null;
  bgType: SlideBackgroundType;
  bgMedia: Media | null;
  bgVideoUrl: string | null;
  bgVideoPosterMedia: Media | null;
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
  layers: SliderLayer[];
  createdAt: string;
  updatedAt: string;
}

/** `GET /sliders/{sliderId}` yanıtındaki slayt şekli — `label`/`isActive` DÜŞÜRÜLMÜŞTÜR. */
export type PublicSlide = Omit<Slide, "label" | "isActive">;

/** Slider seviyesi davranış/görünüm ayarları — `Slider` ve `PublicSlider` bunu PAYLAŞIR. */
export interface SliderSettings {
  autoplay: boolean;
  intervalMs: number;
  loop: boolean;
  pauseOnHover: boolean;
  transitionEffect: SliderTransitionEffect;
  transitionDurationMs: number;
  heightMode: SliderHeightMode;
  heightPx?: number | null;
  aspectRatioWidth: number;
  aspectRatioHeight: number;
  /** `null` → masaüstüyle AYNI. Tablet için AYRI override YOKTUR (masaüstünü miras alır). */
  mobileHeightMode?: SliderHeightMode | null;
  mobileHeightPx?: number | null;
  mobileAspectRatioWidth?: number | null;
  mobileAspectRatioHeight?: number | null;
  showArrows: boolean;
  showBullets: boolean;
  showProgressBar: boolean;
  navigationTheme: SliderNavigationTheme;
}

/** Liste/seçici DTO — `slides` YOKTUR. */
export interface SliderSummary {
  id: string;
  name: string;
  slug: string;
  slideCount: number;
  previewImageUrl: string | null;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Admin detay DTO — ayarlar + TÜM slaytlar (pasifler dahil). */
export interface Slider extends SliderSummary, SliderSettings {
  slides: Slide[];
}

/** `GET /sliders/{sliderId}` yanıtı — render için gereken MİNİMUM veri. */
export interface PublicSlider extends SliderSettings {
  id: string;
  name: string;
  slides: PublicSlide[];
}

export interface SliderUsage {
  pageId: string;
  pageTitle: string;
  pageSlug: string;
  blockId: string;
  isHomePage?: boolean;
  pageDeletedAt?: string | null;
}

export interface SliderListMeta {
  nextCursor: string | null;
  counts: { active: number; trashed: number };
}

export interface CreateSliderRequest {
  name: string;
  slug?: string;
}

export interface UpdateSliderRequest extends Partial<SliderSettings> {
  name?: string;
  slug?: string;
}

export interface UpdateSlideRequest {
  isActive?: boolean;
  label?: string | null;
  bgType?: SlideBackgroundType;
  bgMediaId?: string | null;
  bgVideoUrl?: string | null;
  bgVideoPosterMediaId?: string | null;
  bgPositionX?: number;
  bgPositionY?: number;
  bgOverlayColor?: string | null;
  bgOverlayOpacity?: number;
  bgGradientFrom?: string | null;
  bgGradientTo?: string | null;
  bgGradientAngle?: number;
  bgKenBurns?: boolean;
  durationMs?: number | null;
  linkHref?: string | null;
  linkNewTab?: boolean;
  layers?: SliderLayer[];
}

export interface CreateSlideRequest extends UpdateSlideRequest {
  order?: number;
}

export interface ReorderSlidesRequest {
  slideIds: string[];
}

// ============================================================================
// Sabitler — `backend/src/modules/sliders/sliders.schemas.ts` ile BİREBİR aynı
// olmak ZORUNDADIR (bkz. architect §2.6).
// ============================================================================
export const MAX_SLIDES_PER_SLIDER = 20;
export const MAX_SLIDE_LAYERS = 20;
export const MAX_SLIDE_LAYERS_BYTES = 64 * 1024;
/** Katman çıkış animasyonu VERİ DEĞİL, kod sabitidir (bkz. architect §3.3). */
export const SLIDER_LAYER_OUT_DURATION_MS = 300;
