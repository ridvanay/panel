"use client";

import { motion, type Easing } from "framer-motion";
import Link from "next/link";
import { resolveIcon } from "@/lib/page-builder/icon-options";
import { SHADOW_VAR, SLIDER_BUTTON_SIZE_CLASS, SLIDER_BUTTON_VARIANT_CLASS, LAYER_FONT_FAMILY_VAR } from "@/lib/sliders/design-tokens";
import { SLIDER_LAYER_OUT_DURATION_MS, type SliderLayerOrigin } from "@/lib/sliders/types";
import type { ResolvedSliderLayer } from "./resolve-responsive";
import { cn } from "@/lib/utils";

const ORIGIN_PERCENT: Record<SliderLayerOrigin, { x: number; y: number }> = {
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

const EASING_MAP: Record<NonNullable<ResolvedSliderLayer["animation"]["easing"]>, Easing> = {
  linear: "linear",
  "ease-out": "easeOut",
  "ease-in-out": "easeInOut",
  spring: "easeOut", // spring `transition.type` ile ayrıca ele alınır — bkz. aşağıdaki `buildTransition`.
};

/** `RevealEffect`ten AYRI bir küme — slider katmanları yatay giriş yönlerine ihtiyaç duyar. */
const IN_EFFECT_VARIANTS: Record<
  ResolvedSliderLayer["animation"]["inEffect"],
  { initial: Record<string, number>; animate: Record<string, number> }
> = {
  none: { initial: { opacity: 1 }, animate: { opacity: 1 } },
  fade: { initial: { opacity: 0 }, animate: { opacity: 1 } },
  "fade-up": { initial: { opacity: 0, y: 28 }, animate: { opacity: 1, y: 0 } },
  "fade-down": { initial: { opacity: 0, y: -28 }, animate: { opacity: 1, y: 0 } },
  "slide-in-left": { initial: { opacity: 0, x: -48 }, animate: { opacity: 1, x: 0 } },
  "slide-in-right": { initial: { opacity: 0, x: 48 }, animate: { opacity: 1, x: 0 } },
  "zoom-in": { initial: { opacity: 0, scale: 0.85 }, animate: { opacity: 1, scale: 1 } },
  "flip-up": { initial: { opacity: 0, rotateX: -80 }, animate: { opacity: 1, rotateX: 0 } },
};

function hexToRgba(hex: string, opacityPercent: number): string {
  const clean = hex.replace("#", "");
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(100, opacityPercent)) / 100})`;
}

function buildTransition(animation: ResolvedSliderLayer["animation"], reducedMotion: boolean) {
  if (reducedMotion) return { duration: 0 };
  const base = { delay: animation.delayMs / 1000, duration: animation.durationMs / 1000 };
  if (animation.easing === "spring") return { ...base, type: "spring" as const, bounce: 0.3 };
  return { ...base, ease: EASING_MAP[animation.easing ?? "ease-out"] };
}

function buttonIcon(name: string | undefined, className: string) {
  const Icon = resolveIcon(name);
  return <Icon className={className} aria-hidden />;
}

/** 1..3 dışında bir `level` gelmez (Zod ile sınırlı) — yine de `??2` ile güvenli varsayılan. */
function HeadingContent({ text, level }: { text: string; level?: 1 | 2 | 3 }) {
  const Tag = (`h${level ?? 2}`) as "h1" | "h2" | "h3";
  return <Tag className="m-0">{text}</Tag>;
}

export function SlideLayerView({
  layer,
  layerIndex,
  reducedMotion,
}: {
  layer: ResolvedSliderLayer;
  layerIndex: number;
  reducedMotion: boolean;
}) {
  if (layer.hidden) return null;

  const { position, style, animation } = layer;
  const origin = ORIGIN_PERCENT[position.origin];
  const offsetX = position.offsetX ?? 0;
  const offsetY = position.offsetY ?? 0;
  const baseOpacity = style.opacity != null ? Math.max(0, Math.min(100, style.opacity)) / 100 : 1;
  const fontFamilyVar = style.fontFamily ? LAYER_FONT_FAMILY_VAR[style.fontFamily] : undefined;

  const contentStyle: React.CSSProperties = {
    opacity: baseOpacity,
    color: style.color,
    backgroundColor: style.backgroundColor
      ? hexToRgba(style.backgroundColor, style.backgroundOpacity ?? 100)
      : undefined,
    fontFamily: fontFamilyVar,
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

  const variant = IN_EFFECT_VARIANTS[animation.inEffect];
  const initial = reducedMotion ? { opacity: 1 } : variant.initial;
  const animate = reducedMotion ? { opacity: 1 } : variant.animate;

  return (
    <div
      className="absolute"
      style={{
        left: `${position.xPercent}%`,
        top: `${position.yPercent}%`,
        transform: `translate(-${origin.x}%, -${origin.y}%) translate(${offsetX}px, ${offsetY}px)`,
        width: position.widthPercent ? `${position.widthPercent}%` : undefined,
        zIndex: position.zIndex ?? layerIndex,
      }}
    >
      <motion.div
        initial={initial}
        animate={animate}
        exit={{ opacity: 0, transition: { duration: SLIDER_LAYER_OUT_DURATION_MS / 1000, ease: "easeOut" } }}
        transition={buildTransition(animation, reducedMotion)}
      >
        <div style={contentStyle} className="min-w-0">
          {layer.type === "heading" && <HeadingContent text={layer.content.text} level={layer.content.level} />}
          {layer.type === "text" && <p className="m-0 whitespace-pre-line">{layer.content.text}</p>}
          {layer.type === "badge" && (
            <span className="inline-block rounded-full bg-[var(--site-primary)] px-3 py-1 text-xs font-semibold text-white">
              {layer.content.text}
            </span>
          )}
          {layer.type === "image" && (
            // eslint-disable-next-line @next/next/no-img-element -- katman görseli serbest URL (Media FK'sı DEĞİL, bkz. architect §2.2)
            <img src={layer.content.url} alt={layer.content.alt} loading="lazy" className="block max-w-full" />
          )}
          {layer.type === "button" && (
            <Link
              href={layer.content.href}
              className={cn(
                "inline-flex items-center font-semibold transition-all duration-300",
                SLIDER_BUTTON_VARIANT_CLASS[layer.content.variant],
                SLIDER_BUTTON_SIZE_CLASS[layer.content.size]
              )}
              style={{ borderRadius: "var(--site-radius)" }}
            >
              {layer.content.icon && buttonIcon(layer.content.icon, "h-[1em] w-[1em]")}
              {layer.content.label}
            </Link>
          )}
        </div>
      </motion.div>
    </div>
  );
}
