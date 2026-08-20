import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";
import { DEFAULT_CONTAINER_MAX_WIDTH, type ContainerAlign, type ContainerJustify, type ContainerNode } from "@/lib/page-builder/types";
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
      className={cn(layoutClass, directionClass, JUSTIFY_CLASS[settings.justifyContent], ALIGN_CLASS[settings.alignItems])}
      style={style}
    >
      {/* §6.3 "chrome" sözleşmesi — bir konteynerin İÇİNDEKİ yaprak bloklar HER ZAMAN "bare":
          kendi dış gutter'larını bırakırlar, boşluk bu konteynerin padding/gap'inden gelir. */}
      <BlockRenderer nodes={children} chrome="bare" />
    </div>
  );
}

function backgroundStyle(background: ContainerNode["settings"]["background"]): CSSProperties {
  if (background.type === "color") return { backgroundColor: background.value };
  if (background.type === "image") {
    return {
      backgroundImage: `url("${background.value}")`,
      backgroundPosition: background.position,
      backgroundSize: background.size,
      backgroundRepeat: background.repeat,
    };
  }
  return {};
}
