import type { BlogPost, Page, PortfolioItem, Product } from "@prisma/client";
import type { SeoScoreIssueDto } from "../schemas/entities";

/**
 * §10.7 İçerik Yönetim Listesi — SEO tamlık skoru. Backend'de HER OKUMADA saf/senkron
 * olarak hesaplanır (persist EDİLMEZ, ekstra DB sorgusu YAPILMAZ). 5 kriter × 20 puan,
 * eşikler ve `code`ların bağlayıcı tanımı: openapi.yaml#/components/schemas/SeoScoreIssue
 * ve ARCHITECTURE.md §10.7.
 */

interface CriterionResult {
  points: number;
  issue?: SeoScoreIssueDto;
}

interface SeoScoreResult {
  score: number;
  issues: SeoScoreIssueDto[];
}

const TITLE_MIN = 50;
const TITLE_MAX = 60;
const DESCRIPTION_MIN = 120;
const DESCRIPTION_MAX = 160;
const PAGE_WORD_THRESHOLD = 100;
const BLOG_POST_WORD_THRESHOLD = 300;
// Ürün açıklamaları blog yazılarından tipik olarak daha kısadır (bkz. §10.9.2) — sayfa eşiğiyle aynı.
const PRODUCT_WORD_THRESHOLD = 100;

function scoreMetaTitle(seoTitle: string | null): CriterionResult {
  const trimmed = seoTitle?.trim() ?? "";
  if (!trimmed) {
    return { points: 0, issue: { code: "SEO_TITLE_MISSING", label: "Meta başlık eksik." } };
  }
  if (trimmed.length < TITLE_MIN || trimmed.length > TITLE_MAX) {
    return {
      points: 10,
      issue: {
        code: "SEO_TITLE_LENGTH",
        label: `Meta başlık ${TITLE_MIN}-${TITLE_MAX} karakter aralığında olmalı (şu an ${trimmed.length}).`,
      },
    };
  }
  return { points: 20 };
}

function scoreMetaDescription(seoDescription: string | null): CriterionResult {
  const trimmed = seoDescription?.trim() ?? "";
  if (!trimmed) {
    return { points: 0, issue: { code: "SEO_DESCRIPTION_MISSING", label: "Meta açıklama eksik." } };
  }
  if (trimmed.length < DESCRIPTION_MIN || trimmed.length > DESCRIPTION_MAX) {
    return {
      points: 10,
      issue: {
        code: "SEO_DESCRIPTION_LENGTH",
        label: `Meta açıklama ${DESCRIPTION_MIN}-${DESCRIPTION_MAX} karakter aralığında olmalı (şu an ${trimmed.length}).`,
      },
    };
  }
  return { points: 20 };
}

function scoreCoverImage(url: string | null | undefined): CriterionResult {
  if (!url || !url.trim()) {
    return { points: 0, issue: { code: "COVER_IMAGE_MISSING", label: "Kapak görseli eksik." } };
  }
  return { points: 20 };
}

function scoreImagesWithAlt(images: { alt: string | null | undefined }[]): CriterionResult {
  if (images.length === 0) {
    return { points: 0, issue: { code: "IMAGE_MISSING", label: "İçerikte görsel yok." } };
  }
  const hasAlt = images.some((image) => Boolean(image.alt?.trim()));
  if (!hasAlt) {
    return { points: 0, issue: { code: "IMAGE_ALT_MISSING", label: "Görsellerde alt metin eksik." } };
  }
  return { points: 20 };
}

function scoreContentLength(wordCount: number, threshold: number): CriterionResult {
  if (wordCount < threshold) {
    return {
      points: 0,
      issue: {
        code: "CONTENT_TOO_SHORT",
        label: `İçerik çok kısa — en az ${threshold} kelime olmalı (şu an ${wordCount}).`,
      },
    };
  }
  return { points: 20 };
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, " ");
}

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function extractImgTags(html: string): string[] {
  return html.match(/<img\b[^>]*>/gi) ?? [];
}

function extractAlt(imgTag: string): string {
  const match = imgTag.match(/alt\s*=\s*"([^"]*)"/i) ?? imgTag.match(/alt\s*=\s*'([^']*)'/i);
  return match ? match[1]! : "";
}

function combineResults(results: CriterionResult[]): SeoScoreResult {
  return {
    score: results.reduce((sum, result) => sum + result.points, 0),
    issues: results.map((result) => result.issue).filter((issue): issue is SeoScoreIssueDto => Boolean(issue)),
  };
}

interface RawBlock {
  type?: unknown;
  data?: Record<string, unknown>;
}

function readBlocks(blocks: unknown): RawBlock[] {
  return Array.isArray(blocks) ? (blocks as RawBlock[]) : [];
}

/**
 * `image`/`gallery` bloklarındaki tüm görselleri (url + alt) toplar — bkz.
 * frontend/src/lib/page-builder/types.ts::ImageBlock|GalleryBlock (backend'de blocks
 * Prisma Json alanı, tip güvenli değil, `Array.isArray`/alan bazlı kontrol edilir).
 */
function collectPageImages(blocks: RawBlock[]): { url: string; alt: string }[] {
  const images: { url: string; alt: string }[] = [];
  for (const block of blocks) {
    const data = block?.data;
    if (!data || typeof data !== "object") continue;

    if (block.type === "image") {
      const url = typeof data.url === "string" ? data.url : "";
      const alt = typeof data.alt === "string" ? data.alt : "";
      if (url) images.push({ url, alt });
    } else if (block.type === "gallery" && Array.isArray((data as { images?: unknown }).images)) {
      for (const item of (data as { images: unknown[] }).images) {
        if (!item || typeof item !== "object") continue;
        const entry = item as Record<string, unknown>;
        const url = typeof entry.url === "string" ? entry.url : "";
        const alt = typeof entry.alt === "string" ? entry.alt : "";
        if (url) images.push({ url, alt });
      }
    }
  }
  return images;
}

function firstImageBlockUrl(blocks: RawBlock[]): string | undefined {
  for (const block of blocks) {
    if (block.type === "image" && typeof block.data?.url === "string" && block.data.url) {
      return block.data.url;
    }
  }
  return undefined;
}

/** Blokların metinsel alanlarının birleşimi — kelime sayımı için basit `.split(/\s+/)` yeterli (tam DOM parse gerekmez). */
function collectPageText(blocks: RawBlock[]): string {
  const parts: string[] = [];
  for (const block of blocks) {
    const data = block?.data;
    if (!data || typeof data !== "object") continue;
    for (const key of ["text", "title", "subtitle", "html", "heading", "subheading", "buttonLabel"]) {
      const value = data[key];
      if (typeof value === "string" && value.trim()) parts.push(stripHtml(value));
    }
  }
  return parts.join(" ");
}

export function computePageSeoScore(page: Pick<Page, "seoTitle" | "seoDescription" | "ogImageUrl" | "blocks">): SeoScoreResult {
  const blocks = readBlocks(page.blocks);
  const images = collectPageImages(blocks);
  const coverImageUrl = page.ogImageUrl?.trim() ? page.ogImageUrl : firstImageBlockUrl(blocks);
  const contentText = collectPageText(blocks);

  return combineResults([
    scoreMetaTitle(page.seoTitle),
    scoreMetaDescription(page.seoDescription),
    scoreCoverImage(coverImageUrl),
    scoreImagesWithAlt(images),
    scoreContentLength(countWords(contentText), PAGE_WORD_THRESHOLD),
  ]);
}

export function computeBlogPostSeoScore(
  post: Pick<BlogPost, "seoTitle" | "seoDescription" | "coverImageUrl" | "ogImageUrl" | "contentHtml">
): SeoScoreResult {
  const coverImageUrl = post.coverImageUrl?.trim() ? post.coverImageUrl : post.ogImageUrl;
  const contentHtml = post.contentHtml ?? "";
  // Kapak görseli bu kriteri KARŞILAMAZ — yalnızca içerik (contentHtml) içindeki <img> etiketleri sayılır.
  const images = extractImgTags(contentHtml).map((tag) => ({ alt: extractAlt(tag) }));
  const contentText = stripHtml(contentHtml);

  return combineResults([
    scoreMetaTitle(post.seoTitle),
    scoreMetaDescription(post.seoDescription),
    scoreCoverImage(coverImageUrl),
    scoreImagesWithAlt(images),
    scoreContentLength(countWords(contentText), BLOG_POST_WORD_THRESHOLD),
  ]);
}

/**
 * §10.9.2 Ürünler Modülü — `computeBlogPostSeoScore` ile AYNI 5 kriter. `Product`'ın kapak
 * görseli `coverImageUrl` KOLONU değil `coverMediaId` İLİŞKİSİ üzerinden gelir (bkz.
 * prisma/schema.prisma::Product) — bu yüzden çözümlenmiş URL çağıran taraftan (mapper,
 * `coverMedia` include'ından) parametre olarak alınır, burada JOIN YAPILMAZ.
 */
export function computeProductSeoScore(
  product: Pick<Product, "seoTitle" | "seoDescription" | "ogImageUrl" | "descriptionHtml"> & {
    coverMediaUrl: string | null;
  }
): SeoScoreResult {
  const coverImageUrl = product.coverMediaUrl?.trim() ? product.coverMediaUrl : product.ogImageUrl;
  const descriptionHtml = product.descriptionHtml ?? "";
  // Kapak görseli bu kriteri KARŞILAMAZ — yalnızca açıklama (descriptionHtml) içindeki <img> etiketleri sayılır.
  const images = extractImgTags(descriptionHtml).map((tag) => ({ alt: extractAlt(tag) }));
  const contentText = stripHtml(descriptionHtml);

  return combineResults([
    scoreMetaTitle(product.seoTitle),
    scoreMetaDescription(product.seoDescription),
    scoreCoverImage(coverImageUrl),
    scoreImagesWithAlt(images),
    scoreContentLength(countWords(contentText), PRODUCT_WORD_THRESHOLD),
  ]);
}

/**
 * §10.9.4 Portföy Modülü — `computeProductSeoScore` ile BİREBİR AYNI patern, yalnızca alan adı
 * `descriptionHtml` yerine `contentHtml`'dir (bkz. prisma/schema.prisma::PortfolioItem).
 */
export function computePortfolioItemSeoScore(
  item: Pick<PortfolioItem, "seoTitle" | "seoDescription" | "ogImageUrl" | "contentHtml"> & {
    coverMediaUrl: string | null;
  }
): SeoScoreResult {
  const coverImageUrl = item.coverMediaUrl?.trim() ? item.coverMediaUrl : item.ogImageUrl;
  const contentHtml = item.contentHtml ?? "";
  // Kapak görseli bu kriteri KARŞILAMAZ — yalnızca içerik (contentHtml) içindeki <img> etiketleri sayılır.
  const images = extractImgTags(contentHtml).map((tag) => ({ alt: extractAlt(tag) }));
  const contentText = stripHtml(contentHtml);

  return combineResults([
    scoreMetaTitle(item.seoTitle),
    scoreMetaDescription(item.seoDescription),
    scoreCoverImage(coverImageUrl),
    scoreImagesWithAlt(images),
    scoreContentLength(countWords(contentText), PRODUCT_WORD_THRESHOLD),
  ]);
}
