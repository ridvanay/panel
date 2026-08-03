import type { Metadata } from "next";

/**
 * `SitePage`/`BlogPost` içerik türlerinin ortak SEO alanlarından `generateMetadata`
 * çıktısı üretir. Sadece (site) route grubundaki içerik detay sayfaları kullanır
 * (bkz. `[slug]/page.tsx`, `blog/[slug]/page.tsx`, kök `page.tsx`).
 */
export interface SeoContentFields {
  /** Zaten çözümlenmiş, gösterilecek başlık (örn. `page.seoTitle || page.title`). */
  title: string;
  /** Meta açıklaması — `null`/boşsa `description` alanı hiç set edilmez. */
  description: string | null;
  ogTitle: string | null;
  ogImageUrl: string | null;
  canonicalUrl: string | null;
  noIndex: boolean;
}

export interface BuildContentMetadataOptions {
  /** `canonicalUrl` boşsa kullanılacak mutlak URL (bkz. `sitemap.ts`'teki ana sayfa istisnası). */
  fallbackCanonicalUrl: string;
  /** Ayarlar'daki genel site adı — `openGraph.siteName` için kullanılır. */
  siteName: string;
  type?: "website" | "article";
  /** `ogImageUrl` boşsa kullanılacak ek görsel (örn. blog kapak görseli). */
  fallbackImageUrl?: string | null;
}

export function buildContentMetadata(fields: SeoContentFields, options: BuildContentMetadataOptions): Metadata {
  const description = fields.description ?? undefined;
  const ogTitle = fields.ogTitle || fields.title;
  const imageUrl = fields.ogImageUrl || options.fallbackImageUrl || null;
  const images = imageUrl ? [imageUrl] : undefined;
  const canonical = fields.canonicalUrl || options.fallbackCanonicalUrl;

  const metadata: Metadata = {
    title: fields.title,
    description,
    alternates: { canonical },
    openGraph: {
      title: ogTitle,
      description,
      type: options.type ?? "website",
      siteName: options.siteName,
      images,
    },
    twitter: {
      card: images ? "summary_large_image" : "summary",
      title: ogTitle,
      description,
      images,
    },
  };

  if (fields.noIndex) {
    metadata.robots = { index: false, follow: false };
  }

  return metadata;
}
