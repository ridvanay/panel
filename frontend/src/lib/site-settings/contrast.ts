/**
 * WCAG AA kontrast hesaplama — design-notes-appearance-panel.md §5 (ui-designer kararı):
 * eşik 4.5:1 (normal metin boyutu; büyük metin 3:1 istisnası KULLANILMAZ, tek eşik daha
 * güvenli/basit). Standart relative luminance formülü: sRGB → linearize →
 * `0.2126R + 0.7152G + 0.0722B`, sonra `(L1+0.05)/(L2+0.05)`.
 */
export const WCAG_AA_CONTRAST_THRESHOLD = 4.5;

function hexToRgb(hex: string): [number, number, number] | null {
  const match = /^#([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!match) return null;
  const value = match[1]!;
  return [parseInt(value.slice(0, 2), 16), parseInt(value.slice(2, 4), 16), parseInt(value.slice(4, 6), 16)];
}

function channelToLinear(channel: number): number {
  const c = channel / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function relativeLuminance([r, g, b]: [number, number, number]): number {
  const [rl, gl, bl] = [channelToLinear(r), channelToLinear(g), channelToLinear(b)];
  return 0.2126 * rl + 0.7152 * gl + 0.0722 * bl;
}

/** İki geçerli 6 haneli hex renk arasındaki WCAG kontrast oranını döner; geçersiz girdide `null`. */
export function contrastRatio(colorA: string, colorB: string): number | null {
  const rgbA = hexToRgb(colorA);
  const rgbB = hexToRgb(colorB);
  if (!rgbA || !rgbB) return null;
  const lA = relativeLuminance(rgbA);
  const lB = relativeLuminance(rgbB);
  const lighter = Math.max(lA, lB);
  const darker = Math.min(lA, lB);
  return (lighter + 0.05) / (darker + 0.05);
}

export function meetsWcagAa(colorA: string, colorB: string): boolean {
  const ratio = contrastRatio(colorA, colorB);
  return ratio !== null && ratio >= WCAG_AA_CONTRAST_THRESHOLD;
}
