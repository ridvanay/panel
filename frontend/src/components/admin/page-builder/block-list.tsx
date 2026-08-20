import type { LayoutPreset } from "@/lib/page-builder/presets";
import { LayoutPicker } from "./layout-picker";

/**
 * Elementor/Gutenberg-tarzı revizyon — içerik blokları artık ASLA doğrudan sayfa köküne
 * eklenemez (her içerik bir Konteyner/Sütun içinde yer almak ZORUNDA). Bu yüzden palette'in
 * eski "İçerik" bölümü (kök seviyesindeki `+ Hero`/`+ Metin`/… düğmeleri) tamamen KALDIRILDI —
 * içerik ekleme artık yalnızca her konteynerin kendi in-container ekleyicisi (`AddContentMenu`,
 * bkz. `builder-canvas.tsx`) üzerinden yapılır. Sayfa kökünde yalnızca "Düzen" (Layout Picker)
 * alanı kalır.
 */
export function BlockList({
  onAddLayout,
  targetLabel,
  layoutDisabled,
  layoutDisabledReason,
}: {
  onAddLayout: (preset: LayoutPreset) => void;
  /** "Ekleniyor: …" bağlam satırı — seçili konteyner (yoksa "Sayfa (kök)"). */
  targetLabel: string;
  layoutDisabled?: boolean;
  layoutDisabledReason?: string;
}) {
  return (
    <LayoutPicker
      targetLabel={targetLabel}
      disabled={layoutDisabled}
      disabledReason={layoutDisabledReason}
      onSelect={onAddLayout}
    />
  );
}
