"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { Product } from "@/lib/api/types";
import { Badge } from "@/components/ui/badge";
import { AddToCartButton } from "@/components/site/add-to-cart-button";
import { useCartOptional } from "@/context/cart-context";
import { ProductGallery, type ProductGalleryImage } from "@/components/site/product/product-gallery";
import { ProductVariantSelector } from "@/components/site/product/product-variant-selector";
import { StickyAddToCartBar } from "@/components/site/product/sticky-add-to-cart-bar";
import { formatPriceFromCents } from "@/lib/format-price";
import { computeDiscountPercent } from "@/lib/discount";
import { findMatchingVariant, firstMissingAxis, isOptionValueAvailable } from "@/lib/product-variants";

/** `.claude/design-notes-ecommerce-storefront.md` §4 — `0 < stok <= 3`, yalnızca PDP. */
const LOW_STOCK_THRESHOLD = 3;

interface ProductPurchasePanelProps {
  product: Product;
  /** `?variant=<id>` — server'da `searchParams`'tan okunur (Suspense gerektiren `useSearchParams` KULLANILMAZ). */
  initialVariantId: string | null;
}

/**
 * PDP'nin varyasyona bağlı TÜM bölümlerini (galeri, fiyat, düşük stok uyarısı, varyasyon
 * seçici, sepete ekle, sticky bar) tek bir istemci bileşeninde toplar — `templateKey`/
 * `ecommerce-pro` BİLMEZ, storefront'un kalıcı bir yeteneğidir (§5).
 */
export function ProductPurchasePanel({ product, initialVariantId }: ProductPurchasePanelProps) {
  const hasVariants = product.variants.length > 0;
  const router = useRouter();
  const pathname = usePathname();
  const cart = useCartOptional();

  const [selected, setSelected] = useState<Record<string, string>>(() => {
    if (!hasVariants) return {};
    const initial = initialVariantId ? product.variants.find((variant) => variant.id === initialVariantId) : null;
    return initial ? { ...initial.optionValues } : {};
  });

  const selectedVariant = useMemo(
    () => (hasVariants ? findMatchingVariant(product.variants, product.variantOptions, selected) : null),
    [hasVariants, product.variants, product.variantOptions, selected]
  );

  // Durum URL'de tutulur (`?variant=<id>`, paylaşılabilir/derin bağlantı) — yalnızca seçim
  // GERÇEKTEN değiştiğinde `router.replace` çağrılır (ilk mount'ta gereksiz bir navigasyon
  // üretmemek için).
  const lastSyncedIdRef = useRef<string | null>(initialVariantId);
  useEffect(() => {
    if (!hasVariants) return;
    const nextId = selectedVariant?.id ?? null;
    if (nextId === lastSyncedIdRef.current) return;
    lastSyncedIdRef.current = nextId;
    router.replace(nextId ? `${pathname}?variant=${nextId}` : pathname, { scroll: false });
  }, [hasVariants, selectedVariant?.id, pathname, router]);

  function handleSelect(axisName: string, value: string) {
    setSelected((prev) => ({ ...prev, [axisName]: value }));
  }

  const priceCents = hasVariants ? (selectedVariant ? selectedVariant.priceCents ?? product.priceCents : product.priceCents) : product.priceCents;
  const discountPriceCents = hasVariants ? (selectedVariant ? selectedVariant.discountPriceCents : null) : product.discountPriceCents;

  const stockQuantity = hasVariants ? selectedVariant?.stockQuantity ?? null : product.stockQuantity;
  const isSoldOut = hasVariants
    ? selectedVariant !== null && (selectedVariant.stockQuantity <= 0 || !selectedVariant.isActive)
    : product.stockQuantity === 0;
  const showLowStock = stockQuantity !== null && stockQuantity > 0 && stockQuantity <= LOW_STOCK_THRESHOLD;

  const missingAxis = hasVariants ? firstMissingAxis(product.variantOptions, selected) : null;
  const needsSelection = hasVariants && selectedVariant === null;

  const images = useMemo<ProductGalleryImage[]>(() => {
    const list: ProductGalleryImage[] = [];
    if (product.coverMedia) list.push({ url: product.coverMedia.url, alt: product.coverMedia.altText ?? "" });
    for (const image of product.images) list.push({ url: image.media.url, alt: image.media.altText ?? "" });
    return list;
  }, [product.coverMedia, product.images]);

  const galleryBadge = isSoldOut ? (
    <span className="absolute left-4 top-4 z-10 rounded-full bg-danger px-3 py-1 text-sm font-medium text-danger-foreground">
      Tükendi
    </span>
  ) : discountPriceCents !== null ? (
    <span className="absolute left-4 top-4 z-10">
      <Badge tone="danger" solid size="lg">
        %{computeDiscountPercent(priceCents, discountPriceCents)}
      </Badge>
    </span>
  ) : null;

  const purchaseSectionRef = useRef<HTMLDivElement>(null);

  return (
    <div>
      <ProductGallery images={images} highlightUrl={selectedVariant?.media?.url ?? null} badge={galleryBadge} />

      <div ref={purchaseSectionRef} className="mt-6">
        <div className="text-2xl font-semibold text-foreground">
          {discountPriceCents !== null ? (
            <>
              <span className="mr-3 text-base font-normal text-foreground/40 line-through">
                {formatPriceFromCents(priceCents, product.currency)}
              </span>
              {formatPriceFromCents(discountPriceCents, product.currency)}
            </>
          ) : (
            formatPriceFromCents(priceCents, product.currency)
          )}
        </div>

        {showLowStock && (
          <div className="mt-2">
            <Badge tone="warning">Son {stockQuantity} ürün!</Badge>
          </div>
        )}

        {product.excerpt && <p className="mt-2 text-sm text-foreground/60">{product.excerpt}</p>}

        {hasVariants && (
          <div className="mt-4 space-y-4">
            {product.variantOptions.map((axis) => (
              <ProductVariantSelector
                key={axis.name}
                axis={axis}
                selectedValue={selected[axis.name] ?? null}
                isValueAvailable={(value) => isOptionValueAvailable(product.variants, product.variantOptions, selected, axis.name, value)}
                onSelect={(value) => handleSelect(axis.name, value)}
              />
            ))}
          </div>
        )}

        <div className="mt-6">
          <AddToCartButton
            productId={product.id}
            variantId={hasVariants ? selectedVariant?.id ?? null : undefined}
            stockQuantity={stockQuantity ?? 0}
            disabled={needsSelection}
            disabledHint={needsSelection ? (missingAxis ? `Devam etmek için ${missingAxis.name} seçin.` : undefined) : undefined}
            onAdded={() => cart?.openDrawer()}
          />
        </div>
      </div>

      <StickyAddToCartBar
        targetRef={purchaseSectionRef}
        priceCents={priceCents}
        discountPriceCents={discountPriceCents}
        currency={product.currency}
        productId={product.id}
        variantId={hasVariants ? selectedVariant?.id ?? null : undefined}
        stockQuantity={stockQuantity ?? 0}
        needsSelection={needsSelection}
        onAdded={() => cart?.openDrawer()}
      />
    </div>
  );
}
