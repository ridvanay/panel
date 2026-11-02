import type { PublicBlogDetail } from "@/lib/api/types";
import { safeJsonLdString } from "@/lib/page-builder/structured-data";

/** Paket Z1 — yazı yazarı kurum adı (sabit; kişi değil). */
export const BLOG_AUTHOR_NAME = "WM Health Editorial Team";

export interface BlogJsonLdInput {
  post: PublicBlogDetail;
  /** Yazının mutlak, dile özgü adresi. */
  url: string;
  siteUrl: string;
  siteName: string;
  imageUrl?: string | null;
  inLanguage?: string;
}

type JsonObject = Record<string, unknown>;

/**
 * Paket AH — `Article` ve FAQ varsa ayrı `FAQPage`. `MedicalWebPage`, `reviewedBy` ve `Physician`
 * YOKTUR (aracı kuruluş; ziyaretçi tarafında hekim görünmez); yazarlar hiçbir zaman kişi değil kurumdur
 * (`Organization`). Metinler düz metindir (keyTakeaways/faq sunucuda etiketten arındırılmıştır).
 */
export function buildBlogJsonLd(input: BlogJsonLdInput): JsonObject[] {
  const { post, url, siteUrl, siteName } = input;
  const author: JsonObject = { "@type": "Organization", name: BLOG_AUTHOR_NAME, url: siteUrl };
  const publisher: JsonObject = { "@type": "Organization", name: siteName, url: siteUrl };
  const about: JsonObject | undefined = post.specialty ? { "@type": "Thing", name: post.specialty.name } : undefined;
  const common: JsonObject = {
    headline: post.title,
    name: post.title,
    ...(post.excerpt ? { description: post.excerpt } : {}),
    ...(input.imageUrl ? { image: [input.imageUrl] } : {}),
    ...(input.inLanguage ? { inLanguage: input.inLanguage } : {}),
    ...(post.publishedAt ? { datePublished: post.publishedAt } : {}),
    dateModified: post.updatedAt,
    author,
    publisher,
    mainEntityOfPage: url,
  };

  const article: JsonObject = {
    "@context": "https://schema.org",
    "@type": "Article",
    ...common,
    url,
    ...(about ? { about } : {}),
  };

  const out: JsonObject[] = [article];
  if (post.faq.length > 0) {
    out.push({
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: post.faq.map((item) => ({
        "@type": "Question",
        name: item.question,
        acceptedAnswer: { "@type": "Answer", text: item.answer },
      })),
    });
  }
  return out;
}

/** Her nesne ayrı `<script>` olarak basılır; `</` kaçışı `safeJsonLdString` ile. */
export function blogJsonLdStrings(input: BlogJsonLdInput): string[] {
  return buildBlogJsonLd(input).map((item) => safeJsonLdString(item));
}
