export const DEFAULT_HEADER_LOGO_HEIGHT = 32;
export const FOOTER_LOGO_RATIO = 0.875;

export function getFooterLogoHeight(headerHeight?: number | null): number {
  return Math.round((headerHeight ?? DEFAULT_HEADER_LOGO_HEIGHT) * FOOTER_LOGO_RATIO);
}
