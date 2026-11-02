import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { fetchBlogDetailServer } from "@/lib/api/server-blog";
import { fetchLocalesServer } from "@/lib/api/server-locales";
import { fetchSiteSettingsServer } from "@/lib/api/server-settings";
import type { ContentLocalization, Locale, PublicBlogDetail, PublicBlogPreviewDetail } from "@/lib/api/types";
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
import { BlogSpecialtyChip } from "./blog-specialty-chip";
import { BlogToc } from "./blog-toc";
import { BlogFaq } from "./blog-faq";
import { BlogShareButtons } from "./blog-share-buttons";
import { BlogPostCard } from "./blog-post-card";
import { BlogAuthorBox, BlogByline, BlogConsultCard, BlogKeyTakeaways, BlogPreviewBanner, BlogReferences } from "./blog-article-parts";
import { BlogReadingProgress } from "./blog-reading-progress";

type PostPageProps = { lang: string; slug: string };

/** `localizations` (yalnızca çevirisi olan diller) → mevcut hreflang/dil değiştirici sözleşmesi (`translated: true`). */
function toContentLocalizations(post: PublicBlogDetail): ContentLocalization[] {
  return post.localizations.map((l) => ({ locale: l.locale, slug: l.slug, translated: true }));
}

/** Tipografi `globals.css` içindeki `.blog-prose` kurallarındadır (@tailwindcss/typography projede yok). */
const PROSE_CLASS = "blog-prose blog-prose--fill";

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

  redirectToCanonicalSlug({ requestedSlug: slug, activeLocale: lang, localizations: toContentLocalizations(post), locales, pathPrefix: "/blog" });
  return <BlogPostView post={post} lang={lang} slug={slug} locales={locales} dict={dict} siteName={settings.siteName} />;
}

type BlogDict = Awaited<ReturnType<typeof getSiteDictionary>>;

/**
 * Yazı gövdesi — yayındaki sayfa ve taslak önizleme AYNI görünümü kullanır. `preview` verilirse: üstte önizleme
 * şeridi ve "Review pending" satırı; JSON-LD, paylaşım düğmeleri, görüntülenme sayacı ve dil-alternatifi senkronu YOK.
 */
export function BlogPostView({
  post,
  lang,
  slug,
  locales,
  dict,
  siteName,
  preview,
}: {
  post: PublicBlogDetail;
  lang: string;
  slug: string;
  locales: Locale[];
  dict: BlogDict;
  siteName: string;
  preview?: Pick<PublicBlogPreviewDetail, "pendingReviewer" | "reviewApproved" | "status">;
}) {
  const localizations = toContentLocalizations(post);
  const t = dict.blog;
  const defaultLocale = locales.find((l) => l.isDefault)?.code ?? lang;
  const localize = (path: string) => withLocalePrefix(path, lang, defaultLocale);
  const physicianHref = (doctorSlug: string) => localize(`/physicians/${doctorSlug}`);
  const url = `${SITE_URL}${localize(`/blog/${slug}`)}`;
  const trackedSlug = post.localizations.find((l) => l.locale === defaultLocale)?.slug ?? slug;

  const jsonLd = preview
    ? []
    : blogJsonLdStrings({
        post,
        url,
        siteUrl: SITE_URL,
        siteName,
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
    <div dir={localeDirection(lang)} className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-12" data-testid="blog-post">
      {preview ? <BlogPreviewBanner t={t} approved={preview.reviewApproved} status={preview.status} /> : null}
      {preview ? null : <SyncLocaleAlternates kind="blog" items={localizations} />}
      {preview ? null : <ViewTracker kind="blog" slug={trackedSlug} />}
      {jsonLd.map((json, index) => (
        <JsonLdScript key={index} json={json} />
      ))}

      <BlogReadingProgress label={t.readingProgress} targetId="blog-article" />
      <BlogBreadcrumb ariaLabel={t.breadcrumbAria} items={crumbs} />

      <header className="mt-6 max-w-3xl">
        {post.category || post.specialty ? (
          <p>
            <BlogSpecialtyChip slug={post.specialty?.slug} label={(post.category ?? post.specialty)!.name} />
          </p>
        ) : null}
        <h1 className="mt-3 font-heading text-3xl font-semibold leading-tight text-foreground sm:text-4xl">{post.title}</h1>
        <BlogByline post={post} t={t} lang={lang} physicianHref={physicianHref} pendingReviewer={preview?.pendingReviewer ?? null} />
      </header>

      <div className="mt-8 grid gap-10 lg:grid-cols-[minmax(0,1fr)_17rem] lg:items-start lg:gap-12">
        <article id="blog-article" className="min-w-0">
          <BlogCover src={post.coverUrl} specialtySlug={post.specialty?.slug} label={post.specialty?.name ?? t.coverTemplateLabel} sizes="(min-width: 1024px) 66vw, 100vw" priority large className="aspect-[16/9] w-full rounded-[var(--site-radius)]" />

          <div className="mt-6">
            <BlogToc variant="mobile" items={tocItems} title={t.tocTitle} ariaLabel={t.tocAria} />
          </div>

          <BlogKeyTakeaways items={post.keyTakeaways} title={t.keyTakeaways} />

          <div className="mt-8">
            {split ? (
              <>
                <RichContentWithShortcodes html={split[0]} className={PROSE_CLASS} locale={lang} />
                <BlogConsultCard doctors={post.consultDoctors} t={t} physicianHref={physicianHref} />
                <RichContentWithShortcodes html={split[1]} className={PROSE_CLASS} locale={lang} />
              </>
            ) : (
              <RichContentWithShortcodes html={html} className={PROSE_CLASS} locale={lang} />
            )}
          </div>

          <div>
            <BlogConsultCard doctors={post.consultDoctors} t={t} physicianHref={physicianHref} className="mt-10" />
            <BlogFaq items={post.faq} title={t.faqTitle} />
            <BlogReferences items={post.references} t={t} lang={lang} />
            <BlogAuthorBox t={t} standardsHref={localize("/content-standards")} reviewersHref={localize("/medical-reviewers")} />
            <p className="mt-10 rounded-[var(--site-radius)] border border-border bg-surface p-4 text-sm text-foreground/80" data-testid="blog-disclaimer">
              {t.disclaimer}
            </p>
            {preview ? null : (
              <BlogShareButtons
                url={url}
                title={post.title}
                labels={{ heading: t.shareTitle, copy: t.shareCopy, copied: t.shareCopied, whatsapp: t.shareWhatsapp, email: t.shareEmail }}
              />
            )}
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
