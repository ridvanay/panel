import type { Product } from "@/lib/api/types";
import { safeJsonLdString } from "@/lib/page-builder/structured-data";
import { withLocalePrefix } from "@/lib/i18n/site-path";
import { SITE_URL } from "@/lib/env";

/**
 * PDP `schema.org/Product` + `BreadcrumbList` JSON-LD üreticileri.
 * `.claude/architect-scope-products-catalog.md` §5.6 — mevcut `JsonLdScript` bileşeni ve
 * `lib/page-builder/structured-data.ts::safeJsonLdString` kaçışlaması AYNEN kullanılır (ikinci
 * bir escape mantığı YAZILMAZ). Çağıran taraf (`[slug]/page.tsx`) `product.noIndex` iken bu
 * fonksiyonların çıktısını HİÇ render etmez — sorumluluk `lib/page-builder/structured-data.ts`
 * üst yorumundaki "Boşluk 2" deseniyle AYNI (TEK kaynak çağıran sayfada).
 *
 * Uydurma veri YASAK: `aggregateRating`/review şeması, DB'de karşılığı olmadığı için hiç
 * eklenmez (mimar §"Kurallar" madde 2). Varyasyon fiyatları ürün-seviyesi `priceCents`'i miras
 * alır (`variant.priceCents ?? product.priceCents`) — `product-purchase-panel.tsx`'teki AYNI
 * türetme, ikinci bir fiyat hesap mantığı YOK.
 */

function centsToAmount(cents: number): string {
  return (cents / 100).toFixed(2);
}

function availabilitySchema(inStock: boolean): string {
  return inStock ? "https://schema.org/InStock" : "https://schema.org/OutOfStock";
}

/**
 * Varyasyonlu üründe [EPT] §1.2 "satılan seviye" kuralı: ürün-seviyesi `stockQuantity`/`priceCents`
 * YOK SAYILIR, yalnızca `isActive` varyasyonlar Offer'a girer (`product-card.tsx::isOutOfStock`
 * ile AYNI filtre). Satılabilir hiçbir aktif varyasyon yoksa (`activeVariants.length === 0`)
 * `offers` üretilemez — uydurma bir fiyat/stok göstermek yerine JSON-LD `null` döner.
 */
export function buildProductJsonLd(product: Product, canonicalUrl: string): string | null {
  const images =
    product.images.length > 0
      ? product.images.map((image) => image.media.url)
      : product.coverMedia
        ? [product.coverMedia.url]
        : [];

  const base = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.title,
    description: product.excerpt ?? undefined,
    image: images.length > 0 ? images : undefined,
    sku: product.sku ?? undefined,
    url: canonicalUrl,
    ...(product.category ? { category: product.category.name } : {}),
  };

  const hasVariants = product.variants.length > 0;

  if (hasVariants) {
    const activeVariants = product.variants.filter((variant) => variant.isActive);
    if (activeVariants.length === 0) return null;

    const effectivePrices = activeVariants.map((variant) => {
      const price = variant.priceCents ?? product.priceCents;
      return variant.discountPriceCents ?? price;
    });
    const anyInStock = activeVariants.some((variant) => variant.stockQuantity > 0);

    return safeJsonLdString({
      ...base,
      offers: {
        "@type": "AggregateOffer",
        priceCurrency: product.currency,
        lowPrice: centsToAmount(Math.min(...effectivePrices)),
        highPrice: centsToAmount(Math.max(...effectivePrices)),
        offerCount: activeVariants.length,
        availability: availabilitySchema(anyInStock),
        url: canonicalUrl,
      },
    });
  }

  const effectivePrice = product.discountPriceCents ?? product.priceCents;
  return safeJsonLdString({
    ...base,
    offers: {
      "@type": "Offer",
      priceCurrency: product.currency,
      price: centsToAmount(effectivePrice),
      availability: availabilitySchema(product.stockQuantity > 0),
      url: canonicalUrl,
    },
  });
}

interface ProductBreadcrumbJsonLdParams {
  activeLocaleCode: string;
  defaultLocaleCode: string;
  category: { name: string; slug: string } | null;
  productTitle: string;
  productUrl: string;
}

/** `product-breadcrumbs.tsx`'in render ettiği kırıntı zinciriyle BİREBİR aynı sıra/etiket. */
export function buildProductBreadcrumbJsonLd(params: ProductBreadcrumbJsonLdParams): string {
  const { activeLocaleCode, defaultLocaleCode, category, productTitle, productUrl } = params;
  const homeHref = `${SITE_URL}${withLocalePrefix("/", activeLocaleCode, defaultLocaleCode)}`;
  const productsHref = `${SITE_URL}${withLocalePrefix("/products", activeLocaleCode, defaultLocaleCode)}`;

  const items: { name: string; item: string }[] = [
    { name: "Ana Sayfa", item: homeHref },
    { name: "Ürünler", item: productsHref },
  ];
  if (category) {
    items.push({ name: category.name, item: `${productsHref}?category=${category.slug}` });
  }
  items.push({ name: productTitle, item: productUrl });

  return safeJsonLdString({
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((entry, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: entry.name,
      item: entry.item,
    })),
  });
}
