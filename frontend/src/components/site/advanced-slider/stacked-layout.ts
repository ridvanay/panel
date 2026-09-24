"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { ORIGIN_PERCENT } from "@/lib/sliders/layer-render";
import type { ResolvedSliderLayer } from "./resolve-responsive";

/**
 * Hero Studio — 1280px ALTINDA katmanlar mutlak konumla DEĞİL, alt alta akışla dizilir. Gerekçe:
 * katmanlar yüzde konumla, buton gibi öğeler ise piksel boyutuyla yerleşir; ekran daraldıkça yüzde
 * aralıklar küçülür ama piksel boyutlar küçülmez → metin ile buton üst üste biner (metin uzadıkça —
 * ör. çeviride — sorun büyür). Akış düzeninde çakışma yapısal olarak imkânsızdır.
 *
 * Eşik, katmanların cihaz ayarlarını (mobil <768 / tablet <1024 / masaüstü) seçen
 * `resolve-responsive.ts` eşiklerinden BAĞIMSIZDIR: 1024–1279px'te masaüstü ayarları (sıralama ve
 * hiza için) kullanılır ama katmanlar yine alt alta dizilir. ≥1280px hiç etkilenmez.
 */
export const STACKED_LAYOUT_MAX_WIDTH_PX = 1279;
const STACKED_LAYOUT_QUERY = `(max-width: ${STACKED_LAYOUT_MAX_WIDTH_PX}px)`;

export function isStackedWidth(viewportWidthPx: number): boolean {
  return viewportWidthPx <= STACKED_LAYOUT_MAX_WIDTH_PX;
}

/** SSR ve ilk render'da `false` (masaüstü) — `useSliderViewportDevice` ile AYNI hidrasyon deseni. */
export function useStackedSliderLayout(): boolean {
  const [stacked, setStacked] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia(STACKED_LAYOUT_QUERY);
    const update = () => setStacked(mql.matches);
    update();
    mql.addEventListener("change", update);
    return () => mql.removeEventListener("change", update);
  }, []);
  return stacked;
}

/**
 * Görünür katmanları dikey sıraya dizer: aktif cihazın `yPercent` değerine göre (admin'in o cihaz
 * için verdiği konum), eşitlikte orijinin dikey bileşeni (üstten hizalı önce) ve sonra orijinal sıra.
 */
export function orderLayersForStack(layers: ResolvedSliderLayer[]): ResolvedSliderLayer[] {
  return layers
    .map((layer, index) => ({ layer, index }))
    .filter(({ layer }) => !layer.hidden)
    .sort(
      (a, b) =>
        a.layer.position.yPercent - b.layer.position.yPercent ||
        ORIGIN_PERCENT[a.layer.position.origin].y - ORIGIN_PERCENT[b.layer.position.origin].y ||
        a.index - b.index
    )
    .map(({ layer }) => layer);
}

/** Katmanın yatay hizası — orijinin yatay bileşeninden (sol/orta/sağ). */
export function stackAlignSelf(layer: ResolvedSliderLayer): CSSProperties["alignSelf"] {
  const x = ORIGIN_PERCENT[layer.position.origin].x;
  if (x === 50) return "center";
  if (x === 100) return "flex-end";
  return "flex-start";
}

/**
 * Yatay iç boşluk (% slayt genişliği): sola hizalı katmanların en küçük `xPercent`'i — tasarımdaki
 * sol kenar boşluğu korunur. 4–10% arasına sıkıştırılır; sola hizalı katman yoksa 6%.
 */
export function stackPaddingInlinePercent(layers: ResolvedSliderLayer[]): number {
  const startXs = layers.filter((layer) => stackAlignSelf(layer) === "flex-start").map((layer) => layer.position.xPercent);
  if (startXs.length === 0) return 6;
  return Math.min(10, Math.max(4, Math.min(...startXs)));
}
