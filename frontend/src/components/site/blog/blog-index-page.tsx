import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { fetchBlogListServer, fetchBlogTopicsServer } from "@/lib/api/server-blog";
import { fetchLocalesServer } from "@/lib/api/server-locales";
import { fetchPackagesServer } from "@/lib/api/server-packages";
import { fetchAllDoctorsServer, fetchSpecialtiesServer } from "@/lib/api/server-telehealth";
import { specialtiesWithActiveDoctors } from "@/lib/blog/specialties-with-doctors";
import { getSiteDictionary } from "@/lib/i18n/site-dictionaries";
import { contentLocaleToIntl } from "@/lib/i18n/content-locale-to-intl";
import { localeDirection } from "@/lib/i18n/locale-direction";
import { withLocalePrefix } from "@/lib/i18n/site-path";
import { SITE_URL } from "@/lib/env";
import { BLOG_PAGE_SIZE, blogListPath, cleanQuery, cleanTopic, firstParam, listingRobots, totalPages } from "@/lib/blog/topics";
import { fillBlogString } from "@/lib/blog/format";
import type { PackageCardData, Specialty } from "@/lib/api/types";
import { BlogBreadcrumb } from "./blog-breadcrumb";
import { BlogFeatured } from "./blog-featured";
import { BlogPostCard } from "./blog-post-card";
import { BlogTopicFilter } from "./blog-topic-filter";
import { BlogSearchForm } from "./blog-search-form";
import { BlogPagination } from "./blog-pagination";
import { BlogFindPhysicianCta, BlogPopularPackages, BlogTrustLinks, pickPopularPackages } from "./blog-cta-blocks";
import Link from "next/link";
import { BlogCoordinatorCta, BlogEmptyState, BlogHero, BlogSpecialtyBrowse } from "./blog-index-parts";

export type BlogSearchParams = Record<string, string | string[] | undefined>;

/** Editoryal guven sayfalari (Paket Z1-ek: ozel route'lar; her zaman vardir). */
export const BLOG_TRUST_PAGES = [
  { slug: "content-standards", key: "contentStandards" },
  { slug: "medical-reviewers", key: "authorsReviewers" },
] as const;

function readFilters(searchParams: BlogSearchParams) {
  return { topic: cleanTopic(firstParam(searchParams.topic)), q: cleanQuery(firstParam(searchParams.q)) };
}

/**
 * Meta kararı (Paket Z1): her sayfanın canonical'ı KENDİSİDİR (`/blog`, `/blog/page/2`); `?topic=` bu adrese eklenir
 * (konu sayfaları indekslenebilir landing sayfalarıdır). `?q=` aramaları `noindex, follow` olur ve canonical'ı
 * aramasız adrestir. Sonuçsuz sayfa da `noindex`. Başlığa 2. sayfadan itibaren "Sayfa n / toplam" eklenir.
 */
export async function buildBlogIndexMetadata(options: { lang: string; page: number; searchParams: BlogSearchParams }): Promise<Metadata> {
  const { lang, page } = options;
  const { topic, q } = readFilters(options.searchParams);
  const [locales, dict, list] = await Promise.all([
    fetchLocalesServer(),
    getSiteDictionary(lang),
    fetchBlogListServer({ locale: lang, page, pageSize: BLOG_PAGE_SIZE, topic, q }),
  ]);
  const defaultLocale = locales.find((l) => l.isDefault)?.code ?? lang;
  const pages = totalPages(list.total, BLOG_PAGE_SIZE);
  const canonical = `${SITE_URL}${withLocalePrefix(blogListPath({ page, topic }), lang, defaultLocale)}`;
  const t = dict.blog;
  const title = page > 1 ? `${t.pageTitle} – ${fillBlogString(t.pageOf, { n: page, total: pages })}` : t.pageTitle;
  const robots = listingRobots({ q, total: list.total });
  return {
    title,
    description: t.metaDescription,
    alternates: { canonical },
    robots: robots.index ? undefined : { index: false, follow: robots.follow },
    openGraph: { title, description: t.metaDescription, type: "website", url: canonical },
    twitter: { card: "summary", title, description: t.metaDescription },
  };
}

/** Paket Z1 — `/[lang]/blog` ve `/[lang]/blog/page/[n]` ortak gövdesi. */
export async function BlogIndexPage({ lang, page, searchParams }: { lang: string; page: number; searchParams: BlogSearchParams }) {
  const { topic, q } = readFilters(searchParams);
  const [locales, dict, list, groups, packages, specialties, doctors] = await Promise.all([
    fetchLocalesServer(),
    getSiteDictionary(lang),
    fetchBlogListServer({ locale: lang, page, pageSize: BLOG_PAGE_SIZE, topic, q }),
    fetchBlogTopicsServer(lang),
    fetchPackagesServer(lang).catch(() => ({ items: [] as PackageCardData[], categories: [] })),
    // Telehealth modulu kapaliysa / hata varsa kartlar gizlenir; sayfa yine calisir.
    fetchSpecialtiesServer(lang).catch(() => [] as Specialty[]),
    // Yalnızca aktif hekimi olan uzmanlıklar listelenir; hata durumunda kartlar gizlenir (sayfa çalışmaya devam eder).
    fetchAllDoctorsServer(10, lang).catch(() => []),
  ]);
  // Sayfa aralığı dışı (ör. /blog/page/99) yalnızca 1. sayfadan sonra 404'tür.
  if (page > 1 && list.items.length === 0) notFound();

  const defaultLocale = locales.find((l) => l.isDefault)?.code ?? lang;
  const localize = (path: string) => withLocalePrefix(path, lang, defaultLocale);
  const t = dict.blog;
  const filtered = Boolean(topic || q);
  // "All topics (N)" daima filtresiz toplamı gösterir.
  const overallTotal = filtered ? (await fetchBlogListServer({ locale: lang, page: 1, pageSize: 1 })).total : list.total;

  const trustLinks = BLOG_TRUST_PAGES.map((entry) => ({ label: t[entry.key], href: localize(`/${entry.slug}`) }));
  const activeSpecialties = specialtiesWithActiveDoctors(specialties, doctors);

  const featured = page === 1 && !q ? list.featured : null;
  const cards = list.items.filter((post) => post.id !== featured?.id);
  const pages = totalPages(list.total, BLOG_PAGE_SIZE);
  const popular = pickPopularPackages(packages.items);
  const cardHref = (slug: string) => localize(`/blog/${slug}`);
  const firstChunk = cards.slice(0, 6);
  const restChunk = cards.slice(6);

  return (
    <div dir={localeDirection(lang)} data-testid="blog-index">
      <BlogHero
        t={t}
        trustHref={localize("/content-standards")}
        breadcrumb={<BlogBreadcrumb ariaLabel={t.breadcrumbAria} items={[{ label: dict.common.home, href: localize("/") }, { label: t.pageTitle }]} />}
      >
        {list.total > 0 ? (
          <p className="mt-3 text-sm font-medium text-foreground/70" data-testid="blog-total">
            {fillBlogString(t.articleCount, { n: list.total })}
          </p>
        ) : null}
        <BlogSearchForm action={localize("/blog")} q={q} topic={topic} t={t} />
      </BlogHero>

      <div className="mx-auto max-w-7xl px-4 pb-8 sm:px-6 sm:pb-12">
      <BlogSpecialtyBrowse
        specialties={activeSpecialties}
        groups={groups}
        activeTopic={topic}
        t={t}
        filterHref={(slug) => localize(blogListPath({ topic: slug }))}
        specialtyHref={(slug) => localize(`/specialties/${slug}`)}
      />
      <BlogTopicFilter groups={groups} activeTopic={topic} total={overallTotal} t={t} hrefFor={(next) => localize(blogListPath({ topic: next, q }))} />

      {q ? (
        <p className="mt-6 text-sm text-foreground/70" data-testid="blog-search-summary">
          {fillBlogString(t.searchResultsFor, { q })}
        </p>
      ) : null}

      {featured ? <BlogFeatured post={featured} href={cardHref(featured.slug)} t={t} lang={lang} /> : null}

      {list.total === 0 && !filtered ? (
        <>
          <BlogEmptyState t={t} />
          <BlogCoordinatorCta t={t} />
        </>
      ) : list.total === 0 ? (
        <div className="mt-10 rounded-[var(--site-radius)] border border-dashed border-border p-8 text-center" data-testid="blog-empty">
          <p className="font-heading text-lg font-semibold text-foreground">{t.noResultsTitle}</p>
          <p className="mt-1 text-sm text-foreground/70">{t.noResultsText}</p>
          <Link href={localize("/blog")} className="mt-4 inline-flex min-h-11 items-center rounded-[var(--site-radius)] border border-[var(--site-primary)] px-4 text-sm font-semibold text-[var(--site-primary)] hover:bg-[var(--site-primary)]/5">
            {t.showAllArticles}
          </Link>
        </div>
      ) : (
        <>
          {firstChunk.length > 0 ? (
            <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3" data-testid="blog-grid">
              {firstChunk.map((post, i) => (
                <BlogPostCard key={post.id} post={post} href={cardHref(post.slug)} t={t} lang={lang} priority={!featured && i < 3} />
              ))}
            </div>
          ) : null}
          <div className="mt-8">
            <BlogFindPhysicianCta t={t} />
          </div>
          {restChunk.length > 0 ? (
            <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {restChunk.map((post) => (
                <BlogPostCard key={post.id} post={post} href={cardHref(post.slug)} t={t} lang={lang} />
              ))}
            </div>
          ) : null}
        </>
      )}

      <BlogPagination page={page} pages={pages} t={t} hrefFor={(next) => localize(blogListPath({ page: next, topic, q }))} />

      <BlogPopularPackages
        items={popular}
        t={t}
        packagesStrings={dict.packages}
        intlLocale={contentLocaleToIntl(lang)}
        hrefFor={(slug) => localize(`/packages/${slug}`)}
        allHref={localize("/packages")}
      />
      <BlogTrustLinks links={trustLinks} t={t} />
      </div>
    </div>
  );
}
