import Link from "next/link";
import { ChevronRight } from "lucide-react";

export interface BlogCrumb {
  label: string;
  /** Verilmezse son kırıntı (`aria-current="page"` düz metin). */
  href?: string;
}

/** Paket Z1 — blog liste ve yazı sayfaları için kırıntı yolu (ürün kırıntısıyla aynı görünüm; RTL'de ok yansıtılır). */
export function BlogBreadcrumb({ items, ariaLabel }: { items: BlogCrumb[]; ariaLabel: string }) {
  return (
    <nav aria-label={ariaLabel} data-testid="blog-breadcrumb">
      <ol className="flex flex-wrap items-center gap-1 text-sm text-foreground/70">
        {items.map((item, index) => (
          <li key={`${item.label}-${index}`} className="flex min-w-0 items-center gap-1">
            {index > 0 ? <ChevronRight className="h-3.5 w-3.5 shrink-0 text-foreground/30 rtl:-scale-x-100" aria-hidden="true" /> : null}
            {item.href ? (
              <Link href={item.href} className="hover:text-foreground hover:underline">
                {item.label}
              </Link>
            ) : (
              <span className="truncate font-medium text-foreground" aria-current="page">
                {item.label}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
