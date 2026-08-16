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
};

export function toPublicProductDto(product: PublicProductRow): PublicProductDto {
  return {
    id: product.id,
    title: product.title,
    slug: product.slug,
    excerpt: product.excerpt,
    descriptionHtml: product.descriptionHtml,
    priceCents: product.priceCents,
    discountPriceCents: product.discountPriceCents,
    currency: product.currency,
    taxRatePercent: product.taxRatePercent !== null && product.taxRatePercent !== undefined ? String(product.taxRatePercent) : null,
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
