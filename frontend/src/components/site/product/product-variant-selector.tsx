"use client";

import type { ProductVariantOption } from "@/lib/api/types";
import { cn } from "@/lib/utils";

/**
 * `-45deg` köşeden köşeye çizgi tekniği — `.claude/design-notes-ecommerce-storefront.md` §1/§2
 * BİREBİR: `w-[141%]` (bounding box köşegeni, `sqrt(2)*100%`), swatch VE beden butonunda AYNI
 * `bg-danger` rengi (WCAG AA — `--danger` her zaman `--surface` zemininde 6.47:1 garantili,
 * `swatchHex`'ten BAĞIMSIZ).
 */
function DisabledDiagonalLine() {
  return (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute left-1/2 top-1/2 h-0.5 w-[141%] -translate-x-1/2 -translate-y-1/2 -rotate-45 bg-danger"
    />
  );
}

interface OptionButtonProps {
  value: string;
  swatchHex: string | null;
  selected: boolean;
  available: boolean;
  onSelect: () => void;
  /** Kompakt bağlamlarda (sepet satırı özeti) `w-6 h-6` — PDP varsayılanı `w-8 h-8`. */
  compact?: boolean;
}

function ColorSwatchOption({ value, swatchHex, selected, available, onSelect, compact }: OptionButtonProps) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-label={`${value}${available ? "" : " — Stokta yok"}`}
      aria-disabled={!available || undefined}
      disabled={!available}
      onClick={onSelect}
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center rounded-full border-2 transition-transform duration-150",
        compact ? "h-6 w-6" : "h-8 w-8",
        available
          ? cn("hover:scale-105 hover:border-foreground/30", selected ? "border-transparent" : "border-border")
          : "cursor-not-allowed pointer-events-none border-border opacity-60",
        selected && available && "ring-2 ring-offset-2 ring-offset-surface ring-primary"
      )}
    >
      <span aria-hidden="true" className="absolute inset-0 rounded-full" style={{ backgroundColor: swatchHex ?? "transparent", opacity: available ? 1 : 0.4 }} />
      {!available && (
        <>
          <span aria-hidden="true" className="absolute inset-0 rounded-full bg-surface/50" />
          <DisabledDiagonalLine />
        </>
      )}
    </button>
  );
}

function SizeButtonOption({ value, selected, available, onSelect }: OptionButtonProps) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-label={`${value}${available ? "" : " — Stokta yok"}`}
      aria-disabled={!available || undefined}
      disabled={!available}
      onClick={onSelect}
      className={cn(
        "relative inline-flex h-10 min-w-10 shrink-0 items-center justify-center rounded-[var(--site-radius)] px-3 text-sm transition-colors duration-150",
        available
          ? selected
            ? "border-2 border-primary bg-primary/5 font-semibold text-primary"
            : "border border-border bg-surface text-foreground hover:border-foreground/40 hover:bg-muted"
          : "cursor-not-allowed pointer-events-none border border-border/60 text-foreground/30"
      )}
    >
      {value}
      {!available && <DisabledDiagonalLine />}
    </button>
  );
}

interface ProductVariantSelectorProps {
  axis: ProductVariantOption;
  selectedValue: string | null;
  isValueAvailable: (value: string) => boolean;
  onSelect: (value: string) => void;
  compact?: boolean;
}

/**
 * Tek bir varyasyon EKSENİNİN seçici grubu — `.claude/design-notes-ecommerce-storefront.md`
 * §1/§2. Renk-körü/ekran-okuyucu güvenliği: her seçenek `role="radio"` + değer adı HER ZAMAN
 * `aria-label`'da metin olarak durur, yalnızca renge güvenilmez (WCAG 1.4.1).
 */
export function ProductVariantSelector({ axis, selectedValue, isValueAvailable, onSelect, compact }: ProductVariantSelectorProps) {
  const labelId = `variant-axis-${axis.name}`;

  return (
    <div>
      <span id={labelId} className="block text-sm font-medium text-foreground">
        {axis.name}
        {selectedValue ? `: ${selectedValue}` : ""}
      </span>
      <div role="radiogroup" aria-labelledby={labelId} className="mt-2 flex flex-wrap gap-2">
        {axis.values.map((optionValue) => {
          const available = isValueAvailable(optionValue.value);
          const selected = selectedValue === optionValue.value;
          const props: OptionButtonProps = {
            value: optionValue.value,
            swatchHex: optionValue.swatchHex,
            selected,
            available,
            onSelect: () => onSelect(optionValue.value),
            compact,
          };
          return axis.type === "SWATCH" ? (
            <ColorSwatchOption key={optionValue.value} {...props} />
          ) : (
            <SizeButtonOption key={optionValue.value} {...props} />
          );
        })}
      </div>
    </div>
  );
}
