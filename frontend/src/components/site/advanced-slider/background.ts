import type { Media } from "@/lib/api/types";
import type { PublicSlide } from "@/lib/sliders/types";

/**
 * Slayt arka planı — cihaza göre görsel seçimi, "görselin tamamını göster" yükseklikleri ve
 * okunabilirlik gradyanı. Public render (`advanced-slider.tsx`) ve admin önizlemesi
 * (`hero-canvas.tsx`) AYNI kuralları kullansın diye saf fonksiyonlardır.
 *
 * Cihaz eşikleri `resolve-responsive.ts` ile AYNIDIR: mobil ≤767px, tablet 768–1023px, masaüstü ≥1024px.
 */
export const SLIDER_MOBILE_MEDIA = "(max-width: 767px)";
export const SLIDER_TABLET_MEDIA = "(min-width: 768px) and (max-width: 1023px)";
/** `<source media>` sırası önemlidir (ilk eşleşen kazanır) — tablet kaynağı mobilden SONRA yazılır. */
export const SLIDER_TABLET_OR_SMALLER_MEDIA = "(max-width: 1023px)";

export type SliderDevice = "desktop" | "tablet" | "mobile";

export interface DeviceBackground {
  media: Media;
  /** CSS object-position yüzdeleri. */
  x: number;
  y: number;
}

export type SlideBackgrounds = Record<SliderDevice, DeviceBackground | null>;

/**
 * Yedek sırası (kullanıcı kararı 2026-09-25): tablet görseli yoksa masaüstü; mobil görseli yoksa
 * tablet, o da yoksa masaüstü. Odak noktası aynı zinciri izler (boş = bir üstteki cihazın değeri).
 */
export function resolveSlideBackgrounds(slide: PublicSlide): SlideBackgrounds {
  const desktopMedia = slide.bgMedia;
  const tabletMedia = slide.bgTabletMedia ?? desktopMedia;
  const mobileMedia = slide.bgMobileMedia ?? tabletMedia;
  const tabletX = slide.bgTabletPositionX ?? slide.bgPositionX;
  const tabletY = slide.bgTabletPositionY ?? slide.bgPositionY;
  return {
    desktop: desktopMedia ? { media: desktopMedia, x: slide.bgPositionX, y: slide.bgPositionY } : null,
    tablet: tabletMedia ? { media: tabletMedia, x: tabletX, y: tabletY } : null,
    mobile: mobileMedia ? { media: mobileMedia, x: slide.bgMobilePositionX ?? tabletX, y: slide.bgMobilePositionY ?? tabletY } : null,
  };
}

/** Görselin piksel boyutundan CSS `aspect-ratio` değeri — boyut bilinmiyorsa `null`. */
function ratioOf(background: DeviceBackground | null): string | null {
  const { width, height } = background?.media ?? {};
  return width && height ? `${width} / ${height}` : null;
}

/**
 * "Görselin tamamını göster" modunda slider'ın cihaz başına oranı — İLK slaytın o cihazdaki
 * görselinden. Tüm slaytlar aynı kutuyu paylaşır (geçişte yükseklik zıplamaz); farklı orandaki
 * diğer slaytlar kutunun içinde kırpılmadan ortalanır. `null` → slider'ın yükseklik ayarı kullanılır.
 */
export function containAspectRatios(firstSlide: PublicSlide | undefined): Record<SliderDevice, string | null> {
  if (!firstSlide || firstSlide.bgType !== "image") return { desktop: null, tablet: null, mobile: null };
  const backgrounds = resolveSlideBackgrounds(firstSlide);
  return { desktop: ratioOf(backgrounds.desktop), tablet: ratioOf(backgrounds.tablet), mobile: ratioOf(backgrounds.mobile) };
}

/**
 * Soldan sağa okunabilirlik gradyanı — eskiden görselli her slayta sabit uygulanan
 * `from-black/70 via-black/40 to-transparent` ile AYNI eğri, opaklık ölçeklenebilir
 * (%70 → orta nokta %40 → 0; orta = opaklık × 4/7).
 */
export function scrimBackground(opacityPercent: number): string {
  const edge = Math.max(0, Math.min(100, opacityPercent)) / 100;
  const middle = Math.round(edge * (4 / 7) * 1000) / 1000;
  return `linear-gradient(to right, rgba(0, 0, 0, ${edge}) 0%, rgba(0, 0, 0, ${middle}) 50%, rgba(0, 0, 0, 0) 100%)`;
}
