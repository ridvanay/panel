import Link from "next/link";
import type { Product } from "@/lib/api/types";
import { formatPriceFromCents } from "@/lib/format-price";
import { withLocalePrefix } from "@/lib/i18n/site-path";
import { FavoriteButton } from "@/components/site/favorite-button";
import { Badge } from "@/components/ui/badge";
import { computeDiscountPercent } from "@/lib/discount";

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
    // `group relative` — favori butonu `Link`'in DIŞINDA (kardeş) konumlanır: bir `<a>` içine
    // interaktif bir `<button>` gömmek geçersiz iç içe etkileşim öğesi üretir (a11y), bu yüzden
    // buton mutlak konumla kartın üstüne bindirilir (design-notes-customer-portal.md §5 —
    // "link'in içine buton koymak a11y açısından sorunludur" ilkesi, favorilerim sayfasındaki
    // AYNI gerekçe).
    <div className="group relative overflow-hidden rounded-lg border border-border">
      <Link href={href} className="block transition-colors hover:bg-surface-muted">
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
          {/* İndirim rozeti AYNI `right-2 top-2` slotunu paylaşır; ürün tükendiyse "Tükendi"
              ÖNCELİKLİDİR ve indirim rozeti gizlenir (indirimli ama satılamayan bir ürünü
              reklam etmek yanıltıcıdır) — bkz. `.claude/design-notes-ecommerce-storefront.md` §3. */}
          {soldOut ? (
            <span className="absolute right-2 top-2 rounded-full bg-danger px-2 py-0.5 text-xs font-medium text-danger-foreground">
              Tükendi
            </span>
          ) : (
            product.discountPriceCents !== null && (
              <span className="absolute right-2 top-2">
                <Badge tone="danger" solid>
                  %{computeDiscountPercent(product.priceCents, product.discountPriceCents)}
                </Badge>
              </span>
            )
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
      <FavoriteButton
        productId={product.id}
        className="absolute left-2 top-2 z-10 bg-surface/90 shadow-sm backdrop-blur-sm hover:bg-surface"
      />
    </div>
  );
}
