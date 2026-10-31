import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { ReviewsStrings } from "@/lib/i18n/site-dictionaries/en/reviews";
import { fillReview } from "@/lib/review-format";
import { reviewsQueryString, type ReviewsQuery } from "@/lib/review-query";
import { cn } from "@/lib/utils";

const itemClass =
  "inline-flex h-9 min-w-9 items-center justify-center gap-1 rounded-md border border-border px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** İlk/son sayfa ve geçerli sayfanın komşuları. */
function pageWindow(page: number, pages: number): number[] {
  const set = new Set<number>([1, pages]);
  for (let p = Math.max(1, page - 1); p <= Math.min(pages, page + 1); p++) set.add(p);
  return [...set].sort((a, b) => a - b);
}

/**
 * Paket AE — sayfa bağlantıları gerçek `<a href>`'tir (SEO + paylaşılabilir URL); filtreler korunur.
 * Oklar RTL'de döner (`rtl:rotate-180`). Tek sayfa varsa hiçbir şey çizmez.
 */
export function ReviewsPagination({ t, basePath, query, total, pageSize }: { t: ReviewsStrings; basePath: string; query: ReviewsQuery; total: number; pageSize: number }) {
  const pages = Math.max(1, Math.ceil(total / Math.max(1, pageSize)));
  if (pages <= 1) return null;
  const page = Math.min(query.page, pages);
  const href = (p: number) => `${basePath}${reviewsQueryString({ ...query, page: p })}`;
  const numbers = pageWindow(page, pages);

  return (
    <nav aria-label={t.paginationAria} data-testid="reviews-pagination" className="mt-8 flex flex-wrap items-center justify-center gap-2">
      {page > 1 ? (
        <Link href={href(page - 1)} rel="prev" className={cn(itemClass, "hover:bg-muted")}>
          <ChevronLeft className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />
          {t.previousPage}
        </Link>
      ) : (
        <span aria-disabled="true" className={cn(itemClass, "pointer-events-none opacity-50")}>
          <ChevronLeft className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />
          {t.previousPage}
        </span>
      )}
      {numbers.map((p, i) => (
        <span key={p} className="contents">
          {i > 0 && p - numbers[i - 1]! > 1 && (
            <span aria-hidden="true" className="px-1 text-foreground/50">
              …
            </span>
          )}
          {p === page ? (
            <span aria-current="page" className={cn(itemClass, "border-[var(--site-primary)] bg-[var(--site-primary)] font-semibold text-white")}>
              {p}
            </span>
          ) : (
            <Link href={href(p)} aria-label={fillReview(t.pageLinkAria, { page: p })} className={cn(itemClass, "hover:bg-muted")}>
              {p}
            </Link>
          )}
        </span>
      ))}
      {page < pages ? (
        <Link href={href(page + 1)} rel="next" className={cn(itemClass, "hover:bg-muted")}>
          {t.nextPage}
          <ChevronRight className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />
        </Link>
      ) : (
        <span aria-disabled="true" className={cn(itemClass, "pointer-events-none opacity-50")}>
          {t.nextPage}
          <ChevronRight className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />
        </span>
      )}
    </nav>
  );
}
