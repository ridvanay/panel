import type {
  Page,
  BlogPost,
  BlogCategory,
  Product,
  ProductCategory,
  ProductImage,
  PortfolioItem,
  PortfolioCategory,
  PortfolioImage,
  Media,
  TaxRate,
} from "@prisma/client";
import type {
  PublicBlogPostDto,
  PublicCategoryDto,
  PublicImageDto,
  PublicPageDto,
  PublicPortfolioItemDto,
  PublicProductDto,
} from "../../schemas/entities";
import { absolutizeMediaUrl } from "../../mappers";
import type { TaxRateLite } from "../../lib/tax";

/**
 * §10.13.5 — public API'nin KENDİ DTO mapper'ları. Admin mapper'ları (`mappers/index.ts::
 * toPageDto` vb.) BİLİNÇLİ olarak YENİDEN KULLANILMAZ: onlar `author: UserSummary` döner ve
 * `UserSummary` personel e-posta adresi içerir — üçüncü parti bir entegratöre gönderilemez.
 * Bu dosyadaki HİÇBİR fonksiyon `author`/`authorId`/`seoScore`/`seoScoreIssues`/`deletedAt`/
 * `viewCount`/`translations`/`localizations` alanı DÖNMEZ (katı izin listesi).
 */

export function toPublicCategoryDto(category: BlogCategory | ProductCategory | PortfolioCategory): PublicCategoryDto {
  return { id: category.id, name: category.name, slug: category.slug };
}

export function toPublicPageDto(page: Page): PublicPageDto {
  return {
    id: page.id,
    title: page.title,
    slug: page.slug,
    blocks: (page.blocks as Record<string, unknown>[]) ?? [],
    seoTitle: page.seoTitle,
    seoDescription: page.seoDescription,
    ogTitle: page.ogTitle,
    ogImageUrl: page.ogImageUrl,
    canonicalUrl: page.canonicalUrl,
    noIndex: page.noIndex,
    isLegalDocument: page.isLegalDocument,
    publishedAt: page.publishedAt ? page.publishedAt.toISOString() : null,
    updatedAt: page.updatedAt.toISOString(),
  };
}

type PublicBlogPostRow = BlogPost & { category: BlogCategory | null };

export function toPublicBlogPostDto(post: PublicBlogPostRow): PublicBlogPostDto {
  return {
    id: post.id,
    title: post.title,
    slug: post.slug,
    excerpt: post.excerpt,
    contentHtml: post.contentHtml,
    coverImageUrl: post.coverImageUrl,
    category: post.category ? toPublicCategoryDto(post.category) : null,
    seoTitle: post.seoTitle,
    seoDescription: post.seoDescription,
    ogTitle: post.ogTitle,
    ogImageUrl: post.ogImageUrl,
    canonicalUrl: post.canonicalUrl,
    noIndex: post.noIndex,
    publishedAt: post.publishedAt ? post.publishedAt.toISOString() : null,
    updatedAt: post.updatedAt.toISOString(),
  };
}

function toPublicImageDto(image: { media: Media; order: number }): PublicImageDto {
  return { url: absolutizeMediaUrl(image.media.url), altText: image.media.altText, order: image.order };
}

type PublicProductRow = Product & {
  category: ProductCategory | null;
  coverMedia: Media | null;
  images: (ProductImage & { media: Media })[];
  // Merkezi KDV oranı mimarisi (bkz. lib/tax.ts) — relation OPSİYONELDİR: çağıran taraf
  // `include: { taxRate: true }` ile getirdiyse kullanılır (bkz. products.routes.ts::
  // WITH_RELATIONS, webhook payload'ları BU relation'ı taşır); `/public/products*` (bkz.
  // public-api.routes.ts::PRODUCT_WITH_RELATIONS) henüz taşımıyor — bu durumda `defaultTaxRate`
  // parametresine, o da yoksa ESKİ (deprecated) `taxRatePercent` ham koluna düşülür (regresyon
  // ÖNLEME — relation/parametre sağlanmadan önceki davranışla BİREBİR aynı kalır).
  taxRate?: Pick<TaxRate, "id" | "name" | "ratePercent"> | null;
};

/**
 * `defaultTaxRate` — çağıran taraf `SiteSettings.defaultTaxRateId`nin çözümlenmiş hâlini
 * (bkz. lib/tax.ts::TaxRateLite) verebilir; vermezse (mevcut `/public/products*` uçları) ve
 * `product.taxRate` relation'ı da fetch edilmediyse ham (deprecated) kolona düşülür.
 */
export function toPublicProductDto(product: PublicProductRow, defaultTaxRate: TaxRateLite | null = null): PublicProductDto {
  const resolvedRatePercent = product.taxRate
    ? Number(product.taxRate.ratePercent)
    : product.taxRateId
      ? null // relation fetch edilmedi ama ürünün KENDİ bir oranı VAR — yanlış (varsayılan) oranı sızdırmamak için null.
      : (defaultTaxRate?.ratePercent ??
        (product.taxRatePercent !== null && product.taxRatePercent !== undefined ? Number(product.taxRatePercent) : null));

  return {
    id: product.id,
    title: product.title,
    slug: product.slug,
    excerpt: product.excerpt,
    descriptionHtml: product.descriptionHtml,
    priceCents: product.priceCents,
    discountPriceCents: product.discountPriceCents,
    currency: product.currency,
    taxRatePercent: resolvedRatePercent !== null ? String(resolvedRatePercent) : null,
    sku: product.sku,
    // §10.13.5 bağlayıcı karar — ham `stockQuantity` DÖNMEZ, yalnızca türetilmiş boolean.
    inStock: product.stockQuantity > 0,
    coverImageUrl: product.coverMedia ? absolutizeMediaUrl(product.coverMedia.url) : null,
    images: product.images.map(toPublicImageDto),
    category: product.category ? toPublicCategoryDto(product.category) : null,
    seoTitle: product.seoTitle,
    seoDescription: product.seoDescription,
    ogTitle: product.ogTitle,
    ogImageUrl: product.ogImageUrl,
    canonicalUrl: product.canonicalUrl,
    noIndex: product.noIndex,
    publishedAt: product.publishedAt ? product.publishedAt.toISOString() : null,
    updatedAt: product.updatedAt.toISOString(),
  };
}

type PublicPortfolioItemRow = PortfolioItem & {
  category: PortfolioCategory | null;
  coverMedia: Media | null;
  images: (PortfolioImage & { media: Media })[];
};

export function toPublicPortfolioItemDto(item: PublicPortfolioItemRow): PublicPortfolioItemDto {
  return {
    id: item.id,
    title: item.title,
    slug: item.slug,
    summary: item.summary,
    contentHtml: item.contentHtml,
    clientName: item.clientName,
    projectUrl: item.projectUrl,
    completedAt: item.completedAt ? item.completedAt.toISOString() : null,
    order: item.order,
    coverImageUrl: item.coverMedia ? absolutizeMediaUrl(item.coverMedia.url) : null,
    images: item.images.map(toPublicImageDto),
    category: item.category ? toPublicCategoryDto(item.category) : null,
    seoTitle: item.seoTitle,
    seoDescription: item.seoDescription,
    ogTitle: item.ogTitle,
    ogImageUrl: item.ogImageUrl,
    canonicalUrl: item.canonicalUrl,
    noIndex: item.noIndex,
    publishedAt: item.publishedAt ? item.publishedAt.toISOString() : null,
    updatedAt: item.updatedAt.toISOString(),
  };
}
