import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { withLocalePrefix } from "@/lib/i18n/site-path";
import { getSiteDictionary } from "@/lib/i18n/site-dictionaries";

interface ProductBreadcrumbsProps {
  activeLocaleCode: string;
  defaultLocaleCode: string;
  category: { name: string; slug: string } | null;
  productTitle: string;
}

/**
 * `.claude/design-notes-products-catalog.md` §4.1 — ızgaranın ÜSTÜNDE, tam genişlik. Son kırıntı
 * (ürün adı) `<Link>` DEĞİL, `aria-current="page"` ile işaretli düz metin.
 *
 * `.claude/architect-scope-i18n.md` §14.5 madde 13 — YALNIZCA "Ana Sayfa" → `common.home`.
 * "Ürünler" (products chrome) BİLİNÇLİ OLARAK Faz 3 kapsamındadır (§14.5 Faz 3 — `(site)/products`
 * chrome'u), burada DOKUNULMAZ.
 */
export async function ProductBreadcrumbs({ activeLocaleCode, defaultLocaleCode, category, productTitle }: ProductBreadcrumbsProps) {
  const homeHref = withLocalePrefix("/", activeLocaleCode, defaultLocaleCode);
  const productsHref = withLocalePrefix("/products", activeLocaleCode, defaultLocaleCode);
  const categoryHref = category ? withLocalePrefix(`/products?category=${category.slug}`, activeLocaleCode, defaultLocaleCode) : null;
  const dict = await getSiteDictionary(activeLocaleCode);

  return (
    <nav aria-label="Breadcrumb" className="mb-4 flex items-center gap-1 text-sm text-foreground/60">
      <Link href={homeHref} className="hover:text-foreground hover:underline">
        {dict.common.home}
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
