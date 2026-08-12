import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { fetchHomepageServer, fetchSiteSettingsServer } from "@/lib/api/server-settings";
import { fetchPageBySlugServer, fetchPublishedPagesServer } from "@/lib/api/server-pages";
import { fetchLocalesServer } from "@/lib/api/server-locales";
import { SiteHeader } from "@/components/site/site-header";
import { SiteFooter } from "@/components/site/site-footer";
import { BlockRenderer } from "@/components/site/blocks";
import { ViewTracker } from "@/components/site/view-tracker";
import { SyncLocaleAlternates } from "@/components/site/sync-locale-alternates";
import { LegalDocumentNotice } from "@/components/site/legal-document-notice";
import { FallbackHome } from "@/components/marketing/fallback-home";
import { buildContentMetadata } from "@/lib/seo";
import { SITE_URL } from "@/lib/env";
import type { Block } from "@/lib/page-builder/types";

type PageProps = { params: Promise<{ lang: string }> };

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { lang } = await params;
  const [homePage, settings, locales] = await Promise.all([
    fetchHomepageServer(),
    fetchSiteSettingsServer(),
    fetchLocalesServer(),
  ]);
  if (!homePage) return {};

  const defaultLocaleCode = locales.find((l) => l.isDefault)?.code;
  const localized =
    lang === defaultLocaleCode ? homePage : await resolveLocalizedHome(homePage.slug, lang, homePage);

  return buildContentMetadata(
    {
      title: localized.seoTitle || localized.title,
      description: localized.seoDescription,
      ogTitle: localized.ogTitle,
      ogImageUrl: localized.ogImageUrl,
      canonicalUrl: localized.canonicalUrl,
      noIndex: localized.noIndex,
    },
    // Kök `/` rotası her zaman kanonik olarak site kökünü gösterir (bkz. sitemap.ts).
    {
      fallbackCanonicalUrl: SITE_URL,
      siteName: settings.siteName,
      type: "website",
      localizations: localized.localizations,
      locales,
      activeLocale: lang,
      pathPrefix: "",
    },
  );
}

type HomePage = Awaited<ReturnType<typeof fetchHomepageServer>>;

async function resolveLocalizedHome(slug: string, lang: string, fallback: NonNullable<HomePage>) {
  const localized = await fetchPageBySlugServer(slug, lang);
  return localized ?? fallback;
}

export default async function RootPage({ params }: PageProps) {
  const { lang } = await params;
  const [homePage, locales] = await Promise.all([fetchHomepageServer(), fetchLocalesServer()]);

  const activeLocale = locales.find((l) => l.code === lang);
  if (!activeLocale) notFound();
  const defaultLocale = locales.find((l) => l.isDefault);

  if (!homePage) {
    return <FallbackHome />;
  }

  const page = lang === defaultLocale?.code ? homePage : await resolveLocalizedHome(homePage.slug, lang, homePage);
  const [settings, pages] = await Promise.all([fetchSiteSettingsServer(), fetchPublishedPagesServer(lang)]);

  const activeLocalization = page.localizations.find((l) => l.locale === lang);
  const showLegalNotice =
    page.isLegalDocument && lang !== defaultLocale?.code && activeLocalization?.translated === false;

  return (
    <div className="flex min-h-screen flex-col">
      <SyncLocaleAlternates kind="page" items={page.localizations} />
      <SiteHeader settings={settings} pages={pages} locales={locales} activeLocale={activeLocale} />
      <main className="flex-1">
        <ViewTracker kind="page" slug={page.slug} />
        {showLegalNotice ? (
          <LegalDocumentNotice
            title={page.title}
            defaultLocaleHref="/"
            defaultLocaleLabel={defaultLocale?.nativeLabel ?? ""}
          />
        ) : (
          <BlockRenderer blocks={page.blocks as unknown as Block[]} />
        )}
      </main>
      <SiteFooter
        siteName={settings.siteName}
        activeLocaleCode={activeLocale.code}
        defaultLocaleCode={defaultLocale?.code}
      />
    </div>
  );
}
