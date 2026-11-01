import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { fetchBlogDetailServer } from "@/lib/api/server-blog";
import { fetchLocalesServer } from "@/lib/api/server-locales";
import { fetchSiteSettingsServer } from "@/lib/api/server-settings";
import type { ContentLocalization, PublicBlogDetail } from "@/lib/api/types";
import { getSiteDictionary } from "@/lib/i18n/site-dictionaries";
import { localeDirection } from "@/lib/i18n/locale-direction";
import { withLocalePrefix } from "@/lib/i18n/site-path";
import { redirectToCanonicalSlug } from "@/lib/i18n/canonical-slug";
import { SITE_URL, toPublicMediaUrl } from "@/lib/env";
import { buildContentMetadata } from "@/lib/seo";
import { blogJsonLdStrings } from "@/lib/blog/json-ld";
import { buildToc, splitAtMiddleHeading } from "@/lib/blog/toc";
import { JsonLdScript } from "@/components/site/json-ld-script";
import { SyncLocaleAlternates } from "@/components/site/sync-locale-alternates";
import { ViewTracker } from "@/components/site/view-tracker";
import { RichContentWithShortcodes } from "@/components/site/blocks/rich-content-with-shortcodes";
import { BlogBreadcrumb } from "./blog-breadcrumb";
import { BlogCover } from "./blog-cover";
import { BlogToc } from "./blog-toc";
import { BlogFaq } from "./blog-faq";
import { BlogShareButtons } from "./blog-share-buttons";
import { BlogPostCard } from "./blog-post-card";
import { BlogByline, BlogConsultCard, BlogKeyTakeaways, BlogReferences } from "./blog-article-parts";

type PostPageProps = { lang: string; slug: string };

/** `localizations` (yalnızca çevirisi olan diller) → mevcut hreflang/dil değiştirici sözleşmesi (`translated: true`). */
function toContentLocalizations(post: PublicBlogDetail): ContentLocalization[] {
  return post.localizations.map((l) => ({ locale: l.locale, slug: l.slug, translated: true }));
}

const PROSE_CLASS = [
  "prose max-w-[70ch] text-base leading-relaxed sm:text-[1.0625rem]",
  "[&_h2]:scroll-mt-24 [&_h3]:scroll-mt-24 [&_h2]:font-heading [&_h3]:font-heading",
  "[&_table]:block [&_table]:max-w-full [&_table]:overflow-x-auto",
  "prose-blockquote:rounded-[var(--site-radius)] prose-blockquote:border-s-4 prose-blockquote:border-[var(--site-primary)] prose-blockquote:bg-[var(--site-primary)]/5 prose-blockquote:px-4 prose-blockquote:py-1 prose-blockquote:not-italic",
  "prose-img:rounded-[var(--site-radius)] prose-a:text-[var(--site-primary)]",
].join(" ");

/**
 * Paket Z1 — yazı meta verisi. Taslak / silinmiş / O DİLDE çevirisi olmayan yazıda `{}` döner (sayfa 404 verir).
 * hreflang yalnızca `localizations` (çevirisi olan) dillerden gelir; OG görseli önce JPEG uyumluluk kopyasıdır.
 */
export async function buildBlogPostMetadata({ lang, slug }: PostPageProps): Promise<Metadata> {
  const [post, settings, locales] = await Promise.all([fetchBlogDetailServer(slug, lang), fetchSiteSettingsServer(), fetchLocalesServer()]);
  if (!post) return {};
  const defaultLocale = locales.find((l) => l.isDefault);
  return buildContentMetadata(
    {
      title: post.seoTitle || post.title,
      description: post.seoDescription || post.excerpt,
      ogTitle: post.ogTitle,
      ogImageUrl: toPublicMediaUrl(post.coverCompatUrl) ?? post.ogImageUrl,
      canonicalUrl: post.canonicalUrl,
      noIndex: post.noIndex,
    },
    {
      fallbackCanonicalUrl: `${SITE_URL}${withLocalePrefix(`/blog/${slug}`, lang, defaultLocale?.code ?? lang)}`,
      siteName: settings.siteName,
      type: "article",
      fallbackImageUrl: toPublicMediaUrl(post.coverUrl),
      localizations: toContentLocalizations(post),
      locales,
      activeLocale: lang,
      pathPrefix: "/blog",
    }
  );
}

/** Paket Z1 — `/[lang]/blog/[slug]` gövdesi. */
export async function BlogPostPage({ lang, slug }: PostPageProps) {
  const [post, locales, dict, settings] = await Promise.all([
    fetchBlogDetailServer(slug, lang),
    fetchLocalesServer(),
    getSiteDictionary(lang),
    fetchSiteSettingsServer(),
  ]);
  // Taslak, silinmiş ya da bu dilde çevirisi olmayan yazı: 404 (yeni uç kanonik metne düşmez).
  if (!post) notFound();

  const localizations = toContentLocalizations(post);
  redirectToCanonicalSlug({ requestedSlug: slug, activeLocale: lang, localizations, locales, pathPrefix: "/blog" });

  const t = dict.blog;
  const defaultLocale = locales.find((l) => l.isDefault)?.code ?? lang;
  const localize = (path: string) => withLocalePrefix(path, lang, defaultLocale);
  const physicianHref = (doctorSlug: string) => localize(`/physicians/${doctorSlug}`);
  const url = `${SITE_URL}${localize(`/blog/${slug}`)}`;
  const trackedSlug = post.localizations.find((l) => l.locale === defaultLocale)?.slug ?? slug;

  const jsonLd = blogJsonLdStrings({
    post,
    url,
    siteUrl: SITE_URL,
    siteName: settings.siteName,
    physicianUrl: (doctorSlug) => `${SITE_URL}${physicianHref(doctorSlug)}`,
    imageUrl: toPublicMediaUrl(post.coverCompatUrl ?? post.coverUrl),
    inLanguage: lang,
  });

  const { html, items: tocItems } = buildToc(post.contentHtml);
  const split = splitAtMiddleHeading(html);
  const crumbs = [
    { label: dict.common.home, href: localize("/") },
    { label: t.pageTitle, href: localize("/blog") },
    { label: post.title },
  ];

  return (
    <div dir={localeDirection(lang)} className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-12" data-testid="blog-post">
      <SyncLocaleAlternates kind="blog" items={localizations} />
      <ViewTracker kind="blog" slug={trackedSlug} />
      {jsonLd.map((json, index) => (
        <JsonLdScript key={index} json={json} />
      ))}

      <BlogBreadcrumb ariaLabel={t.breadcrumbAria} items={crumbs} />

      <header className="mt-6 max-w-3xl">
        {post.category ? <p className="text-sm font-medium uppercase tracking-wide text-[var(--site-primary)]">{post.category.name}</p> : null}
        <h1 className="mt-2 font-heading text-3xl font-semibold leading-tight text-foreground sm:text-4xl">{post.title}</h1>
        <BlogByline post={post} t={t} lang={lang} physicianHref={physicianHref} />
      </header>

      <div className="mt-8 grid gap-10 lg:grid-cols-[minmax(0,1fr)_17rem] lg:items-start">
        <article className="min-w-0">
          {post.coverUrl ? <BlogCover src={post.coverUrl} specialtySlug={post.specialty?.slug} sizes="(min-width: 1024px) 70vw, 100vw" priority className="aspect-[16/9] w-full max-w-3xl rounded-[var(--site-radius)]" /> : null}

          <div className="mt-6 max-w-[70ch]">
            <BlogToc variant="mobile" items={tocItems} title={t.tocTitle} ariaLabel={t.tocAria} />
          </div>

          <div className="max-w-[70ch]">
            <BlogKeyTakeaways items={post.keyTakeaways} title={t.keyTakeaways} />
          </div>

          <div className="mt-8">
            {split ? (
              <>
                <RichContentWithShortcodes html={split[0]} className={PROSE_CLASS} locale={lang} />
                <div className="max-w-[70ch]">
                  <BlogConsultCard doctors={post.consultDoctors} t={t} physicianHref={physicianHref} />
                </div>
                <RichContentWithShortcodes html={split[1]} className={PROSE_CLASS} locale={lang} />
              </>
            ) : (
              <RichContentWithShortcodes html={html} className={PROSE_CLASS} locale={lang} />
            )}
          </div>

          <div className="max-w-[70ch]">
            <BlogConsultCard doctors={post.consultDoctors} t={t} physicianHref={physicianHref} className="mt-10" />
            <BlogFaq items={post.faq} title={t.faqTitle} />
            <BlogReferences items={post.references} t={t} lang={lang} />
            <p className="mt-10 rounded-[var(--site-radius)] border border-border bg-surface p-4 text-sm text-foreground/80" data-testid="blog-disclaimer">
              {t.disclaimer}
            </p>
            <BlogShareButtons
              url={url}
              title={post.title}
              labels={{ heading: t.shareTitle, copy: t.shareCopy, copied: t.shareCopied, whatsapp: t.shareWhatsapp, email: t.shareEmail }}
            />
          </div>
        </article>

        <aside className="hidden lg:sticky lg:top-24 lg:block lg:self-start">
          <BlogToc variant="sidebar" items={tocItems} title={t.tocTitle} ariaLabel={t.tocAria} />
        </aside>
      </div>

      {post.relatedPosts.length > 0 ? (
        <section aria-labelledby="blog-related" className="mt-16" data-testid="blog-related">
          <h2 id="blog-related" className="font-heading text-2xl font-semibold text-foreground">
            {t.relatedTitle}
          </h2>
          <div className="mt-4 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {post.relatedPosts.map((related) => (
              <BlogPostCard key={related.id} post={related} href={localize(`/blog/${related.slug}`)} t={t} lang={lang} />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
