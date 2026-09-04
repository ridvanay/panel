"use client";

import { usePathname, useRouter } from "next/navigation";
import { X } from "lucide-react";
import type { ProductCatalogFacets, ProductCategoryFacet } from "@/lib/api/types";
import { formatPriceFromCents } from "@/lib/format-price";
import { buildCatalogHref, buildClearAllHref, hasActiveCatalogFilters, type CatalogFilters } from "@/lib/catalog-search-params";

interface ActiveFilterChipsProps {
  filters: CatalogFilters;
  facets: ProductCatalogFacets | undefined;
}

interface Chip {
  key: string;
  label: string;
  onRemove: () => void;
}

function findCategoryLabel(categories: ProductCategoryFacet[], slug: string): string {
  for (const root of categories) {
    if (root.slug === slug) return root.name;
    const child = root.children.find((c) => c.slug === slug);
    if (child) return child.name;
  }
  return slug;
}

/**
 * `.claude/design-notes-products-catalog.md` §1.6 — sidebar'da DEĞİL, toolbar'ın hemen altında.
 * Çip granülerliği: her seçili DEĞER kendi çipini alır, TEK istisna fiyat aralığı (birleşik çip).
 */
export function ActiveFilterChips({ filters, facets }: ActiveFilterChipsProps) {
  const router = useRouter();
  const pathname = usePathname();

  if (!hasActiveCatalogFilters(filters)) return null;

  function go(updates: Partial<CatalogFilters>) {
    router.replace(buildCatalogHref(pathname, filters, updates), { scroll: false });
  }

  const chips: Chip[] = [];

  if (filters.category) {
    const label = facets ? findCategoryLabel(facets.categories, filters.category) : filters.category;
    chips.push({ key: "category", label, onRemove: () => go({ category: null }) });
  }

  if (filters.minPrice !== null || filters.maxPrice !== null) {
    // Filtre aralığı ürün bağımsızdır (henüz bir ürün seçilmedi) — mağazanın TEK para birimi
    // olduğu varsayımı `formatPriceFromCents`'in `tr-TR` locale varsayımıyla AYNI ölçekte.
    const currency = "TRY";
    const minLabel = filters.minPrice !== null ? formatPriceFromCents(filters.minPrice, currency) : "";
    const maxLabel = filters.maxPrice !== null ? formatPriceFromCents(filters.maxPrice, currency) : "";
    const label = filters.minPrice !== null && filters.maxPrice !== null ? `${minLabel} – ${maxLabel}` : minLabel || maxLabel;
    chips.push({ key: "price", label, onRemove: () => go({ minPrice: null, maxPrice: null }) });
  }

  for (const token of filters.options) {
    const [axisSlug] = token.split(":");
    const axis = facets?.options.find((option) => option.axisSlug === axisSlug);
    const value = axis?.values.find((v) => v.token === token);
    const label = axis && value ? `${axis.axisName}: ${value.value}` : token;
    chips.push({
      key: `option-${token}`,
      label,
      onRemove: () => go({ options: filters.options.filter((t) => t !== token) }),
    });
  }

  if (filters.inStock) {
    chips.push({ key: "inStock", label: "Sadece stoktakiler", onRemove: () => go({ inStock: false }) });
  }

  if (filters.search) {
    chips.push({ key: "search", label: `"${filters.search}"`, onRemove: () => go({ search: "" }) });
  }

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border/60 pb-4">
      {chips.map((chip) => (
        <span
          key={chip.key}
          className="inline-flex items-center gap-1 rounded-full bg-primary/10 py-1 pl-3 pr-1.5 text-xs font-medium text-primary"
        >
          {chip.label}
          <button
            type="button"
            aria-label={`${chip.label} filtresini kaldır`}
            onClick={chip.onRemove}
            className="grid h-4 w-4 place-items-center rounded-full text-primary/70 hover:bg-primary/20 hover:text-primary"
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
      <button
        type="button"
        onClick={() => router.replace(buildClearAllHref(pathname, filters), { scroll: false })}
        className="ml-auto text-xs font-medium text-foreground/60 hover:text-foreground hover:underline"
      >
        Filtreleri Temizle
      </button>
    </div>
  );
}
