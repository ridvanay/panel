"use client";

import { LayoutTemplate, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { LAYOUT_PRESETS, type LayoutPreset } from "@/lib/page-builder/presets";

/**
 * `.claude/design-notes-page-builder-dynamic-container-insertion.md` §2-§4 BİREBİR — sabit üst
 * "DÜZEN" panelinin (`block-list.tsx`/`layout-picker.tsx`, SİLİNDİ) yerini alan üç pozisyonel
 * konteyner-ekleme tetikleyicisi. `LayoutPresetTile` eski `layout-picker.tsx`'ten TAŞINDI (dışa
 * aktarılmaz, yalnızca `LayoutPresetPopoverGrid`'in iç parçası).
 */

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

/**
 * Üç tetikleyicinin (§3 canvas sonu/boş durum, §4 between-inserter, §5 "+Alta") PAYLAŞTIĞI
 * popover içeriği — arama YOK, sabit 7 karolu `grid-cols-4` (§6: içerik bloğu eklemenin
 * `DropdownMenu`ünden kasıtlı olarak hem kabuk hem karo görseli düzeyinde ayrışır). `disabled`
 * tüm grid'i kapatır (tek tek karo bazlı kısmi devre dışı bırakma YOK — §2.3, `container-ui.md`
 * §3.1'deki emsalle tutarlı).
 *
 * `presets`/`columns` — v2 tasarım notları §2.2b: iç konteyner ekleme butonu YALNIZCA "Tekli
 * Konteyner"/"2'li Sütun" preset'lerini + 2'li grid'i sunar. Her iki prop da OPSİYONEL —
 * verilmezse mevcut 7'li `LAYOUT_PRESETS` + `grid-cols-4` davranışı AYNEN korunur (geriye dönük
 * uyumluluk, sibling-insert çağrıları ETKİLENMEZ).
 */
export function LayoutPresetPopoverGrid({
  presets = LAYOUT_PRESETS,
  columns = 4,
  disabled,
  disabledReason,
  onSelect,
}: {
  presets?: LayoutPreset[];
  columns?: number;
  disabled?: boolean;
  disabledReason?: string;
  onSelect: (preset: LayoutPreset) => void;
}) {
  return (
    <div className={cn("grid gap-2", columns === 2 ? "grid-cols-2" : "grid-cols-4")}>
      {presets.map((preset) => (
        <LayoutPresetTile key={preset.id} preset={preset} disabled={!!disabled} disabledReason={disabledReason} onSelect={onSelect} />
      ))}
    </div>
  );
}

/**
 * §3 — canvas sonu (`variant="appended"`, dolu sayfa) / boş durum hero'sunun İÇİNE gömülü CTA
 * (`variant="empty"`). Aynı bileşenin iki görsel modu (§3.2 — iki ayrı bileşen İCAT EDİLMEZ);
 * kök seviyeye ekleme her zaman `disabled={false}` (§2.3 — çok-sütunlu preset bile en fazla
 * derinlik 2 üretir, `MAX_CONTAINER_DEPTH=4`'ü asla aşamaz).
 */
export function NewContainerInserter({
  variant,
  onInsert,
}: {
  variant: "appended" | "empty";
  onInsert: (preset: LayoutPreset) => void;
}) {
  if (variant === "empty") {
    return (
      <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-border/60 bg-surface-muted/20 px-8 py-16 text-center">
        <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <LayoutTemplate className="h-7 w-7" aria-hidden />
        </span>
        <div className="space-y-1">
          <h3 className="text-base font-semibold text-foreground">Sayfa Tasarımına Başlayın</h3>
          <p className="max-w-sm text-sm text-foreground/60">Aşağıdaki düğmeyle ilk bölümünüzü/konteynerinizi ekleyin.</p>
        </div>
        <Popover>
          <PopoverTrigger render={<Button type="button" variant="secondary" size="sm" aria-label="Yeni Konteyner Ekle" />}>
            <Plus className="h-4 w-4" />
            Yeni Konteyner Ekle
          </PopoverTrigger>
          <PopoverContent align="center" className="w-80">
            <LayoutPresetPopoverGrid onSelect={onInsert} />
          </PopoverContent>
        </Popover>
      </div>
    );
  }

  return (
    <Popover>
      <PopoverTrigger
        render={
          <button
            type="button"
            aria-label="Yeni Konteyner Ekle"
            className={cn(
              "flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border/50",
              "bg-surface-muted/10 py-5 text-sm font-medium text-foreground/50 transition-colors outline-none",
              "hover:border-primary/50 hover:bg-primary/5 hover:text-primary",
              "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            )}
          />
        }
      >
        <LayoutTemplate className="h-4 w-4" aria-hidden />
        Yeni Konteyner Ekle
      </PopoverTrigger>
      <PopoverContent align="center" className="w-80">
        <LayoutPresetPopoverGrid onSelect={onInsert} />
      </PopoverContent>
    </Popover>
  );
}

/**
 * §4 — kök listede VE `direction: "column"` bir konteynerin `children`'ında sibling düğümler
 * arasına serpiştirilen hover-inserter (`direction: "row"` sütunları arasında GÖSTERİLMEZ, bkz.
 * `builder-canvas.tsx::ContainerCard`). Dinlenme/hover opaklık formülü `ContainerCard` kontrol
 * barıyla AYNI aile (§4.1) — buton HER ZAMAN DOM'da/tıklanabilir, yalnızca görsel ağırlığı değişir
 * (`opacity-40` dinlenmede, `opacity-100` hover/focus-within'de).
 */
export function BetweenContainersInserter({
  index,
  disabled,
  disabledReason,
  onInsert,
}: {
  /** Yeni konteynerin ekleneceği indeks — DOM sırasında araya girdiği için ayrıca bir hedef metni gerekmez (§1.1). */
  index: number;
  disabled?: boolean;
  disabledReason?: string;
  onInsert: (index: number, preset: LayoutPreset) => void;
}) {
  return (
    <div
      className={cn(
        "group/inserter relative flex h-4 items-center opacity-40 transition-opacity duration-150",
        "hover:opacity-100 focus-within:opacity-100"
      )}
    >
      <span className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-primary/40" aria-hidden />
      <div className="relative mx-auto">
        <Popover>
          <PopoverTrigger
            render={
              <Button
                type="button"
                variant="secondary"
                size="icon-sm"
                aria-label="Aralarına yeni konteyner ekle"
                title="Aralarına yeni konteyner ekle"
                className="rounded-full border border-primary/40 shadow-sm"
              />
            }
          >
            <Plus className="h-3.5 w-3.5" />
          </PopoverTrigger>
          <PopoverContent align="center" className="w-80">
            <LayoutPresetPopoverGrid disabled={disabled} disabledReason={disabledReason} onSelect={(preset) => onInsert(index, preset)} />
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
}
