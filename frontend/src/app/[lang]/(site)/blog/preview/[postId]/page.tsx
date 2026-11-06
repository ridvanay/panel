import { cache } from "react";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { fetchBlogPreviewServer } from "@/lib/api/server-blog";
import { fetchLocalesServer } from "@/lib/api/server-locales";
import { fetchSiteSettingsServer } from "@/lib/api/server-settings";
import { getSiteDictionary } from "@/lib/i18n/site-dictionaries";
import { BlogPostView } from "@/components/site/blog/blog-post-page";
import { BlogPreviewTokenBootstrap } from "@/components/site/blog/blog-preview-token-bootstrap";
import { isValidPreviewPostId, previewCookieName } from "@/lib/blog/preview-cookie";

/**
 * Taslak önizleme — `/[lang]/blog/preview/[postId]#t=<belirteç>` (Paket AP; eski `?t=` geçiş süresince). Belirteç
 * `#` parçasında geldiği için sunucuya ulaşmaz: `BlogPreviewTokenBootstrap` onu okuyup adresten siler ve bu yola
 * kapsanan HttpOnly çereze yazdırır; sayfa belirteci çerezden okuyup backend'e `X-Access-Token` başlığıyla iletir.
 * Her istekte SSR (`no-store`); belirteç eksik, geçersiz, süresi dolmuş ya da iptal edilmişse 404 (ayrım
 * sızdırılmaz). Arama motorlarına kapalıdır (noindex/nofollow, canonical ve hreflang YOK); `no-referrer`.
 */
type PageProps = {
  params: Promise<{ lang: string; postId: string }>;
};

const loadPreview = cache(async (postId: string, token: string, lang: string) => fetchBlogPreviewServer(postId, token, lang));

async function readCookieToken(postId: string): Promise<string> {
  if (!isValidPreviewPostId(postId)) return "";
  const store = await cookies();
  return store.get(previewCookieName(postId))?.value.trim() ?? "";
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { lang, postId } = await params;
  const token = await readCookieToken(postId);
  const post = token ? await loadPreview(postId, token, lang) : null;
  return {
    ...(post ? { title: post.seoTitle || post.title } : {}),
    robots: { index: false, follow: false },
    referrer: "no-referrer",
  };
}

export default async function BlogPreviewRoute({ params }: PageProps) {
  const { lang, postId } = await params;
  const token = await readCookieToken(postId);
  const post = token ? await loadPreview(postId, token, lang) : null;
  if (!post) return <BlogPreviewTokenBootstrap postId={postId} hasContent={false} />;
  const [locales, dict, settings] = await Promise.all([fetchLocalesServer(), getSiteDictionary(lang), fetchSiteSettingsServer()]);
  return (
    <>
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
      <BlogPreviewTokenBootstrap postId={postId} hasContent />
    </>
  );
}
