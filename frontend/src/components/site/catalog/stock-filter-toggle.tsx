"use client";

import { usePathname, useRouter } from "next/navigation";
import { Switch } from "@/components/ui/switch";
import { buildCatalogHref, type CatalogFilters } from "@/lib/catalog-search-params";

interface StockFilterToggleProps {
  filters: CatalogFilters;
}

/** `.claude/design-notes-products-catalog.md` §1.5 — Accordion DIŞINDA, sidebar'ın en üstünde sabit satır. */
export function StockFilterToggle({ filters }: StockFilterToggleProps) {
  const router = useRouter();
  const pathname = usePathname();

  function handleChange(checked: boolean) {
    const href = buildCatalogHref(pathname, filters, { inStock: checked });
    router.replace(href, { scroll: false });
  }

  return (
    <div className="flex items-center justify-between py-2">
      <span className="text-sm text-foreground">Sadece stoktakiler</span>
      <Switch checked={filters.inStock} onCheckedChange={handleChange} aria-label="Sadece stoktaki ürünleri göster" />
    </div>
  );
}
