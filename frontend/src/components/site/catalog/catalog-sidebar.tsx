"use client";

import { usePathname, useRouter } from "next/navigation";
import type { ProductCatalogFacets } from "@/lib/api/types";
import { Accordion, AccordionItem, AccordionPanel, AccordionTrigger } from "@/components/ui/accordion";
import { CategoryFilterTree } from "@/components/site/catalog/category-filter-tree";
import { PriceRangeFilter } from "@/components/site/catalog/price-range-filter";
import { OptionFacetFilter } from "@/components/site/catalog/option-facet-filter";
import { StockFilterToggle } from "@/components/site/catalog/stock-filter-toggle";
import { buildClearAllHref, hasActiveCatalogFilters, type CatalogFilters } from "@/lib/catalog-search-params";

interface CatalogFilterGroupsProps {
  filters: CatalogFilters;
  facets: ProductCatalogFacets | undefined;
}

/**
 * Filtre içeriği (Stok Durumu + Accordion grupları) — `CatalogSidebar` (masaüstü `<aside>`) VE
 * `CatalogMobileFilters` (mobil `Sheet`) TARAFINDAN paylaşılır. `.claude/design-notes-products-catalog.md`
 * §0: "CatalogSidebar TEK bir bileşendir... İki ayrı 'mobil filtre' bileşeni YAZILMAZ" — bu dosya
 * o paylaşımın somutlaşmasıdır (aynı içerik, iki farklı dış kapsayıcı).
 */
export function CatalogFilterGroups({ filters, facets }: CatalogFilterGroupsProps) {
  const pathname = usePathname();
  const router = useRouter();
  const activeFilterCount = hasActiveCatalogFilters(filters);

  function handleClearAll() {
    router.replace(buildClearAllHref(pathname, filters), { scroll: false });
  }

  const openGroups = ["category", "price", ...(facets?.options.map((axis) => axis.axisSlug) ?? [])];

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-foreground">Filtrele</h2>
        {activeFilterCount && (
          <button type="button" onClick={handleClearAll} className="text-xs font-medium text-foreground/60 hover:text-foreground hover:underline">
            Filtreleri Temizle
          </button>
        )}
      </div>

      <StockFilterToggle filters={filters} />

      <Accordion multiple defaultValue={openGroups} className="mt-2">
        <AccordionItem value="category">
          <AccordionTrigger>Kategori</AccordionTrigger>
          <AccordionPanel className="px-3 pb-3">
            <CategoryFilterTree filters={filters} categories={facets?.categories ?? []} />
          </AccordionPanel>
        </AccordionItem>

        {facets && facets.price.minCents !== null && facets.price.maxCents !== null && (
          <AccordionItem value="price">
            <AccordionTrigger>Fiyat Aralığı</AccordionTrigger>
            <AccordionPanel className="px-3 pb-3">
              <PriceRangeFilter filters={filters} minCents={facets.price.minCents} maxCents={facets.price.maxCents} />
            </AccordionPanel>
          </AccordionItem>
        )}

        {facets?.options.map((axis) => {
          const selectedCount = axis.values.filter((value) => filters.options.includes(value.token)).length;
          return (
            <AccordionItem key={axis.axisSlug} value={axis.axisSlug}>
              <AccordionTrigger>
                <span className="flex-1">{axis.axisName}</span>
                {selectedCount > 0 && <span className="text-xs tabular-nums text-foreground/60">({selectedCount})</span>}
              </AccordionTrigger>
              <AccordionPanel className="px-3 pb-3">
                <OptionFacetFilter filters={filters} axis={axis} />
              </AccordionPanel>
            </AccordionItem>
          );
        })}
      </Accordion>
    </div>
  );
}

interface CatalogSidebarProps {
  filters: CatalogFilters;
  facets: ProductCatalogFacets | undefined;
}

/** `.claude/design-notes-products-catalog.md` §1.1 — masaüstü kapsayıcı, `top-24` galeri ile AYNI sticky ofseti kullanır. */
export function CatalogSidebar({ filters, facets }: CatalogSidebarProps) {
  return (
    <aside className="hidden lg:block lg:w-64 lg:shrink-0 lg:sticky lg:top-24 lg:self-start">
      <CatalogFilterGroups filters={filters} facets={facets} />
    </aside>
  );
}
