import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";
import {
  DEFAULT_CONTAINER_MAX_WIDTH,
  type ContainerAlign,
  type ContainerJustify,
  type ContainerNode,
  type LinearGradientDirection,
} from "@/lib/page-builder/types";
import { BlockRenderer } from "./index";

/**
 * Konteyner (`container`) render motoru — mimar dokümanı §6.1/§6.2 sınıf/inline-style
 * bölüşümü tablosu BİREBİR. Flexbox (grid DEĞİL): `direction`/`justifyContent`/`alignItems`/`gap`
 * flexbox semantiğidir. Statik değerler → Tailwind sınıfı (JIT taranabilir sabit tablo);
 * dinamik değerler (px/fr/renk/url) → inline `style` (arbitrary Tailwind class KULLANILMAZ).
 */

const JUSTIFY_CLASS: Record<ContainerJustify, string> = {
  start: "justify-start",
  center: "justify-center",
  end: "justify-end",
  between: "justify-between",
  around: "justify-around",
  evenly: "justify-evenly",
};

const ALIGN_CLASS: Record<ContainerAlign, string> = {
  stretch: "items-stretch",
  start: "items-start",
  center: "items-center",
  end: "items-end",
};

export function ContainerBlockView({ block }: { block: ContainerNode }) {
  const { settings, children } = block;

  const layoutClass = settings.layout === "boxed" ? "mx-auto w-full px-4 sm:px-6" : "w-full";
  const directionClass = settings.direction === "row" ? "flex flex-col md:flex-row" : "flex flex-col";
  // `globals.css::pb-bg-gradient-wave` — yalnızca zamanlama/`background-size`, renkler
  // `backgroundStyle()`ın ürettiği inline `backgroundImage`de kalır.
  const animatedWaveClass = settings.background.type === "animated" && settings.background.variant === "gradient-wave" ? "pb-bg-gradient-wave" : undefined;

  const style: CSSProperties = {
    maxWidth: settings.layout === "boxed" ? (settings.customWidth ?? DEFAULT_CONTAINER_MAX_WIDTH) : undefined,
    minHeight: settings.minHeight ? `${settings.minHeight.value}${settings.minHeight.unit}` : undefined,
    gap: `${settings.gap}px`,
    padding: `${settings.padding.top}px ${settings.padding.right}px ${settings.padding.bottom}px ${settings.padding.left}px`,
    margin: `${settings.margin.top}px ${settings.margin.right}px ${settings.margin.bottom}px ${settings.margin.left}px`,
    flex: settings.widthFr ? `${settings.widthFr} 1 0%` : undefined,
    ...backgroundStyle(settings.background),
  };

  return (
    <div
      className={cn(layoutClass, directionClass, JUSTIFY_CLASS[settings.justifyContent], ALIGN_CLASS[settings.alignItems], animatedWaveClass)}
      style={style}
    >
      {/* §6.3 "chrome" sözleşmesi — bir konteynerin İÇİNDEKİ yaprak bloklar HER ZAMAN "bare":
          kendi dış gutter'larını bırakırlar, boşluk bu konteynerin padding/gap'inden gelir. */}
      <BlockRenderer nodes={children} chrome="bare" />
    </div>
  );
}

/** `#rgb`/`#rrggbb` → `rgba(r,g,b,a)`. `hex` her zaman backend'de regex ile doğrulanmış olarak
 *  gelir (bkz. `pages.schemas.ts::OVERLAY_HEX_RE`/`HEX_COLOR_RE`) — burada İKİNCİ bir doğrulama
 *  YAPILMAZ, yalnızca ayrıştırılır; ayrıştırılamazsa (beklenmeyen/eski bir kayıt) siyaha düşer. */
function hexToRgba(hex: string, opacityPercent: number): string {
  const normalized = hex.length === 4 ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}` : hex;
  const r = Number.parseInt(normalized.slice(1, 3), 16);
  const g = Number.parseInt(normalized.slice(3, 5), 16);
  const b = Number.parseInt(normalized.slice(5, 7), 16);
  const alpha = Math.min(100, Math.max(0, opacityPercent)) / 100;
  if ([r, g, b].some((n) => Number.isNaN(n))) return `rgba(0, 0, 0, ${alpha})`;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** `LinearGradientDirection` → CSS `linear-gradient()` yön anahtar sözcüğü. HAM CSS DEĞİL,
 *  sabit bir tablo (`ContainerJustify`/`ButtonBlock.style` ile AYNI desen) — `custom-angle`
 *  BURADA YOK, o durumda `angle` (doğrulanmış sayı) doğrudan `${angle}deg` olarak kullanılır. */
const LINEAR_GRADIENT_DIRECTION_CSS: Record<Exclude<LinearGradientDirection, "custom-angle">, string> = {
  "to-top": "to top",
  "to-top-right": "to top right",
  "to-right": "to right",
  "to-bottom-right": "to bottom right",
  "to-bottom": "to bottom",
  "to-bottom-left": "to bottom left",
  "to-left": "to left",
  "to-top-left": "to top left",
};

function backgroundStyle(background: ContainerNode["settings"]["background"]): CSSProperties {
  if (background.type === "color") return { backgroundColor: background.value };

  if (background.type === "image") {
    if (!background.overlay) {
      return {
        backgroundImage: `url("${background.value}")`,
        backgroundPosition: background.position,
        backgroundSize: background.size,
        backgroundRepeat: background.repeat,
      };
    }
    // İki katmanlı `background-image` (üstte overlay gradient, altta görsel) — ek bir DOM
    // öğesi/absolute-positioned katman GEREKMEZ, tamamen tek `style` nesnesiyle ifade edilir.
    const overlayColor = hexToRgba(background.overlay.color, background.overlay.opacity);
    return {
      backgroundImage: `linear-gradient(${overlayColor}, ${overlayColor}), url("${background.value}")`,
      backgroundPosition: `center, ${background.position}`,
      backgroundSize: `cover, ${background.size}`,
      backgroundRepeat: `no-repeat, ${background.repeat}`,
    };
  }

  if (background.type === "gradient") {
    if (background.gradientType === "radial") {
      return { backgroundImage: `radial-gradient(circle, ${background.colorFrom}, ${background.colorTo})` };
    }
    const directionCss =
      background.direction === "custom-angle"
        ? `${background.angle ?? 90}deg`
        : LINEAR_GRADIENT_DIRECTION_CSS[background.direction ?? "to-right"];
    return { backgroundImage: `linear-gradient(${directionCss}, ${background.colorFrom}, ${background.colorTo})` };
  }

  if (background.type === "animated") {
    if (background.variant === "gradient-wave") {
      // 3 duraklı (A-B-A) gradient — `pb-bg-gradient-wave`in `background-position` döngüsü
      // dikişsiz görünür (bkz. `globals.css`).
      return { backgroundImage: `linear-gradient(120deg, ${background.colorFrom}, ${background.colorTo}, ${background.colorFrom})` };
    }
    const dotOrLineColor = hexToRgba(background.patternColor, 18);
    if (background.variant === "dots") {
      return { backgroundImage: `radial-gradient(${dotOrLineColor} 1px, transparent 1px)`, backgroundSize: "16px 16px" };
    }
    // "grid" — yatay + dikey ince çizgiler, iki katmanlı `linear-gradient`.
    return {
      backgroundImage: `linear-gradient(${dotOrLineColor} 1px, transparent 1px), linear-gradient(90deg, ${dotOrLineColor} 1px, transparent 1px)`,
      backgroundSize: "24px 24px",
    };
  }

  return {};
}
