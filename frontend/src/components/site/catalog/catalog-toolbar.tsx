"use client";

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Grid2x2, Grid3x3, List, Search, X, type LucideIcon } from "lucide-react";
import type { ProductCatalogFacets } from "@/lib/api/types";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { Select } from "@/components/ui/select";
import { CatalogMobileFilters } from "@/components/site/catalog/catalog-mobile-filters";
import { buildCatalogHref, CATALOG_SORT_VALUES, type CatalogFilters, type CatalogSort, type CatalogView } from "@/lib/catalog-search-params";
import { cn } from "@/lib/utils";

const SORT_LABELS: Record<CatalogSort, string> = {
  newest: "En Yeniler",
  price_asc: "Fiyat: Artan",
  price_desc: "Fiyat: Azalan",
  bestselling: "Çok Satanlar",
  discount: "İndirim Oranı",
};

interface CatalogToolbarProps {
  filters: CatalogFilters;
  total: number;
  facets: ProductCatalogFacets | undefined;
}

/**
 * `.claude/design-notes-products-catalog.md` §2 — arama · sonuç sayısı · sırala ·
 * ızgara3/ızgara4/liste · mobilde "Filtrele". Arama girişi 300ms debounce; boş dizeye inince
 * parametre URL'den SİLİNİR (architect §5.4 madde 3).
 */
export function CatalogToolbar({ filters, total, facets }: CatalogToolbarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [searchText, setSearchText] = useState(filters.search);
  const committedRef = useRef(filters.search);

  // URL (sunucudan gelen prop) değişince yerel taslağı senkronize eder — ör. "Filtreleri Temizle".
  useEffect(() => {
    // Prop (sunucudan gelen URL durumu) değişince yerel taslağı EZER — `product-gallery.tsx`'in
    // `highlightUrl` senkronizasyonuyla AYNI onaylı istisna (render sırasında türetilemez, kullanıcı
    // kendi tuş vuruşlarıyla `searchText`'i bağımsız değiştirebilir).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSearchText(filters.search);
    committedRef.current = filters.search;
  }, [filters.search]);

  useEffect(() => {
    if (searchText === committedRef.current) return;
    const timer = setTimeout(() => {
      committedRef.current = searchText;
      router.replace(buildCatalogHref(pathname, filters, { search: searchText }), { scroll: false });
    }, 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchText]);

  function handleClearSearch() {
    setSearchText("");
    committedRef.current = "";
    router.replace(buildCatalogHref(pathname, filters, { search: "" }), { scroll: false });
  }

  function handleSortChange(event: ChangeEvent<HTMLSelectElement>) {
    router.replace(buildCatalogHref(pathname, filters, { sort: event.target.value as CatalogSort }), { scroll: false });
  }

  function handleViewChange(view: CatalogView) {
    // Görünüm değişimi bir "filtre" DEĞİL — sayfa numarasını SIFIRLAMAZ (architect §5.4 madde 2).
    router.replace(buildCatalogHref(pathname, filters, { view }, { resetPage: false }), { scroll: false });
  }

  return (
    <div className="flex flex-col gap-3 border-b border-border pb-4 sm:flex-row sm:items-center sm:justify-between">
      <InputGroup className="rounded-[var(--site-radius)] sm:w-72">
        <InputGroupAddon>
          <Search className="h-4 w-4" />
        </InputGroupAddon>
        <InputGroupInput placeholder="Ürün ara…" value={searchText} onChange={(event) => setSearchText(event.target.value)} aria-label="Ürün ara" />
        {searchText && (
          <InputGroupAddon align="inline-end">
            <InputGroupButton aria-label="Aramayı temizle" onClick={handleClearSearch}>
              <X />
            </InputGroupButton>
          </InputGroupAddon>
        )}
      </InputGroup>

      <div className="flex items-center gap-3">
        <span className="hidden text-sm text-foreground/60 sm:inline">{total} ürün</span>
        <Select className="w-44 rounded-[var(--site-radius)]" value={filters.sort} onChange={handleSortChange} aria-label="Sırala">
          {CATALOG_SORT_VALUES.map((value) => (
            <option key={value} value={value}>
              {SORT_LABELS[value]}
            </option>
          ))}
        </Select>
        <div className="inline-flex items-center rounded-[var(--site-radius)] border border-border p-0.5">
          <ViewToggleButton icon={Grid2x2} active={filters.view === "grid3"} label="3 sütun ızgara" onClick={() => handleViewChange("grid3")} />
          <ViewToggleButton icon={Grid3x3} active={filters.view === "grid4"} label="4 sütun ızgara" onClick={() => handleViewChange("grid4")} />
          <ViewToggleButton icon={List} active={filters.view === "list"} label="Liste görünümü" onClick={() => handleViewChange("list")} />
        </div>
        <CatalogMobileFilters filters={filters} facets={facets} total={total} />
      </div>
    </div>
  );
}

function ViewToggleButton({ icon: Icon, active, label, onClick }: { icon: LucideIcon; active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "grid size-8 place-items-center rounded-[calc(var(--site-radius)-2px)] transition-colors",
        active ? "bg-primary/10 text-primary" : "text-foreground/50 hover:bg-muted hover:text-foreground"
      )}
    >
      <Icon className="h-4 w-4" aria-hidden="true" />
    </button>
  );
}
