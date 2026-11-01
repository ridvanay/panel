import type { PipCorner, PipSize } from "./device-prefs";

export const PIP_SIZES: readonly PipSize[] = ["small", "medium", "large"];

export interface RectLike {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Bırakılan kutunun merkezine en yakın köşe. Köşe adları MANTIKSAL (start/end) olduğu için RTL'de fiziksel sol = `end`.
 */
export function nearestCorner(center: { x: number; y: number }, stage: RectLike, dir: "ltr" | "rtl"): PipCorner {
  const right = center.x - stage.left > stage.width / 2;
  const bottom = center.y - stage.top > stage.height / 2;
  const atEnd = dir === "rtl" ? !right : right;
  return `${bottom ? "bottom" : "top"}-${atEnd ? "end" : "start"}` as PipCorner;
}

export function stepSize(size: PipSize, delta: number): PipSize {
  const index = PIP_SIZES.indexOf(size) + delta;
  return PIP_SIZES[Math.min(PIP_SIZES.length - 1, Math.max(0, index))]!;
}

/** Düğme: küçük → orta → büyük → küçük. */
export function cycleSize(size: PipSize): PipSize {
  return PIP_SIZES[(PIP_SIZES.indexOf(size) + 1) % PIP_SIZES.length]!;
}

/** İki parmakla büyütme/küçültme: başlangıç mesafesine göre bir basamak (+1 / -1) ya da 0. */
export function pinchStep(startDistance: number, currentDistance: number): -1 | 0 | 1 {
  if (startDistance <= 0) return 0;
  const ratio = currentDistance / startDistance;
  if (ratio >= 1.3) return 1;
  if (ratio <= 0.77) return -1;
  return 0;
}

export function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Kutunun bağlı olduğu yön (`dir` özniteliği); bulunamazsa ltr. */
export function directionOf(el: Element | null): "ltr" | "rtl" {
  return el?.closest("[dir]")?.getAttribute("dir") === "rtl" ? "rtl" : "ltr";
}
