"use client";

import { memo, useState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ChevronDown, ChevronLeft, ChevronRight, GripVertical, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { FlatNavItem } from "./nav-tree-utils";

interface NavTreeRowProps {
  item: FlatNavItem;
  canIndentItem: boolean;
  canOutdentItem: boolean;
  // `id` parametresi alır (kendi id'sine bağlı bir closure DEĞİL) — böylece NavTreeEditor bu
  // callback'leri `useCallback` ile TEK SEFER oluşturup her satıra AYNI referansı geçebilir.
  // Gerekçe: bkz. PERFORMANCE_NOTES.md — gerçek ölçümle doğrulanmış re-render bug'ı.
  onIndent: (id: string) => void;
  onOutdent: (id: string) => void;
  onUpdate: (id: string, patch: { label?: string; href?: string }) => void;
  onRemove: (id: string) => void;
  hrefHint: string;
}

/**
 * Sağ panel ağaç satırı — Karar 3: daralmış görünüm + "satır-içi accordion" düzenleme.
 * Girinti/derinlik GÖRSEL olarak satırın KENDİSİ tarafından değil, çağıran (`NavTreeEditor`)
 * tarafından — çocukları saran `border-l` konteyneriyle (Karar 4) — uygulanır; bu yüzden bu
 * bileşen kendi derinliğini bilmesi gerekmez.
 *
 * `memo`: `items` prop'u değişmediği sürece (ör. sürükleme sırasında `NavTreeEditor`'ın kendi
 * `offsetLeft`/`overId` state'i değiştiğinde) bu satırın props'ları (aynı `item` referansı +
 * stabil callback'ler) DEĞİŞMEZ — memo olmadan TÜM satırlar her sürükleme hareketinde yeniden
 * render oluyordu (gerçek ölçüm: PERFORMANCE_NOTES.md).
 */
export const NavTreeRow = memo(function NavTreeRow({
  item,
  canIndentItem,
  canOutdentItem,
  onIndent,
  onOutdent,
  onUpdate,
  onRemove,
  hrefHint,
}: NavTreeRowProps) {
  const [editOpen, setEditOpen] = useState(false);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div>
      <div
        ref={setNodeRef}
        style={style}
        className={cn(
          "flex items-center gap-2 rounded-lg border border-border/60 bg-surface px-3 py-2.5 transition-colors",
          "hover:border-border hover:bg-surface-muted",
          isDragging && "opacity-50"
        )}
      >
        <button
          type="button"
          {...attributes}
          {...listeners}
          aria-label={`Sürükle: ${item.label || "Adsız öğe"}`}
          className="flex h-8 w-8 shrink-0 cursor-grab items-center justify-center rounded-md text-foreground/40 hover:bg-surface-muted hover:text-foreground/70 active:cursor-grabbing"
        >
          <GripVertical className="h-4 w-4" />
        </button>
        <span className="flex-1 truncate text-sm font-medium text-foreground">{item.label || "Adsız öğe"}</span>
        <span className="hidden max-w-[160px] truncate text-xs text-foreground/40 sm:inline">{item.href}</span>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label="Girinti azalt (üst seviyeye taşı)"
          disabled={!canOutdentItem}
          onClick={() => onOutdent(item.id)}
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label="Girinti artır (alt öğe yap)"
          disabled={!canIndentItem}
          onClick={() => onIndent(item.id)}
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={editOpen ? "Düzenlemeyi kapat" : "Düzenle"}
          aria-expanded={editOpen}
          onClick={() => setEditOpen((v) => !v)}
        >
          <ChevronDown className={cn("h-4 w-4 transition-transform duration-200", editOpen && "rotate-180")} />
        </Button>
      </div>
      {editOpen && (
        <div className="mt-1 space-y-3 rounded-lg border border-border/60 bg-surface-muted/40 p-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor={`nav-tree-label-${item.id}`} className="block text-xs font-medium text-foreground/70">
                Etiket
              </label>
              <Input
                id={`nav-tree-label-${item.id}`}
                value={item.label}
                onChange={(e) => onUpdate(item.id, { label: e.target.value })}
                placeholder="Ör. Hakkımızda"
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor={`nav-tree-href-${item.id}`} className="block text-xs font-medium text-foreground/70">
                Bağlantı
              </label>
              <Input
                id={`nav-tree-href-${item.id}`}
                value={item.href}
                onChange={(e) => onUpdate(item.id, { href: e.target.value })}
                placeholder="/hakkimizda"
              />
            </div>
          </div>
          <p className="text-xs text-foreground/50">{hrefHint}</p>
          <Button type="button" variant="destructive" size="sm" onClick={() => onRemove(item.id)}>
            <Trash2 className="h-4 w-4" />
            Kaldır
          </Button>
        </div>
      )}
    </div>
  );
});

/** `DragOverlay` içeriği — Karar 5.5: sürüklenen satırın gerçek görsel kopyası. */
export function NavTreeRowOverlay({ item }: { item: FlatNavItem }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2.5 shadow-lg ring-2 ring-primary/40">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center text-foreground/40">
        <GripVertical className="h-4 w-4" />
      </span>
      <span className="flex-1 truncate text-sm font-medium text-foreground">{item.label || "Adsız öğe"}</span>
    </div>
  );
}

/** Karar 5.4: bırakma göstergesi — projelenen derinliğe göre sola/sağa kayan ince çizgi. */
export function DropIndicator({ depth }: { depth: 0 | 1 }) {
  return (
    <div
      className="relative h-0.5 rounded-full bg-primary before:absolute before:-left-1 before:-top-[3px] before:h-2 before:w-2 before:rounded-full before:bg-primary"
      style={{ marginLeft: depth * 32 }}
      aria-hidden="true"
    />
  );
}
