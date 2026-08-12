import Link from "next/link";
import type { Product } from "@/lib/api/types";
import { formatPriceFromCents } from "@/lib/format-price";
import { withLocalePrefix } from "@/lib/i18n/site-path";

interface ProductCardProps {
  product: Product;
  /** Verilmezse varsayılan dil kabul edilir (öneksiz link — geriye dönük uyumluluk). */
  activeLocaleCode?: string;
  defaultLocaleCode?: string;
}

export function ProductCard({ product, activeLocaleCode, defaultLocaleCode }: ProductCardProps) {
  const soldOut = product.stockQuantity === 0;
  const href = activeLocaleCode
    ? withLocalePrefix(`/products/${product.slug}`, activeLocaleCode, defaultLocaleCode ?? activeLocaleCode)
    : `/products/${product.slug}`;

  return (
    <Link
      href={href}
      className="block overflow-hidden rounded-lg border border-border transition-colors hover:bg-surface-muted"
    >
      <div className="relative aspect-square w-full bg-surface-muted">
        {product.coverMedia && (
          // eslint-disable-next-line @next/next/no-img-element -- kapak URL'si medya kütüphanesinden gelir, next/image remotePatterns henüz tanımlı değil
          <img
            src={product.coverMedia.url}
            alt={product.coverMedia.altText ?? ""}
            className="h-full w-full object-cover"
            loading="lazy"
          />
        )}
        {soldOut && (
          <span className="absolute right-2 top-2 rounded-full bg-danger px-2 py-0.5 text-xs font-medium text-danger-foreground">
            Tükendi
          </span>
        )}
      </div>
      <div className="p-4">
        <h3 className="text-lg font-semibold text-foreground">{product.title}</h3>
        {product.excerpt && <p className="mt-1 line-clamp-2 text-sm text-foreground/60">{product.excerpt}</p>}
        <p className="mt-2 text-base font-semibold text-foreground">
          {product.discountPriceCents !== null ? (
            <>
              <span className="mr-2 text-sm font-normal text-foreground/40 line-through">
                {formatPriceFromCents(product.priceCents, product.currency)}
              </span>
              {formatPriceFromCents(product.discountPriceCents, product.currency)}
            </>
          ) : (
            formatPriceFromCents(product.priceCents, product.currency)
          )}
        </p>
      </div>
    </Link>
  );
}
