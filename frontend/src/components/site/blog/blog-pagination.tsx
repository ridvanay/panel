import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { BlogStrings } from "@/lib/i18n/site-dictionaries/en/blog";
import { fillBlogString } from "@/lib/blog/format";
import { cn } from "@/lib/utils";

/** Geçerli sayfanın çevresindeki numaralar: 1 … n-1 n n+1 … son. */
export function paginationWindow(page: number, pages: number): (number | "gap")[] {
  const set = new Set<number>([1, pages, page - 1, page, page + 1]);
  const sorted = [...set].filter((n) => n >= 1 && n <= pages).sort((a, b) => a - b);
  const out: (number | "gap")[] = [];
  sorted.forEach((n, i) => {
    if (i > 0 && n - sorted[i - 1]! > 1) out.push("gap");
    out.push(n);
  });
  return out;
}

const item =
  "inline-flex h-10 min-w-10 items-center justify-center rounded-md border px-3 text-sm transition-colors duration-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--site-primary)]";

/** Paket Z1 — sayfalama: sayfa numaraları düz bağlantıdır (`/blog/page/2`); 1. sayfa `/blog`'tur. */
export function BlogPagination({ page, pages, t, hrefFor }: { page: number; pages: number; t: BlogStrings; hrefFor: (page: number) => string }) {
  if (pages <= 1) return null;
  return (
    <nav aria-label={t.paginationAria} className="mt-10 flex flex-wrap items-center justify-center gap-2" data-testid="blog-pagination">
      {page > 1 ? (
        <Link href={hrefFor(page - 1)} rel="prev" aria-label={t.previousPage} className={cn(item, "border-border hover:border-[var(--site-primary)]")}>
          <ChevronLeft className="h-4 w-4 rtl:-scale-x-100" aria-hidden="true" />
        </Link>
      ) : null}
      {paginationWindow(page, pages).map((entry, i) =>
        entry === "gap" ? (
          <span key={`gap-${i}`} aria-hidden="true" className="px-1 text-foreground/50">
            …
          </span>
        ) : entry === page ? (
          <span key={entry} aria-current="page" aria-label={fillBlogString(t.pageOf, { n: entry, total: pages })} className={cn(item, "border-[var(--site-primary)] bg-[var(--site-primary)] font-semibold text-white")}>
            {entry}
          </span>
        ) : (
          <Link key={entry} href={hrefFor(entry)} aria-label={fillBlogString(t.pageOf, { n: entry, total: pages })} className={cn(item, "border-border hover:border-[var(--site-primary)]")}>
            {entry}
          </Link>
        )
      )}
      {page < pages ? (
        <Link href={hrefFor(page + 1)} rel="next" aria-label={t.nextPage} className={cn(item, "border-border hover:border-[var(--site-primary)]")}>
          <ChevronRight className="h-4 w-4 rtl:-scale-x-100" aria-hidden="true" />
        </Link>
      ) : null}
    </nav>
  );
}
