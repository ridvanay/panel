import { Button } from "@/components/ui/button";
import { blockRegistry, type PaletteBlockType } from "@/lib/page-builder/registry";
import type { LayoutPreset } from "@/lib/page-builder/presets";
import { LayoutPicker, PaletteSectionLabel } from "./layout-picker";

/**
 * design-notes-page-builder-container-ui.md §1.1 — Palette iki bölüme ayrılır: "Düzen" (7 ön
 * ayar, `LayoutPicker`) ve "İçerik" (mevcut blok çipleri, DEĞİŞMEDEN). İki bölüm HER ZAMAN aynı
 * anda görünür (sekme arkasına gizlenmez).
 */
export function BlockList({
  onAddContent,
  onAddLayout,
  targetLabel,
  layoutDisabled,
  layoutDisabledReason,
}: {
  onAddContent: (type: PaletteBlockType) => void;
  onAddLayout: (preset: LayoutPreset) => void;
  /** "Ekleniyor: …" bağlam satırı — seçili konteyner (yoksa "Sayfa (kök)"). */
  targetLabel: string;
  layoutDisabled?: boolean;
  layoutDisabledReason?: string;
}) {
  return (
    <div className="space-y-4">
      <LayoutPicker
        targetLabel={targetLabel}
        disabled={layoutDisabled}
        disabledReason={layoutDisabledReason}
        onSelect={onAddLayout}
      />

      <div className="space-y-2 border-t border-border/60 pt-4">
        <PaletteSectionLabel>İçerik</PaletteSectionLabel>
        <div className="flex flex-wrap gap-2">
          {(Object.entries(blockRegistry) as [PaletteBlockType, { label: string }][]).map(([type, meta]) => (
            <Button key={type} type="button" variant="secondary" size="sm" onClick={() => onAddContent(type)}>
              + {meta.label}
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}
