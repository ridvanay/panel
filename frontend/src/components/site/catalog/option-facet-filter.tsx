"use client";

import { usePathname, useRouter } from "next/navigation";
import { Check } from "lucide-react";
import type { ProductOptionFacet } from "@/lib/api/types";
import { buildCatalogHref, toggleCatalogOption, type CatalogFilters } from "@/lib/catalog-search-params";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface OptionFacetFilterProps {
  filters: CatalogFilters;
  axis: ProductOptionFacet;
  /** Kompakt yükseklik — sidebar (`h-8`/24px swatch) varsayılanı `true`. */
  compact?: boolean;
}

/**
 * `.claude/design-notes-products-catalog.md` §1.4 — sidebar ÇOKLU-SEÇİM (`role="checkbox"`,
 * `aria-checked`), PDP'nin TEKLİ-SEÇİM (`role="radio"`) `product-variant-selector.tsx`'İNDEN
 * FARKLI bir bileşendir (aynı görsel dili paylaşır ama semantiği farklıdır). Facet sayacı `0`
 * olan değer DNS'in "stoksuz" görsel tekniğiyle AYNI (diagonal çizgi) ama anlamı FARKLIDIR: "bu
 * seçilirse 0 sonuç" (disjunctive facet).
 */
export function OptionFacetFilter({ filters, axis, compact = true }: OptionFacetFilterProps) {
  const router = useRouter();
  const pathname = usePathname();

  function handleToggle(token: string) {
    const href = buildCatalogHref(pathname, filters, { options: toggleCatalogOption(filters.options, token) });
    router.replace(href, { scroll: false });
  }

  return (
    <div role="group" aria-label={`${axis.axisName} filtresi`} className="flex flex-wrap gap-2">
      {axis.values.map((value) => {
        const selected = filters.options.includes(value.token);
        const available = value.count > 0;
        const label = `${value.value}${available ? "" : " — 0 sonuç"}`;

        if (axis.type === "SWATCH") {
          return (
            <Tooltip key={value.token}>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={selected}
                    aria-label={label}
                    disabled={!available}
                    onClick={() => handleToggle(value.token)}
                    className={cn(
                      "relative inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 transition-transform duration-150",
                      available
                        ? cn("hover:scale-105 hover:border-foreground/30", selected ? "border-transparent" : "border-border")
                        : "cursor-not-allowed pointer-events-none border-border opacity-60",
                      selected && available && "ring-2 ring-offset-2 ring-offset-surface ring-primary"
                    )}
                  />
                }
              >
                <span
                  aria-hidden="true"
                  className="absolute inset-0 rounded-full"
                  style={{ backgroundColor: value.swatchHex ?? "transparent", opacity: available ? 1 : 0.4 }}
                />
                {!available && (
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute left-1/2 top-1/2 h-0.5 w-[141%] -translate-x-1/2 -translate-y-1/2 -rotate-45 bg-danger"
                  />
                )}
              </TooltipTrigger>
              <TooltipContent>
                {value.value} · {value.count} ürün
              </TooltipContent>
            </Tooltip>
          );
        }

        return (
          <button
            key={value.token}
            type="button"
            role="checkbox"
            aria-checked={selected}
            aria-label={label}
            disabled={!available}
            onClick={() => handleToggle(value.token)}
            className={cn(
              "inline-flex items-center gap-1 rounded-[var(--site-radius)] transition-colors duration-150",
              compact ? "h-8 min-w-8 px-2.5 text-xs" : "h-10 min-w-10 px-3 text-sm",
              available
                ? selected
                  ? "border-2 border-primary bg-primary/5 font-semibold text-primary"
                  : "border border-border bg-surface text-foreground hover:border-foreground/40 hover:bg-muted"
                : "cursor-not-allowed border border-border/60 text-foreground/30"
            )}
          >
            {selected && available && <Check className="h-3 w-3" aria-hidden="true" />}
            {value.value}
          </button>
        );
      })}
    </div>
  );
}
