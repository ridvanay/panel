import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { fetchBlogPostBySlugServer } from "@/lib/api/server-blog";
import { fetchSiteSettingsServer } from "@/lib/api/server-settings";
import { fetchLocalesServer } from "@/lib/api/server-locales";
import { ViewTracker } from "@/components/site/view-tracker";
import { ViewCount } from "@/components/site/view-count";
import { SyncLocaleAlternates } from "@/components/site/sync-locale-alternates";
import { redirectToCanonicalSlug } from "@/lib/i18n/canonical-slug";
import { buildContentMetadata } from "@/lib/seo";
import { SITE_URL } from "@/lib/env";

type PageProps = { params: Promise<{ lang: string; slug: string }> };

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { lang, slug } = await params;
  const [post, settings, locales] = await Promise.all([
    fetchBlogPostBySlugServer(slug, lang),
    fetchSiteSettingsServer(),
    fetchLocalesServer(),
  ]);
  if (!post) return {};

  const defaultLocale = locales.find((l) => l.isDefault);

  return buildContentMetadata(
    {
      title: post.title,
      description: post.excerpt,
      ogTitle: post.ogTitle,
      ogImageUrl: post.ogImageUrl,
      canonicalUrl: post.canonicalUrl,
      noIndex: post.noIndex,
    },
    {
      fallbackCanonicalUrl: `${SITE_URL}${lang === defaultLocale?.code ? "" : `/${lang}`}/blog/${slug}`,
      siteName: settings.siteName,
      type: "article",
      fallbackImageUrl: post.coverImageUrl,
      localizations: post.localizations,
      locales,
      activeLocale: lang,
      pathPrefix: "/blog",
    },
  );
}

export default async function BlogPostPage({ params }: PageProps) {
  const { lang, slug } = await params;
  const [post, locales] = await Promise.all([fetchBlogPostBySlugServer(slug, lang), fetchLocalesServer()]);
  if (!post) notFound();

  // §12.2 — duplicate content önleme, bkz. `[slug]/page.tsx` AYNI mantık.
  redirectToCanonicalSlug({
    requestedSlug: slug,
    activeLocale: lang,
    localizations: post.localizations,
    locales,
    pathPrefix: "/blog",
  });

  return (
    <article className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <SyncLocaleAlternates kind="blog" items={post.localizations} />
      <ViewTracker kind="blog" slug={slug} />
      {post.category && <p className="text-sm font-medium text-primary">{post.category.name}</p>}
      <h1 className="mt-1 text-3xl font-semibold text-foreground">{post.title}</h1>
      <div className="mt-2">
        <ViewCount count={post.viewCount} />
      </div>
      {post.coverImageUrl && (
        // eslint-disable-next-line @next/next/no-img-element -- kapak URL'si medya kütüphanesinden gelecek, next/image remotePatterns henüz tanımlı değil
        <img src={post.coverImageUrl} alt="" className="mt-6 w-full rounded-lg object-cover" />
      )}
      <div className="prose mt-6 max-w-none" dangerouslySetInnerHTML={{ __html: post.contentHtml }} />
    </article>
  );
}
