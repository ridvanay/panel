/**
 * Gelişmiş Slider / Hero Studio — ui-designer tasarım tokenleri (kod tüketimi).
 * Kaynak: `.claude/ui-designer-scope-advanced-slider.md` §1/§3/§6.4 — BİREBİR kopyalanmıştır,
 * frontend-agent kendi renk/boyut kararı ÜRETMEZ. Ham CSS değerleri `frontend/src/app/globals.css`
 * (`:root` — `--slider-*` değişkenleri) içindedir, bu dosya yalnızca onları tüketim yerine eşler.
 */
import type { SliderLayerStyle, SliderLayerType } from "./types";

/** §1 — `SliderLayerStyle.shadow` → gerçek `box-shadow` (Tailwind shadow-sm/md/lg ile birebir). */
export const SHADOW_VAR: Record<NonNullable<SliderLayerStyle["shadow"]>, string> = {
  none: "var(--slider-layer-shadow-none)",
  sm: "var(--slider-layer-shadow-sm)",
  md: "var(--slider-layer-shadow-md)",
  lg: "var(--slider-layer-shadow-lg)",
};

/**
 * §3 — Katman butonu varyantları. `solid`/`outline` mevcut `SITE_BUTTON_STYLE_CLASSES`
 * (`site-header.tsx`) ile BİREBİR aynı görsel dili kullanır, `ghost` aynı ailenin üçüncü,
 * daha sessiz üyesidir.
 */
export const SLIDER_BUTTON_VARIANT_CLASS: Record<"solid" | "outline" | "ghost", string> = {
  solid: "bg-[var(--site-button)] text-[var(--site-button-text)] hover:opacity-85",
  outline:
    "border-2 border-[var(--site-button)] bg-transparent text-[var(--site-button)] hover:bg-[var(--site-button)]/10",
  ghost: "bg-transparent text-[var(--site-button)] hover:bg-[var(--site-button)]/10",
};

/** §3.1 — hero/pazarlama CTA'sına özgü boyut ölçeği (admin `Button` ölçeğinden AYRI, KASITLI). */
export const SLIDER_BUTTON_SIZE_CLASS: Record<"sm" | "md" | "lg", string> = {
  sm: "px-4 py-2 text-sm gap-2",
  md: "px-6 py-3 text-base gap-2",
  lg: "px-8 py-4 text-lg gap-2",
};

/** §3.2 — `LayerStyleSchema.fontFamily` → site tema fontu. */
export const LAYER_FONT_FAMILY_VAR: Record<"inherit" | "heading" | "body", string | undefined> = {
  inherit: undefined,
  heading: "var(--site-heading-font)",
  body: "var(--site-body-font)",
};

/** §6.4 — Katman tipi renk kodlaması: tuval seçim etiketi + zaman çizelgesi çubuğu ORTAK kaynağı. */
export const SLIDER_LAYER_TYPE_COLOR: Record<SliderLayerType, string> = {
  heading: "var(--slider-layer-type-heading)",
  text: "var(--slider-layer-type-text)",
  button: "var(--slider-layer-type-button)",
  image: "var(--slider-layer-type-image)",
  badge: "var(--slider-layer-type-badge)",
};

/** Katman tipi kısa Türkçe etiketleri — inspector/timeline/slide şeridi paylaşır. */
export const SLIDER_LAYER_TYPE_LABEL: Record<SliderLayerType, string> = {
  heading: "Başlık",
  text: "Metin",
  button: "Buton",
  image: "Görsel",
  badge: "Rozet",
};
