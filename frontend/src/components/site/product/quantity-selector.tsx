"use client";

import { Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";

interface QuantitySelectorProps {
  value: number;
  onChange: (value: number) => void;
  /** Üst sınır — `0` iken (stok yok/varyasyon seçilmedi) `+` devre dışı kalır. */
  max: number;
  min?: number;
  disabled?: boolean;
}

/**
 * `.claude/design-notes-products-catalog.md` §4.3 — salt stepper (sayı GİRİLEMEZ, geçersiz
 * elle-yazım kenar durumlarından kaçınmak için bilinçli basitleştirme). `h-9` — "Sepete Ekle"
 * (`size="lg"`) ile AYNI yükseklik.
 */
export function QuantitySelector({ value, onChange, max, min = 1, disabled }: QuantitySelectorProps) {
  return (
    <div className="inline-flex h-9 items-center divide-x divide-border rounded-[var(--site-radius)] border border-border">
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="h-9 w-9 rounded-none rounded-l-[var(--site-radius)]"
        disabled={disabled || value <= min}
        aria-label="Azalt"
        onClick={() => onChange(Math.max(min, value - 1))}
      >
        <Minus className="h-3.5 w-3.5" />
      </Button>
      <span className="w-10 text-center text-sm font-medium tabular-nums" aria-live="polite">
        {value}
      </span>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="h-9 w-9 rounded-none rounded-r-[var(--site-radius)]"
        disabled={disabled || value >= max}
        aria-label="Artır"
        onClick={() => onChange(Math.min(max, value + 1))}
      >
        <Plus className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}
