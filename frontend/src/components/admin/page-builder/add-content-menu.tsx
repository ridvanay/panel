"use client";

import { useEffect, useRef, useState } from "react";
import { useDroppable } from "@dnd-kit/core";
import { FolderPlus, Plus, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { cn } from "@/lib/utils";
import { blockRegistry, PALETTE_CATEGORIES, PALETTE_CATEGORY_LABEL, type PaletteBlockCategory, type PaletteBlockType } from "@/lib/page-builder/registry";
import { MAX_CHILDREN_PER_CONTAINER, type BuilderContainerId } from "@/lib/page-builder/types";
import type { LayoutPreset } from "@/lib/page-builder/presets";
import { LayoutPresetPopoverGrid } from "./container-inserter";

/**
 * §Faz 0 kullanıcı isteği — konteynerin boş durumu: Elementor-tarzı kesikli çizgili kutu,
 * ortasında büyük "+ Eleman Ekle" tetikleyicisi (bkz. `AddContentMenu` `variant="prominent"`).
 */
export function EmptyContainerDropZone({
  containerId,
  atMax,
  atMaxDepth,
  onAdd,
  onInsertContainer,
}: {
  containerId: BuilderContainerId;
  atMax: boolean;
  atMaxDepth: boolean;
  onAdd: (type: PaletteBlockType) => void;
  onInsertContainer: (preset: LayoutPreset) => void;
}) {
  const { isOver, setNodeRef } = useDroppable({ id: containerId });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex min-h-28 flex-col items-center justify-center gap-2.5 rounded-lg border-2 border-dashed border-border/60 bg-surface-muted/20 text-center transition-colors",
        isOver && "border-primary bg-primary/5"
      )}
    >
      <AddContentMenu disabled={atMax} onAdd={onAdd} variant="prominent" atMaxDepth={atMaxDepth} onInsertContainer={onInsertContainer} />
      <p className={cn("text-xs text-foreground/40", isOver && "text-primary")}>veya buraya blok sürükleyin</p>
    </div>
  );
}

function normalizeSearch(value: string): string {
  return value.toLocaleLowerCase("tr").trim();
}

/**
 * Kategorize + aranabilir blok seçici (§Faz 0 kullanıcı isteği — "üstte Arama inputu ve
 * blokları ayıran sekmeler/kategoriler"). Aramayla eşleşen bloklar TÜM kategorilerden gösterilir
 * (arama doluyken sekmeler gizlenir); arama boşken yalnızca seçili kategori.
 *
 * **e2e UYUMLULUĞU (KIRILMAMALI)** — bloklar YİNE `DropdownMenuItem` (`role="menuitem"`), erişilebilir
 * adı YİNE salt `meta.label`; tetikleyicinin `aria-label`'ı `variant`e göre YİNE `"Konteynere blok
 * ekle"` (boş durum) / `"Konteynere daha fazla blok ekle"` (dolu durum) — bkz.
 * `admin-page-builder-containers.spec.ts` / `admin-page-builder-gallery.spec.ts`.
 */
export function AddContentMenu({
  onAdd,
  disabled,
  variant = "icon",
  atMaxDepth,
  onInsertContainer,
}: {
  onAdd: (type: PaletteBlockType) => void;
  disabled?: boolean;
  /** "icon" — DOLU bir konteynerin sonuna eklenen küçük "daha fazla blok ekle" düğmesi.
   *  "prominent" — Elementor-tarzı boş durum "+ Eleman Ekle" düğmesi. */
  variant?: "icon" | "prominent";
  /** v2 tasarım notları §2.2a — menünün en başındaki pinned "İç Konteyner / Bölüm Ekle" satırının
   *  `LayoutPresetPopoverGrid`'ini devre dışı bırakmak için (derinlik sınırına ulaşıldıysa). */
  atMaxDepth: boolean;
  /** v2 tasarım notları §2.2a — pinned satırda bir preset seçilince çağrılır (çağıran taraf
   *  `ctx.onInsertContainer(containerId, children.length, preset)` closure'ını geçirir). */
  onInsertContainer: (preset: LayoutPreset) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<PaletteBlockCategory>("basic");
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Popover her açıldığında arama input'una odaklan (base-ui Menu'nün varsayılan "ilk öğeye
  // odaklan" davranışı yerine — arama-öncelikli bir "komut paleti" hissi için).
  useEffect(() => {
    if (!open) return;
    const raf = requestAnimationFrame(() => searchInputRef.current?.focus());
    return () => cancelAnimationFrame(raf);
  }, [open]);

  const allEntries = Object.entries(blockRegistry) as [PaletteBlockType, (typeof blockRegistry)[PaletteBlockType]][];
  const normalizedQuery = normalizeSearch(query);
  const visible = normalizedQuery
    ? allEntries.filter(([, meta]) => normalizeSearch(meta.label).includes(normalizedQuery))
    : allEntries.filter(([, meta]) => meta.category === category);

  const label = variant === "prominent" ? "Konteynere blok ekle" : "Konteynere daha fazla blok ekle";
  const title = disabled ? `Bir konteynerde en fazla ${MAX_CHILDREN_PER_CONTAINER} öğe olabilir` : label;

  return (
    <DropdownMenu
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) setQuery("");
      }}
    >
      <DropdownMenuTrigger
        render={
          variant === "prominent" ? (
            <Button type="button" variant="secondary" size="sm" aria-label={label} disabled={disabled} title={title} />
          ) : (
            <Button type="button" variant="ghost" size="icon-sm" aria-label={label} disabled={disabled} title={title} />
          )
        }
      >
        <Plus className="h-4 w-4" />
        {variant === "prominent" && "Eleman Ekle"}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="center" className="w-80">
        <DropdownMenuSub>
          <DropdownMenuSubTrigger className="bg-surface-muted/40 font-medium text-foreground hover:bg-primary/10">
            <FolderPlus className="h-4 w-4 text-primary" />
            İç Konteyner / Bölüm Ekle
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-80">
            <LayoutPresetPopoverGrid
              disabled={atMaxDepth}
              disabledReason="Maksimum iç içe geçme derinliğine ulaşıldı (4)"
              onSelect={(preset) => onInsertContainer(preset)}
            />
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSeparator />
        <div className="space-y-2 p-1 pb-0">
          <InputGroup>
            <InputGroupAddon align="inline-start">
              <Search className="h-3.5 w-3.5 text-foreground/40" aria-hidden />
            </InputGroupAddon>
            <InputGroupInput
              ref={searchInputRef}
              value={query}
              placeholder="Blok ara…"
              aria-label="Blok ara"
              onChange={(e) => setQuery(e.target.value)}
              // Base-ui Menu'nün klavye roving-focus/typeahead dinleyicisi tuş vuruşlarını
              // YUTMASIN diye — arama input'u kendi normal metin girişi davranışını korur.
              onKeyDown={(e) => e.stopPropagation()}
            />
            {query && (
              <InputGroupAddon align="inline-end">
                <Button type="button" variant="ghost" size="icon-xs" aria-label="Aramayı temizle" onClick={() => setQuery("")}>
                  <X className="h-3.5 w-3.5" />
                </Button>
              </InputGroupAddon>
            )}
          </InputGroup>
          {!normalizedQuery && (
            <div className="flex flex-wrap gap-1" role="tablist" aria-label="Blok kategorisi">
              {PALETTE_CATEGORIES.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  role="tab"
                  aria-selected={cat === category}
                  onClick={() => setCategory(cat)}
                  className={cn(
                    "rounded-full px-2.5 py-1 text-[11px] font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                    cat === category ? "bg-primary/10 text-primary" : "text-foreground/50 hover:bg-surface-muted hover:text-foreground/80"
                  )}
                >
                  {PALETTE_CATEGORY_LABEL[cat]}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="grid grid-cols-2 gap-1 p-1 pt-1.5">
          {visible.length === 0 ? (
            <p className="col-span-2 py-4 text-center text-xs text-foreground/40">Eşleşen blok bulunamadı.</p>
          ) : (
            visible.map(([type, meta]) => {
              const Icon = meta.icon;
              return (
                <DropdownMenuItem
                  key={type}
                  onClick={() => onAdd(type)}
                  className="flex-col items-center gap-1.5 rounded-lg border border-transparent py-2.5 text-center hover:border-border hover:bg-surface-muted"
                >
                  <Icon className="h-5 w-5 text-primary" aria-hidden />
                  <span className="text-xs leading-tight text-foreground/80">{meta.label}</span>
                </DropdownMenuItem>
              );
            })
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
