"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import { resolveIcon } from "@/lib/page-builder/icon-options";
import { SLIDER_BUTTON_SIZE_CLASS, SLIDER_BUTTON_VARIANT_CLASS, LAYER_FONT_FAMILY_VAR } from "@/lib/sliders/design-tokens";
import { SLIDER_LAYER_OUT_DURATION_MS } from "@/lib/sliders/types";
import {
  ORIGIN_PERCENT,
  IN_EFFECT_VARIANTS,
  buildLayerContentStyle,
  buildLayerFloat,
  buildLayerTransition,
  layerVisibilityClasses,
} from "@/lib/sliders/layer-render";
import type { HeadingLayerContent } from "@/lib/sliders/types";
import type { ResolvedSliderLayer } from "./resolve-responsive";
import { stackAlignSelf } from "./stacked-layout";
import { cn } from "@/lib/utils";

function buttonIcon(name: string | undefined, className: string) {
  const Icon = resolveIcon(name);
  return <Icon className={className} aria-hidden />;
}

/**
 * 1..3 dışında bir `level` gelmez (Zod ile sınırlı) — yine de `??2` ile güvenli varsayılan.
 * İki renkli başlık: vurgu metni AYNI başlık etiketinin içinde (tek h1/h2 — erişilebilir ad bütün kalır).
 */
export function HeadingContent({ content }: { content: HeadingLayerContent }) {
  const Tag = (`h${content.level ?? 2}`) as "h1" | "h2" | "h3";
  const accent = content.accentText?.trim();
  return (
    <Tag className="m-0">
      {content.text}
      {accent && (
        <>
          {content.accentOnNewLine ? <br /> : " "}
          <span style={{ color: content.accentColor }}>{accent}</span>
        </>
      )}
    </Tag>
  );
}

export function SlideLayerView({
  layer,
  layerIndex,
  reducedMotion,
  stacked = false,
}: {
  layer: ResolvedSliderLayer;
  layerIndex: number;
  reducedMotion: boolean;
  /**
   * `true` (1280px altı): katman mutlak konumla değil, alt alta akış içinde render edilir —
   * konum yalnızca sıralama ve yatay hiza için kullanılır (bkz. `stacked-layout.ts`).
   */
  stacked?: boolean;
}) {
  // Akış düzeninde (yalnızca istemcide) gizli katman hiç render edilmez; mutlak düzende CSS sınıfları gizler.
  if (stacked && layer.hidden) return null;

  const { position, style, animation } = layer;
  const origin = ORIGIN_PERCENT[position.origin];
  const offsetX = position.offsetX ?? 0;
  const offsetY = position.offsetY ?? 0;
  const fontFamilyVar = style.fontFamily ? LAYER_FONT_FAMILY_VAR[style.fontFamily] : undefined;
  const contentStyle: React.CSSProperties = { ...buildLayerContentStyle(style), fontFamily: fontFamilyVar };

  const variant = IN_EFFECT_VARIANTS[animation.inEffect];
  const initial = reducedMotion ? { opacity: 1 } : variant.initial;
  const animate = reducedMotion ? { opacity: 1 } : variant.animate;
  const float = buildLayerFloat(animation, reducedMotion);

  return (
    <div
      className={cn(stacked ? "relative max-w-full" : "absolute", ...layerVisibilityClasses(layer))}
      style={
        stacked
          ? { alignSelf: stackAlignSelf(layer) }
          : {
              left: `${position.xPercent}%`,
              top: `${position.yPercent}%`,
              transform: `translate(-${origin.x}%, -${origin.y}%) translate(${offsetX}px, ${offsetY}px)`,
              width: position.widthPercent ? `${position.widthPercent}%` : undefined,
              zIndex: position.zIndex ?? layerIndex,
            }
      }
    >
      <motion.div
        initial={initial}
        animate={animate}
        exit={{ opacity: 0, transition: { duration: SLIDER_LAYER_OUT_DURATION_MS / 1000, ease: "easeOut" } }}
        transition={buildLayerTransition(animation, reducedMotion)}
      >
        <motion.div style={contentStyle} className="min-w-0" animate={float?.animate} transition={float?.transition}>
          {layer.type === "heading" && <HeadingContent content={layer.content} />}
          {layer.type === "text" && <p className="m-0 whitespace-pre-line">{layer.content.text}</p>}
          {layer.type === "badge" && (
            <span className="inline-block rounded-full bg-[var(--site-primary)] px-3 py-1 text-xs font-semibold text-[var(--site-button-text)]">
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
        </motion.div>
      </motion.div>
    </div>
  );
}
