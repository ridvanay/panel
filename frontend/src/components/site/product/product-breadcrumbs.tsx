import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { withLocalePrefix } from "@/lib/i18n/site-path";

interface ProductBreadcrumbsProps {
  activeLocaleCode: string;
  defaultLocaleCode: string;
  category: { name: string; slug: string } | null;
  productTitle: string;
}

/**
 * `.claude/design-notes-products-catalog.md` §4.1 — ızgaranın ÜSTÜNDE, tam genişlik. Son kırıntı
 * (ürün adı) `<Link>` DEĞİL, `aria-current="page"` ile işaretli düz metin.
 */
export function ProductBreadcrumbs({ activeLocaleCode, defaultLocaleCode, category, productTitle }: ProductBreadcrumbsProps) {
  const homeHref = withLocalePrefix("/", activeLocaleCode, defaultLocaleCode);
  const productsHref = withLocalePrefix("/products", activeLocaleCode, defaultLocaleCode);
  const categoryHref = category ? withLocalePrefix(`/products?category=${category.slug}`, activeLocaleCode, defaultLocaleCode) : null;

  return (
    <nav aria-label="Breadcrumb" className="mb-4 flex items-center gap-1 text-sm text-foreground/60">
      <Link href={homeHref} className="hover:text-foreground hover:underline">
        Ana Sayfa
      </Link>
      <ChevronRight className="h-3.5 w-3.5 shrink-0 text-foreground/30" aria-hidden="true" />
      <Link href={productsHref} className="hover:text-foreground hover:underline">
        Ürünler
      </Link>
      {category && categoryHref && (
        <>
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-foreground/30" aria-hidden="true" />
          <Link href={categoryHref} className="truncate hover:text-foreground hover:underline">
            {category.name}
          </Link>
        </>
      )}
      <ChevronRight className="h-3.5 w-3.5 shrink-0 text-foreground/30" aria-hidden="true" />
      <span className="truncate font-medium text-foreground" aria-current="page">
        {productTitle}
      </span>
    </nav>
  );
}
