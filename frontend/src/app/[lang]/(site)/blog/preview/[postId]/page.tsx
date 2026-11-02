import { cache } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { fetchBlogPreviewServer } from "@/lib/api/server-blog";
import { fetchLocalesServer } from "@/lib/api/server-locales";
import { fetchSiteSettingsServer } from "@/lib/api/server-settings";
import { getSiteDictionary } from "@/lib/i18n/site-dictionaries";
import { BlogPostView } from "@/components/site/blog/blog-post-page";

/**
 * Taslak önizleme — `/[lang]/blog/preview/[postId]?t=<belirteç>`. Her istekte SSR (`no-store`); belirteç eksik,
 * geçersiz, süresi dolmuş ya da iptal edilmişse 404 (ayrım sızdırılmaz). Arama motorlarına kapalıdır
 * (noindex/nofollow, canonical ve hreflang YOK); belirteç `Referer` ile sızmasın diye `no-referrer`.
 */
type PageProps = {
  params: Promise<{ lang: string; postId: string }>;
  searchParams: Promise<{ t?: string | string[] }>;
};

const loadPreview = cache(async (postId: string, token: string, lang: string) => fetchBlogPreviewServer(postId, token, lang));

function readToken(raw: string | string[] | undefined): string {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === "string" ? value.trim() : "";
}

export async function generateMetadata({ params, searchParams }: PageProps): Promise<Metadata> {
  const [{ lang, postId }, query] = await Promise.all([params, searchParams]);
  const token = readToken(query.t);
  const post = token ? await loadPreview(postId, token, lang) : null;
  return {
    ...(post ? { title: post.seoTitle || post.title } : {}),
    robots: { index: false, follow: false },
    referrer: "no-referrer",
  };
}

export default async function BlogPreviewRoute({ params, searchParams }: PageProps) {
  const [{ lang, postId }, query] = await Promise.all([params, searchParams]);
  const token = readToken(query.t);
  if (!token) notFound();
  const [post, locales, dict, settings] = await Promise.all([loadPreview(postId, token, lang), fetchLocalesServer(), getSiteDictionary(lang), fetchSiteSettingsServer()]);
  if (!post) notFound();
  return (
    <BlogPostView
      post={post}
      lang={lang}
      slug={post.slug}
      locales={locales}
      dict={dict}
      siteName={settings.siteName}
      certificateNo={settings.healthTourismCertificateNo}
      preview={{ pendingReviewer: post.pendingReviewer ?? null, reviewApproved: post.reviewApproved === true, status: post.status }}
    />
  );
}
