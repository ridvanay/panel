import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { ProductListItem } from "@/lib/api/types";
import { formatPriceFromCents } from "@/lib/format-price";
import { withLocalePrefix } from "@/lib/i18n/site-path";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { ProductCardMedia, type ProductCardMediaColor } from "@/components/site/product-card-media";
import { FavoriteButton } from "@/components/site/favorite-button";
import { AddToCartButton } from "@/components/site/add-to-cart-button";
import { isBestsellerProduct, isNewProduct } from "@/lib/product-badges";
import { cn } from "@/lib/utils";

interface ProductCardProps {
  product: ProductListItem;
  /** Verilmezse varsayılan dil kabul edilir (öneksiz link — geriye dönük uyumluluk). */
  activeLocaleCode?: string;
  defaultLocaleCode?: string;
  /** Işgara yoğunluğuna göre `next/image` `sizes` — verilmezse ızgara-3 varsayımıyla hesaplanır. */
  sizes?: string;
  /** İlk satırdaki kartlar için LCP önceliği (performance-agent bu turda AYARLAMAZ, varsayılan `false`). */
  priority?: boolean;
  /** `.claude/design-notes-products-catalog.md` §3.5 — liste görünümünde YATAY satır. */
  variant?: "grid" | "list";
}

/** Kartın satılan-seviye stok durumu — [EPT] §1.2 "satılan seviye" kuralı, varyasyonlu üründe ürün-seviyesi `stockQuantity` ASLA kullanılmaz. */
function computeSoldOut(product: ProductListItem): boolean {
  if (product.variants.length > 0) {
    return !product.variants.some((variant) => variant.isActive && variant.stockQuantity > 0);
  }
  return product.stockQuantity === 0;
}

function resolveColors(product: ProductListItem): ProductCardMediaColor[] {
  const colorAxis = product.variantOptions.find((option) => option.type === "SWATCH");
  if (!colorAxis) return [];
  return colorAxis.values.map((value) => {
    const matchingVariant = product.variants.find((variant) => variant.optionValues[colorAxis.name] === value.value);
    return { value: value.value, swatchHex: value.swatchHex, mediaUrl: matchingVariant?.media?.url ?? null };
  });
}

export function ProductCard({ product, activeLocaleCode, defaultLocaleCode, sizes, priority, variant = "grid" }: ProductCardProps) {
  const soldOut = computeSoldOut(product);
  const hasVariants = product.variants.length > 0;
  const href = activeLocaleCode
    ? withLocalePrefix(`/products/${product.slug}`, activeLocaleCode, defaultLocaleCode ?? activeLocaleCode)
    : `/products/${product.slug}`;
  // Fiyat bloğu (üstü çizili + indirimli) YALNIZCA `discountPriceCents` dolu olup olmamasına
  // bakar; rozetteki YÜZDE ise `discountPercent` (denormalize, sunucu türetir) — ikisi ayrı
  // kaygıdır: `discountPercent` 0'a yuvarlanan bir uç durumda bile fiyat üstü çizili gösterilir,
  // yalnızca "%0" gibi anlamsız bir rozet BASILMAZ.
  const hasDiscount = product.discountPriceCents !== null;
  const showDiscountBadge = hasDiscount && product.discountPercent > 0;
  const isNew = isNewProduct(product.publishedAt);
  const isBestseller = isBestsellerProduct(product.salesCount);
  const colors = resolveColors(product);
  const resolvedSizes =
    sizes ?? (variant === "list" ? "128px" : "(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw");

  // §3.2 rozet istif sırası (bağlayıcı): Tükendi TEK BAŞINA > İndirim > Çok Satan > Yeni, en fazla 2.
  const badges = (
    <div className="absolute right-2 top-2 z-10 flex flex-col items-end gap-1">
      {soldOut ? (
        <Badge tone="danger" solid>
          Tükendi
        </Badge>
      ) : (
        <>
          {showDiscountBadge && (
            <Badge tone="danger" solid>
              %{product.discountPercent}
            </Badge>
          )}
          {isBestseller && !(showDiscountBadge && isNew) && <Badge tone="primary">Çok Satan</Badge>}
          {isNew && !(showDiscountBadge && isBestseller) && <Badge tone="neutral">Yeni</Badge>}
        </>
      )}
    </div>
  );

  const priceBlock = (
    <p className="mt-2 text-base font-semibold text-foreground">
      {hasDiscount && product.discountPriceCents !== null ? (
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
  );

  const titleLink = (
    <Link href={href} className="hover:underline">
      <h3 className={cn("font-semibold text-foreground", variant === "list" ? "text-base" : "mt-3 text-lg")}>{product.title}</h3>
    </Link>
  );

  if (variant === "list") {
    return (
      <div className="group flex gap-4 rounded-lg border border-border p-3 transition-colors hover:border-primary/30">
        <ProductCardMedia
          href={href}
          productId={product.id}
          title={product.title}
          coverUrl={product.coverMedia?.url ?? null}
          coverAlt={product.coverMedia?.altText ?? ""}
          secondaryUrl={product.images[0]?.media.url ?? null}
          secondaryAlt={product.images[0]?.media.altText ?? ""}
          badges={badges}
          hasVariants={hasVariants}
          soldOut={soldOut}
          stockQuantity={product.stockQuantity}
          colors={[]}
          sizes={resolvedSizes}
          priority={priority}
          mediaClassName="h-32 w-32 shrink-0 rounded-[var(--site-radius)] sm:h-40 sm:w-40"
          showFavoriteOverlay={false}
          showQuickAddOverlay={false}
        >
          {null}
        </ProductCardMedia>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-start justify-between gap-2">
            {titleLink}
            {/* §3.5 — listede favori görsel üzerinde DEĞİL, başlık satırında (görsel küçük olduğu için üstüne binmez). */}
            <FavoriteButton productId={product.id} className="shrink-0" />
          </div>
          {product.excerpt && <p className="mt-1 line-clamp-2 text-sm text-foreground/60">{product.excerpt}</p>}
          {colors.length > 0 && (
            <div className="mt-1 flex items-center gap-2">
              {colors.slice(0, 5).map((color) => (
                <span
                  key={color.value}
                  aria-hidden="true"
                  className="h-4 w-4 shrink-0 rounded-full border border-border"
                  style={{ backgroundColor: color.swatchHex ?? undefined }}
                />
              ))}
            </div>
          )}
          <div className="mt-auto flex items-end justify-between gap-2 pt-2">
            {priceBlock}
            {!soldOut && (
              <div className="w-40 shrink-0">
                {hasVariants ? (
                  <Link href={href} className={cn(buttonVariants({ variant: "outline", size: "sm" }), "w-full rounded-[var(--site-radius)]")}>
                    Seçenekleri Gör <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                ) : (
                  <AddToCartButton productId={product.id} stockQuantity={product.stockQuantity} size="sm" className="w-full rounded-[var(--site-radius)]" />
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="group relative overflow-hidden rounded-lg border border-border transition-colors hover:border-primary/30">
      <ProductCardMedia
        href={href}
        productId={product.id}
        title={product.title}
        coverUrl={product.coverMedia?.url ?? null}
        coverAlt={product.coverMedia?.altText ?? ""}
        secondaryUrl={product.images[0]?.media.url ?? null}
        secondaryAlt={product.images[0]?.media.altText ?? ""}
        badges={badges}
        hasVariants={hasVariants}
        soldOut={soldOut}
        stockQuantity={product.stockQuantity}
        colors={colors}
        sizes={resolvedSizes}
        priority={priority}
      >
        <div className="px-4">
          {titleLink}
          {product.excerpt && <p className="mt-1 line-clamp-2 text-sm text-foreground/60">{product.excerpt}</p>}
        </div>
      </ProductCardMedia>
      <div className="px-4 pb-4">{priceBlock}</div>
    </div>
  );
}
