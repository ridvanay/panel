"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { ProductCatalogPagination } from "@/lib/api/types";
import { buildCatalogHref, type CatalogFilters } from "@/lib/catalog-search-params";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface CatalogPaginationProps {
  filters: CatalogFilters;
  pagination: ProductCatalogPagination;
}

function getPageWindow(current: number, total: number): (number | "ellipsis")[] {
  if (total <= 7) return Array.from({ length: total }, (_, index) => index + 1);
  const keep = new Set<number>([1, total, current - 1, current, current + 1]);
  const sorted = [...keep].filter((page) => page >= 1 && page <= total).sort((a, b) => a - b);
  const result: (number | "ellipsis")[] = [];
  let previous = 0;
  for (const page of sorted) {
    if (previous && page - previous > 1) result.push("ellipsis");
    result.push(page);
    previous = page;
  }
  return result;
}

/**
 * `.claude/architect-scope-products-catalog.md` §3.1 — offset (`page`/`perPage`) + paylaşılabilir
 * `?page=2`. Architect §5.4 madde 2: sayfa numarası değişince `router.push` (filtrelerin AKSİNE
 * `replace` DEĞİL) + yukarı kaydırma — bu yüzden burada `<Link>` `replace` PROP'U ALMAZ (varsayılan
 * push + scroll davranışı KORUNUR).
 */
export function CatalogPagination({ filters, pagination }: CatalogPaginationProps) {
  const pathname = usePathname();

  if (pagination.totalPages <= 1) return null;

  const pageItems = getPageWindow(pagination.page, pagination.totalPages);

  function hrefFor(page: number): string {
    return buildCatalogHref(pathname, filters, { page });
  }

  return (
    <nav aria-label="Sayfalama" className="mt-8 flex items-center justify-center gap-1">
      <Link
        href={hrefFor(Math.max(1, pagination.page - 1))}
        aria-label="Önceki sayfa"
        aria-disabled={pagination.page <= 1}
        tabIndex={pagination.page <= 1 ? -1 : undefined}
        className={cn(
          buttonVariants({ variant: "outline", size: "icon-sm" }),
          "rounded-[var(--site-radius)]",
          pagination.page <= 1 && "pointer-events-none opacity-50"
        )}
      >
        <ChevronLeft className="h-4 w-4" />
      </Link>
      {pageItems.map((item, index) =>
        item === "ellipsis" ? (
          <span key={`ellipsis-${index}`} className="px-2 text-sm text-foreground/40" aria-hidden="true">
            …
          </span>
        ) : (
          <Link
            key={item}
            href={hrefFor(item)}
            aria-current={item === pagination.page ? "page" : undefined}
            className={cn(
              buttonVariants({ variant: item === pagination.page ? "default" : "outline", size: "icon-sm" }),
              "rounded-[var(--site-radius)] tabular-nums"
            )}
          >
            {item}
          </Link>
        )
      )}
      <Link
        href={hrefFor(Math.min(pagination.totalPages, pagination.page + 1))}
        aria-label="Sonraki sayfa"
        aria-disabled={pagination.page >= pagination.totalPages}
        tabIndex={pagination.page >= pagination.totalPages ? -1 : undefined}
        className={cn(
          buttonVariants({ variant: "outline", size: "icon-sm" }),
          "rounded-[var(--site-radius)]",
          pagination.page >= pagination.totalPages && "pointer-events-none opacity-50"
        )}
      >
        <ChevronRight className="h-4 w-4" />
      </Link>
    </nav>
  );
}
