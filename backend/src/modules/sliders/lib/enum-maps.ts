import type {
  SliderTransitionEffect as PrismaSliderTransitionEffect,
  SliderHeightMode as PrismaSliderHeightMode,
  SlideBackgroundType as PrismaSlideBackgroundType,
  SliderNavigationTheme as PrismaSliderNavigationTheme,
  SliderWidthMode as PrismaSliderWidthMode,
} from "@prisma/client";
import type {
  SliderTransitionEffect,
  SliderHeightMode,
  SlideBackgroundType,
  SliderNavigationTheme,
  SliderWidthMode,
} from "../../../schemas/entities";

/**
 * API (kebab-case) ↔ Prisma (SCREAMING_SNAKE) enum dönüşümleri — `import.constants.ts::
 * DUPLICATE_STRATEGY_TO_PRISMA`/`_FROM_PRISMA` ile AYNI desen. openapi.yaml `Sliders` tag'i
 * BİLİNÇLİ OLARAK ham Prisma değerini DEĞİL, sabit bir varyant kümesi kullanır (bkz.
 * schemas/entities.ts bu enum'ların üstündeki yorum) — bu dosya TEK dönüşüm noktasıdır.
 */

export const TRANSITION_EFFECT_TO_PRISMA: Record<SliderTransitionEffect, PrismaSliderTransitionEffect> = {
  slide: "SLIDE",
  fade: "FADE",
  cube: "CUBE",
  zoom: "ZOOM",
};
export const TRANSITION_EFFECT_FROM_PRISMA: Record<PrismaSliderTransitionEffect, SliderTransitionEffect> = {
  SLIDE: "slide",
  FADE: "fade",
  CUBE: "cube",
  ZOOM: "zoom",
};

export const HEIGHT_MODE_TO_PRISMA: Record<SliderHeightMode, PrismaSliderHeightMode> = {
  "full-screen": "FULL_SCREEN",
  "custom-px": "CUSTOM_PX",
  "aspect-ratio": "ASPECT_RATIO",
};
export const HEIGHT_MODE_FROM_PRISMA: Record<PrismaSliderHeightMode, SliderHeightMode> = {
  FULL_SCREEN: "full-screen",
  CUSTOM_PX: "custom-px",
  ASPECT_RATIO: "aspect-ratio",
};

export const BACKGROUND_TYPE_TO_PRISMA: Record<SlideBackgroundType, PrismaSlideBackgroundType> = {
  image: "IMAGE",
  video: "VIDEO",
  gradient: "GRADIENT",
};
export const BACKGROUND_TYPE_FROM_PRISMA: Record<PrismaSlideBackgroundType, SlideBackgroundType> = {
  IMAGE: "image",
  VIDEO: "video",
  GRADIENT: "gradient",
};

export const NAVIGATION_THEME_TO_PRISMA: Record<SliderNavigationTheme, PrismaSliderNavigationTheme> = {
  light: "LIGHT",
  dark: "DARK",
};
export const NAVIGATION_THEME_FROM_PRISMA: Record<PrismaSliderNavigationTheme, SliderNavigationTheme> = {
  LIGHT: "light",
  DARK: "dark",
};

export const WIDTH_MODE_TO_PRISMA: Record<SliderWidthMode, PrismaSliderWidthMode> = {
  "full-width": "FULL_WIDTH",
  boxed: "BOXED",
};
export const WIDTH_MODE_FROM_PRISMA: Record<PrismaSliderWidthMode, SliderWidthMode> = {
  FULL_WIDTH: "full-width",
  BOXED: "boxed",
};

export function heightModeToPrisma(value: SliderHeightMode | null | undefined): PrismaSliderHeightMode | null | undefined {
  if (value === null || value === undefined) return value;
  return HEIGHT_MODE_TO_PRISMA[value];
}

export function heightModeFromPrisma(value: PrismaSliderHeightMode | null): SliderHeightMode | null {
  if (value === null) return null;
  return HEIGHT_MODE_FROM_PRISMA[value];
}
