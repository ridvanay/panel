/**
 * Hero Studio — katman "alan-grubu" (position/style/animation) mutasyon yardımcıları. Architect
 * §6.5 BAĞLAYICI kural: masaüstü görünümündeyken düzenleme KÖK alanları yazar; tablet/mobil
 * görünümündeyken düzenleme `responsive.<device>` altına YALNIZCA değişen alan-grubunu yazar.
 * Basamaklı miras mantığı `components/site/advanced-slider/resolve-responsive.ts` ile AYNI —
 * bu dosya onun "yazma" (mutation) karşılığıdır, ikisi ARASINDA tutarlı kalmalıdır.
 */
import type { DeviceMode } from "@/lib/page-builder/types";
import type { SliderLayer, SliderLayerAnimation, SliderLayerPosition, SliderLayerStyle } from "@/lib/sliders/types";

export type LayerFieldGroup = "position" | "style" | "animation";
export type ResponsiveDevice = Exclude<DeviceMode, "desktop">;

type GroupValue<G extends LayerFieldGroup> = G extends "position"
  ? SliderLayerPosition
  : G extends "style"
    ? SliderLayerStyle
    : SliderLayerAnimation;

/** Editördeki AKTİF cihaz için çözülmüş değer + o cihazda override VAR MI. */
export function resolveGroupForEditing<G extends LayerFieldGroup>(
  layer: SliderLayer,
  group: G,
  device: DeviceMode
): { value: GroupValue<G>; overridden: boolean } {
  const base = layer[group] as GroupValue<G>;
  if (device === "desktop") return { value: base, overridden: false };

  const tabletOverride = layer.responsive?.tablet?.[group] as Partial<GroupValue<G>> | undefined;
  const tabletValue = tabletOverride ? ({ ...base, ...tabletOverride } as GroupValue<G>) : base;
  if (device === "tablet") return { value: tabletValue, overridden: tabletOverride != null };

  const mobileOverride = layer.responsive?.mobile?.[group] as Partial<GroupValue<G>> | undefined;
  const mobileValue = mobileOverride ? ({ ...tabletValue, ...mobileOverride } as GroupValue<G>) : tabletValue;
  return { value: mobileValue, overridden: mobileOverride != null };
}

/** `device==="desktop"` → kök alanları yazar. `tablet`/`mobile` → YALNIZCA `responsive.<device>.<group>`
 *  altına değişen alanları yazar (var olan diğer override alanları KORUNUR). */
export function patchLayerGroup<G extends LayerFieldGroup>(
  layer: SliderLayer,
  device: DeviceMode,
  group: G,
  patch: Partial<GroupValue<G>>
): SliderLayer {
  if (device === "desktop") {
    return { ...layer, [group]: { ...(layer[group] as object), ...patch } } as SliderLayer;
  }
  const responsive = layer.responsive ?? {};
  const deviceOverride = responsive[device] ?? {};
  const groupOverride = { ...(deviceOverride[group] as object | undefined), ...patch };
  return {
    ...layer,
    responsive: { ...responsive, [device]: { ...deviceOverride, [group]: groupOverride } },
  } as SliderLayer;
}

/** Bu cihazdaki TÜM grup override'ını kaldırır — anahtar SİLİNİR (`null` gönderilmez). */
export function removeLayerGroupOverride(layer: SliderLayer, device: ResponsiveDevice, group: LayerFieldGroup): SliderLayer {
  if (!layer.responsive?.[device]) return layer;
  const deviceOverride = { ...layer.responsive[device] };
  delete (deviceOverride as Record<string, unknown>)[group];
  const responsive = { ...layer.responsive, [device]: deviceOverride };
  const cleanedDeviceOverride = Object.keys(deviceOverride).length > 0;
  if (!cleanedDeviceOverride) delete (responsive as Record<string, unknown>)[device];
  const hasAnyOverride = Object.keys(responsive).length > 0;
  return { ...layer, responsive: hasAnyOverride ? responsive : undefined } as SliderLayer;
}

export function isLayerHiddenOnDevice(layer: SliderLayer, device: DeviceMode): boolean {
  if (device === "desktop") return false;
  if (device === "tablet") return layer.responsive?.tablet?.hidden ?? false;
  return layer.responsive?.mobile?.hidden ?? layer.responsive?.tablet?.hidden ?? false;
}

export function setLayerHidden(layer: SliderLayer, device: ResponsiveDevice, hidden: boolean): SliderLayer {
  const responsive = layer.responsive ?? {};
  const deviceOverride = responsive[device] ?? {};
  return { ...layer, responsive: { ...responsive, [device]: { ...deviceOverride, hidden } } } as SliderLayer;
}
