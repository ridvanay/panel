import type { ReactNode } from "react";
import { CornerDownRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { LAYOUT_PRESETS, type LayoutPreset } from "@/lib/page-builder/presets";

/**
 * design-notes-page-builder-container-ui.md §1 — Layout Picker: 7 ön ayar, gerçek oranı
 * yansıtan mini flex önizlemeleri (ikon DEĞİL — bkz. §1.2 gerekçesi). Palette'in "Düzen"
 * bölümünü ve "Ekleniyor: …" bağlam satırını (§1.3) barındırır.
 */

/** §2.1 deseni — `email-editor/style-controls.tsx::StyleSectionLabel` ile BİREBİR aynı sınıf,
 *  page-builder kendi yerel kopyasını tutar (cross-feature import YAPILMAZ). */
export function PaletteSectionLabel({ children }: { children: ReactNode }) {
  return <p className="text-[11px] font-semibold tracking-wide text-foreground/40 uppercase">{children}</p>;
}

function LayoutPresetTile({
  preset,
  disabled,
  disabledReason,
  onSelect,
}: {
  preset: LayoutPreset;
  disabled: boolean;
  disabledReason?: string;
  onSelect: (preset: LayoutPreset) => void;
}) {
  return (
    <button
      type="button"
      aria-label={preset.label}
      title={disabled ? disabledReason : preset.label}
      disabled={disabled}
      onClick={() => onSelect(preset)}
      className={cn(
        "flex flex-col items-center gap-1.5 rounded-lg border border-border/60 bg-surface-muted p-2 transition-colors outline-none",
        "hover:border-primary/50 hover:bg-primary/5 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
        disabled && "pointer-events-none opacity-50"
      )}
    >
      <span className="flex h-8 w-14 items-stretch gap-0.5 rounded-md border border-border/50 bg-background p-1" aria-hidden>
        {preset.weights.map((w, i) => (
          <span key={i} style={{ flexGrow: w }} className="rounded-[2px] bg-primary/25" />
        ))}
      </span>
      <span className="text-[11px] font-medium text-foreground/70">{preset.label}</span>
    </button>
  );
}

export function LayoutPicker({
  targetLabel,
  disabled = false,
  disabledReason,
  onSelect,
}: {
  /** "Ekleniyor: {targetLabel}" bağlam satırı — §1.3. */
  targetLabel: string;
  /** Seçili konteyner `MAX_CONTAINER_DEPTH`'e ulaştıysa TÜM karolar devre dışı bırakılır. */
  disabled?: boolean;
  disabledReason?: string;
  onSelect: (preset: LayoutPreset) => void;
}) {
  return (
    <div className="space-y-2">
      <p className="flex items-center gap-1.5 text-xs text-foreground/50">
        <CornerDownRight className="h-3.5 w-3.5 shrink-0" aria-hidden />
        Ekleniyor: <span className="font-medium text-foreground/80">{targetLabel}</span>
      </p>
      <PaletteSectionLabel>Düzen</PaletteSectionLabel>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {LAYOUT_PRESETS.map((preset) => (
          <LayoutPresetTile
            key={preset.id}
            preset={preset}
            disabled={disabled}
            disabledReason={disabledReason}
            onSelect={onSelect}
          />
        ))}
      </div>
    </div>
  );
}
