"use client";

import { usePathname, useRouter } from "next/navigation";
import { SlidersHorizontal } from "lucide-react";
import type { ProductCatalogFacets } from "@/lib/api/types";
import { Sheet, SheetClose, SheetContent, SheetFooter, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CatalogFilterGroups } from "@/components/site/catalog/catalog-sidebar";
import { buildClearAllHref, hasActiveCatalogFilters, type CatalogFilters } from "@/lib/catalog-search-params";

interface CatalogMobileFiltersProps {
  filters: CatalogFilters;
  facets: ProductCatalogFacets | undefined;
  total: number;
}

/**
 * `.claude/design-notes-products-catalog.md` §1.7 — bottom sheet (drawer DEĞİL, sepet
 * çekmecesiyle görsel olarak karışmasın diye bilinçli ayrım). "Uygula" adımı/ara tampon state
 * YOK — URL zaten anlık uygulanıyor, alt çubuktaki buton yalnızca sheet'i KAPATIR.
 */
export function CatalogMobileFilters({ filters, facets, total }: CatalogMobileFiltersProps) {
  const router = useRouter();
  const pathname = usePathname();
  const activeCount =
    (filters.category ? 1 : 0) +
    (filters.minPrice !== null || filters.maxPrice !== null ? 1 : 0) +
    filters.options.length +
    (filters.inStock ? 1 : 0) +
    (filters.search ? 1 : 0);

  return (
    <Sheet>
      <SheetTrigger
        render={<Button variant="outline" className="rounded-[var(--site-radius)] lg:hidden" />}
      >
        <SlidersHorizontal className="h-4 w-4" />
        Filtrele
        {activeCount > 0 && (
          <Badge tone="primary" size="sm">
            {activeCount}
          </Badge>
        )}
      </SheetTrigger>
      <SheetContent side="bottom" className="h-[85vh] rounded-t-[var(--site-radius)]">
        <SheetHeader>
          <SheetTitle>Filtrele</SheetTitle>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto px-4">
          <CatalogFilterGroups filters={filters} facets={facets} />
        </div>
        <SheetFooter className="flex-row gap-2 border-t border-border">
          <Button
            variant="ghost"
            className="flex-1"
            disabled={!hasActiveCatalogFilters(filters)}
            onClick={() => router.replace(buildClearAllHref(pathname, filters), { scroll: false })}
          >
            Filtreleri Temizle
          </Button>
          <SheetClose render={<Button className="flex-1 rounded-[var(--site-radius)]" />}>{total > 0 ? `${total} Ürünü Gör` : "Sonuçları Gör"}</SheetClose>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
