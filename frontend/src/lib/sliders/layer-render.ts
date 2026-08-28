/**
 * Katman render yardımcıları — `components/site/advanced-slider/slide-layer.tsx` (public,
 * gerçek katman) VE `components/admin/hero-studio/hero-canvas.tsx` (admin, WYSIWYG editör +
 * "Oynat" önizlemesi) TARAFINDAN PAYLAŞILIR. Tek kaynak: origin yüzdeleri, stil→CSS eşlemesi
 * ve giriş animasyonu varyantları iki yerde AYRIŞMASIN diye buradan gelir.
 */
import type { Easing } from "framer-motion";
import type { SliderLayerAnimation, SliderLayerOrigin, SliderLayerStyle } from "./types";
import { SHADOW_VAR } from "./design-tokens";

export const ORIGIN_PERCENT: Record<SliderLayerOrigin, { x: number; y: number }> = {
  "top-left": { x: 0, y: 0 },
  "top-center": { x: 50, y: 0 },
  "top-right": { x: 100, y: 0 },
  "middle-left": { x: 0, y: 50 },
  "middle-center": { x: 50, y: 50 },
  "middle-right": { x: 100, y: 50 },
  "bottom-left": { x: 0, y: 100 },
  "bottom-center": { x: 50, y: 100 },
  "bottom-right": { x: 100, y: 100 },
};

/** `origin`'in dikey/yatay bileşenlerini ayırır — hizalama butonları (§ hero-canvas toolbar)
 *  yalnızca TEK ekseni değiştirmek için kullanır, diğer ekseni korur. */
export function splitOrigin(origin: SliderLayerOrigin): { vertical: "top" | "middle" | "bottom"; horizontal: "left" | "center" | "right" } {
  const [vertical, horizontal] = origin.split("-") as ["top" | "middle" | "bottom", "left" | "center" | "right"];
  return { vertical, horizontal };
}

export function joinOrigin(vertical: "top" | "middle" | "bottom", horizontal: "left" | "center" | "right"): SliderLayerOrigin {
  return `${vertical}-${horizontal}` as SliderLayerOrigin;
}

function hexToRgba(hex: string, opacityPercent: number): string {
  const clean = hex.replace("#", "");
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(100, opacityPercent)) / 100})`;
}

/** `style` alan grubunu gerçek CSS'e çevirir — `font-family` hariç (o `LAYER_FONT_FAMILY_VAR`
 *  eşlemesi ayrıca uygulanır, çağıran taraf `.site-scope` var mı bilmeli). */
export function buildLayerContentStyle(style: SliderLayerStyle): React.CSSProperties {
  return {
    opacity: style.opacity != null ? Math.max(0, Math.min(100, style.opacity)) / 100 : 1,
    color: style.color,
    backgroundColor: style.backgroundColor ? hexToRgba(style.backgroundColor, style.backgroundOpacity ?? 100) : undefined,
    fontSize: style.fontSize ? `${style.fontSize}px` : undefined,
    fontWeight: style.fontWeight,
    lineHeight: style.lineHeight,
    letterSpacing: style.letterSpacing ? `${style.letterSpacing}px` : undefined,
    textAlign: style.textAlign,
    textTransform: style.textTransform === "uppercase" ? "uppercase" : undefined,
    paddingTop: style.padding?.top,
    paddingRight: style.padding?.right,
    paddingBottom: style.padding?.bottom,
    paddingLeft: style.padding?.left,
    borderRadius: style.borderRadius,
    boxShadow: style.shadow ? SHADOW_VAR[style.shadow] : undefined,
    maxWidth: style.maxWidthPx ? `${style.maxWidthPx}px` : undefined,
  };
}

const EASING_MAP: Record<NonNullable<SliderLayerAnimation["easing"]>, Easing> = {
  linear: "linear",
  "ease-out": "easeOut",
  "ease-in-out": "easeInOut",
  spring: "easeOut", // spring `transition.type` ile ayrıca ele alınır — bkz. `buildLayerTransition`.
};

/** `RevealEffect`ten (page-builder scroll reveal) AYRI bir kümedir — slider katmanları yatay
 *  giriş yönlerine ihtiyaç duyar, ikisi BİRLEŞTİRİLMEZ (bkz. openapi.yaml SliderLayerInEffect). */
export const IN_EFFECT_VARIANTS: Record<SliderLayerAnimation["inEffect"], { initial: Record<string, number>; animate: Record<string, number> }> = {
  none: { initial: { opacity: 1 }, animate: { opacity: 1 } },
  fade: { initial: { opacity: 0 }, animate: { opacity: 1 } },
  "fade-up": { initial: { opacity: 0, y: 28 }, animate: { opacity: 1, y: 0 } },
  "fade-down": { initial: { opacity: 0, y: -28 }, animate: { opacity: 1, y: 0 } },
  "slide-in-left": { initial: { opacity: 0, x: -48 }, animate: { opacity: 1, x: 0 } },
  "slide-in-right": { initial: { opacity: 0, x: 48 }, animate: { opacity: 1, x: 0 } },
  "zoom-in": { initial: { opacity: 0, scale: 0.85 }, animate: { opacity: 1, scale: 1 } },
  "flip-up": { initial: { opacity: 0, rotateX: -80 }, animate: { opacity: 1, rotateX: 0 } },
  // `easing`'teki "spring" (bir TRANSITION eğrisi) ile KARIŞTIRILMAZ — bu bir giriş
  // ŞEKLİDİR (büyük ölçekten taşarak oturma). `easing` alanı ne olursa olsun `buildLayerTransition`
  // bunun için DAİMA yüksek "bounce" değerli bir spring'e zorlar (aksi halde "elastik" hissi kaybolur).
  "elastic-bounce": { initial: { opacity: 0, scale: 0.3 }, animate: { opacity: 1, scale: 1 } },
};

export function buildLayerTransition(animation: SliderLayerAnimation, reducedMotion: boolean) {
  if (reducedMotion) return { duration: 0 };
  const delay = animation.delayMs / 1000;
  const visualDuration = animation.durationMs / 1000;
  if (animation.inEffect === "elastic-bounce") {
    return { delay, type: "spring" as const, bounce: 0.6, visualDuration };
  }
  if (animation.easing === "spring") return { delay, duration: visualDuration, type: "spring" as const, bounce: 0.3 };
  return { delay, duration: visualDuration, ease: EASING_MAP[animation.easing ?? "ease-out"] };
}
