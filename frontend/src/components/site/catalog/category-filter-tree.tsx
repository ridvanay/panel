"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight } from "lucide-react";
import type { ProductCategoryFacet } from "@/lib/api/types";
import { buildCatalogHref, type CatalogFilters } from "@/lib/catalog-search-params";
import { cn } from "@/lib/utils";

interface CategoryFilterTreeProps {
  filters: CatalogFilters;
  categories: ProductCategoryFacet[];
}

/**
 * `.claude/design-notes-products-catalog.md` §1.2 — TEKLİ seçim (backend `category` parametresi
 * tek slug alır), `role="radio"`/basit link listesi (DNS'teki swatch/beden'in ÇOKLU seçiminden
 * FARKLI semantik). Kök kategori sayacı kendi + tüm çocukları (backend facet zaten bu şekilde
 * toplar) — istemci taraflı toplama YAPILMAZ.
 */
export function CategoryFilterTree({ filters, categories }: CategoryFilterTreeProps) {
  const pathname = usePathname();
  const selectedSlug = filters.category;

  const initialExpanded = useMemo(() => {
    const expanded = new Set<string>();
    for (const root of categories) {
      if (root.children.some((child) => child.slug === selectedSlug)) expanded.add(root.id);
    }
    return expanded;
  }, [categories, selectedSlug]);

  const [expandedIds, setExpandedIds] = useState<Set<string>>(initialExpanded);

  function toggleExpanded(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function hrefFor(slug: string | null): string {
    return buildCatalogHref(pathname, filters, { category: slug });
  }

  return (
    <ul className="space-y-0.5 text-sm">
      <li>
        <Link
          href={hrefFor(null)}
          replace
          scroll={false}
          className={cn(
            "flex items-center justify-between rounded-md px-2 py-1.5 transition-colors",
            !selectedSlug ? "bg-primary/10 font-medium text-primary" : "text-foreground hover:bg-surface-muted"
          )}
        >
          Tümü
        </Link>
      </li>
      {categories.map((root) => {
        const expanded = expandedIds.has(root.id);
        const hasChildren = root.children.length > 0;
        const selected = selectedSlug === root.slug;
        return (
          <li key={root.id}>
            <div className="flex items-center">
              {hasChildren && (
                <button
                  type="button"
                  onClick={() => toggleExpanded(root.id)}
                  aria-label={expanded ? "Alt kategorileri gizle" : "Alt kategorileri göster"}
                  aria-expanded={expanded}
                  className="grid h-6 w-6 shrink-0 place-items-center text-foreground/40 hover:text-foreground"
                >
                  <ChevronRight className={cn("h-3.5 w-3.5 transition-transform", expanded && "rotate-90")} />
                </button>
              )}
              <Link
                href={hrefFor(root.slug)}
                replace
                scroll={false}
                className={cn(
                  "flex flex-1 items-center justify-between rounded-md px-2 py-1.5 text-sm transition-colors",
                  !hasChildren && "ml-6",
                  selected ? "bg-primary/10 font-medium text-primary" : "text-foreground hover:bg-surface-muted"
                )}
              >
                <span className="truncate">{root.name}</span>
                <span className="ml-2 shrink-0 rounded-full bg-surface-muted px-1.5 py-0.5 text-[11px] font-medium text-foreground/60 tabular-nums">
                  {root.productCount}
                </span>
              </Link>
            </div>
            {expanded && hasChildren && (
              <ul className="ml-3 space-y-0.5 border-l border-border/60 pl-3">
                {root.children.map((child) => {
                  const childSelected = selectedSlug === child.slug;
                  return (
                    <li key={child.id}>
                      <Link
                        href={hrefFor(child.slug)}
                        replace
                        scroll={false}
                        className={cn(
                          "flex items-center justify-between rounded-md px-2 py-1.5 text-sm transition-colors",
                          childSelected ? "bg-primary/10 font-medium text-primary" : "text-foreground hover:bg-surface-muted"
                        )}
                      >
                        <span className="truncate">{child.name}</span>
                        <span className="ml-2 shrink-0 rounded-full bg-surface-muted px-1.5 py-0.5 text-[11px] font-medium text-foreground/60 tabular-nums">
                          {child.productCount}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </li>
        );
      })}
    </ul>
  );
}
