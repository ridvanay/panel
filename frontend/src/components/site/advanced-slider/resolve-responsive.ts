"use client";

import { useEffect, useMemo, useState } from "react";
import type { SliderLayer, SliderLayerAnimation, SliderLayerPosition, SliderLayerStyle } from "@/lib/sliders/types";

/**
 * Public render'ın KENDİ cihaz kırılımı — admin Hero Studio'nun elle seçilen `DeviceMode`
 * önizlemesinden AYRIDIR (bkz. architect §5.3/§6.5). Sınırlar page-builder'ın admin önizleme
 * genişlikleriyle (768/375) aynı mantıksal eşiği kullanır.
 */
export type SliderViewportDevice = "desktop" | "tablet" | "mobile";
export type ResolvedSliderLayer = SliderLayer & { hidden: boolean };

const TABLET_QUERY = "(max-width: 1023px)";
const MOBILE_QUERY = "(max-width: 767px)";

function readDevice(): SliderViewportDevice {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return "desktop";
  if (window.matchMedia(MOBILE_QUERY).matches) return "mobile";
  if (window.matchMedia(TABLET_QUERY).matches) return "tablet";
  return "desktop";
}

/** İlk render HER ZAMAN "desktop" (SSR/hidrasyon eşleşmesi) — gerçek cihaz `useEffect` içinde okunur. */
export function useSliderViewportDevice(): SliderViewportDevice {
  const [device, setDevice] = useState<SliderViewportDevice>("desktop");

  useEffect(() => {
    (() => setDevice(readDevice()))();
    if (typeof window.matchMedia !== "function") return;
    const tabletMql = window.matchMedia(TABLET_QUERY);
    const mobileMql = window.matchMedia(MOBILE_QUERY);
    const update = () => setDevice(readDevice());
    tabletMql.addEventListener("change", update);
    mobileMql.addEventListener("change", update);
    return () => {
      tabletMql.removeEventListener("change", update);
      mobileMql.removeEventListener("change", update);
    };
  }, []);

  return device;
}

function mergePosition(base: SliderLayerPosition, override?: Partial<SliderLayerPosition>): SliderLayerPosition {
  return override ? { ...base, ...override } : base;
}
function mergeStyle(base: SliderLayerStyle, override?: SliderLayerStyle): SliderLayerStyle {
  return override ? { ...base, ...override } : base;
}
function mergeAnimation(base: SliderLayerAnimation, override?: Partial<SliderLayerAnimation>): SliderLayerAnimation {
  return override ? { ...base, ...override } : base;
}

/**
 * §2.4 architect — basamaklı miras: `tablet = merge(desktop, responsive.tablet)`,
 * `mobile = merge(tablet, responsive.mobile)`. `position`/`style`/`animation` ALAN-GRUBU
 * seviyesinde SIĞ birleştirilir (`content` HİÇBİR ZAMAN override edilmez).
 */
export function resolveLayerForDevice(layer: SliderLayer, device: SliderViewportDevice): ResolvedSliderLayer {
  if (device === "desktop") return { ...layer, hidden: false };

  const tabletOverride = layer.responsive?.tablet;
  const tabletPosition = mergePosition(layer.position, tabletOverride?.position);
  const tabletStyle = mergeStyle(layer.style, tabletOverride?.style);
  const tabletAnimation = mergeAnimation(layer.animation, tabletOverride?.animation);
  const tabletHidden = tabletOverride?.hidden ?? false;

  if (device === "tablet") {
    return { ...layer, hidden: tabletHidden, position: tabletPosition, style: tabletStyle, animation: tabletAnimation };
  }

  const mobileOverride = layer.responsive?.mobile;
  return {
    ...layer,
    hidden: mobileOverride?.hidden ?? tabletHidden,
    position: mergePosition(tabletPosition, mobileOverride?.position),
    style: mergeStyle(tabletStyle, mobileOverride?.style),
    animation: mergeAnimation(tabletAnimation, mobileOverride?.animation),
  };
}

/** Bir slaytın TÜM katmanlarını aktif cihaz için çözer — render sırasında BİR KEZ `useMemo`. */
export function useResolvedLayers(layers: SliderLayer[]): ResolvedSliderLayer[] {
  const device = useSliderViewportDevice();
  return useMemo(() => layers.map((layer) => resolveLayerForDevice(layer, device)), [layers, device]);
}
