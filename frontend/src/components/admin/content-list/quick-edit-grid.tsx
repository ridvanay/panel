import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Tailwind JIT statik string tarama yapar — `` `md:grid-cols-${n}` `` gibi runtime
 * interpolasyonu derlemeye dahil EDİLMEZ. Bu yüzden `columns`/`span` → class eşlemesi
 * sabit, literal lookup tablolarıyla yapılır (bkz. design-notes-quick-edit-cards.md §C.4).
 */
const GRID_MD_CLASS = {
  1: "md:grid-cols-1",
  2: "md:grid-cols-[2fr_1fr]",
} as const;

const GRID_XL_CLASS = {
  1: "xl:grid-cols-1",
  2: "xl:grid-cols-[2fr_1fr]",
  3: "xl:grid-cols-[2fr_1fr_1fr]",
} as const;

const SPAN_MD_CLASS = { 1: "", 2: "md:col-span-2" } as const;
const SPAN_XL_CLASS = { 1: "xl:col-span-1", 2: "xl:col-span-2" } as const;

interface QuickEditGridProps {
  /**
   * Her breakpoint'te İZİN VERİLEN maksimum sütun sayısı. Gerçek kart sayısı (children)
   * bundan azsa (örn. Sayfalar'da 2 kart, columns.xl=3 varsayılanına rağmen) grid xl'de de
   * 2 sütunlu şablona düşer — çağıran taraf `columns` değerini kart sayısına göre KENDİSİ set eder,
   * component "children sayısına göre otomatik keşif" YAPMAZ (bkz. C.4 — Tailwind JIT kısıtı).
   */
  columns?: { base?: 1; md?: 1 | 2; xl?: 1 | 2 | 3 };
  children: ReactNode;
  className?: string;
}

/** Hızlı Düzenle formundaki kartların grid container'ı — bkz. design-notes-quick-edit-cards.md §C. */
export function QuickEditGrid({ columns, children, className }: QuickEditGridProps) {
  return (
    <div
      className={cn(
        "grid grid-cols-1 gap-3",
        GRID_MD_CLASS[columns?.md ?? 2],
        GRID_XL_CLASS[columns?.xl ?? 3],
        className
      )}
    >
      {children}
    </div>
  );
}

interface QuickEditCardProps {
  children: ReactNode;
  className?: string;
  /**
   * Grid'de kaç sütun kaplayacağı, breakpoint bazlı. SADECE 3-kartlı düzendeki Kart 3 (Durum)
   * için gerekli: md'de (henüz xl değilken) tam genişlik, xl'de tekrar tek sütun.
   */
  span?: { md?: 1 | 2; xl?: 1 | 2 };
}

/** Hızlı Düzenle formundaki mantıksal grup kartı — bkz. design-notes-quick-edit-cards.md §B.2/§C. */
export function QuickEditCard({ children, className, span }: QuickEditCardProps) {
  return (
    <div
      className={cn(
        "rounded-lg border border-border/60 bg-card p-3",
        SPAN_MD_CLASS[span?.md ?? 1],
        SPAN_XL_CLASS[span?.xl ?? 1],
        className
      )}
    >
      {children}
    </div>
  );
}
