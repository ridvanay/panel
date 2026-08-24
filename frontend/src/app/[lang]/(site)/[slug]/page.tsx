import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { fetchPageBySlugServer } from "@/lib/api/server-pages";
import { fetchSiteSettingsServer } from "@/lib/api/server-settings";
import { fetchLocalesServer } from "@/lib/api/server-locales";
import { fetchSiteAppearanceServer } from "@/lib/api/server-appearance";
import { BlockRenderer } from "@/components/site/blocks";
import { ViewTracker } from "@/components/site/view-tracker";
import { ViewCount } from "@/components/site/view-count";
import { SyncLocaleAlternates } from "@/components/site/sync-locale-alternates";
import { LegalDocumentNotice } from "@/components/site/legal-document-notice";
import { PageHeader } from "@/components/site/page-header";
import { SocialShareButtons } from "@/components/site/social-share-buttons";
import { redirectToCanonicalSlug } from "@/lib/i18n/canonical-slug";
import { buildContentMetadata } from "@/lib/seo";
import { SITE_URL } from "@/lib/env";
import { normalizePageNodes } from "@/lib/page-builder/normalize";

type PageProps = { params: Promise<{ lang: string; slug: string }> };

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { lang, slug } = await params;
  const [page, settings, locales] = await Promise.all([
    fetchPageBySlugServer(slug, lang),
    fetchSiteSettingsServer(),
    fetchLocalesServer(),
  ]);
  if (!page) return {};

  const defaultLocale = locales.find((l) => l.isDefault);
  const isHomePage = page.id === settings.homePageId;
  const fallbackCanonicalUrl = isHomePage
    ? SITE_URL
    : `${SITE_URL}${lang === defaultLocale?.code ? "" : `/${lang}`}/${slug}`;

  // §5.1 — hukuki belgenin çevrilmemiş dildeki bildirim sayfası içeriksizdir, indekslenmemeli.
  const activeLocalization = page.localizations.find((l) => l.locale === lang);
  const isUntranslatedLegalNotice =
    page.isLegalDocument && lang !== defaultLocale?.code && activeLocalization?.translated === false;

  return buildContentMetadata(
    {
      title: page.seoTitle || page.title,
      description: page.seoDescription,
      ogTitle: page.ogTitle,
      ogImageUrl: page.ogImageUrl,
      canonicalUrl: page.canonicalUrl,
      noIndex: page.noIndex || isUntranslatedLegalNotice,
    },
    {
      fallbackCanonicalUrl,
      siteName: settings.siteName,
      type: "website",
      localizations: page.localizations,
      locales,
      activeLocale: lang,
      pathPrefix: "",
    },
  );
}

export default async function DynamicPage({ params }: PageProps) {
  const { lang, slug } = await params;
  const [page, locales, settings, appearance] = await Promise.all([
    fetchPageBySlugServer(slug, lang),
    fetchLocalesServer(),
    fetchSiteSettingsServer(),
    fetchSiteAppearanceServer(),
  ]);
  if (!page) notFound();

  // §12.2 — `/en/<TR-kanonik-slug>` gibi istekler içeriği DOĞRU bulur (backend slug fallback'i)
  // ama EN'in KENDİ slug'ı DEĞİLSE, duplicate content'i önlemek için oraya kalıcı yönlendirilir.
  redirectToCanonicalSlug({
    requestedSlug: slug,
    activeLocale: lang,
    localizations: page.localizations,
    locales,
    pathPrefix: "",
  });

  const defaultLocale = locales.find((l) => l.isDefault);
  const activeLocalization = page.localizations.find((l) => l.locale === lang);
  // §5.1 — hukuki belge + çevrilmemiş dil: gövde SUNUCUDA ZATEN boşaltılmıştır (backend
  // fail-safe); istemci burada YALNIZCA durumu tespit edip bildirim gösterir (bkz.
  // `.claude/architect-scope-i18n.md` §5.1 — "İstemci bu durumu isLegalDocument &&
  // !localizations[locale].translated ile türetir").
  const showLegalNotice =
    page.isLegalDocument && lang !== defaultLocale?.code && activeLocalization?.translated === false;

  const isHomePage = page.id === settings.homePageId;
  const canonicalUrl = isHomePage
    ? SITE_URL
    : `${SITE_URL}${lang === defaultLocale?.code ? "" : `/${lang}`}/${slug}`;

  return (
    <>
      <SyncLocaleAlternates kind="page" items={page.localizations} />
      <ViewTracker kind="page" slug={slug} />
      <div className="mx-auto max-w-3xl px-4 pt-4 sm:px-6">
        <ViewCount count={page.viewCount} />
      </div>
      <PageHeader
        title={page.title}
        style={appearance.pageHeaderStyle}
        layout={appearance.pageHeaderLayout}
        backgroundColor={appearance.pageHeaderBackgroundColor}
        backgroundUrl={appearance.pageHeaderBackgroundUrl}
        overlayOpacity={appearance.pageHeaderOverlayOpacity}
      />
      {showLegalNotice ? (
        <LegalDocumentNotice
          title={page.title}
          defaultLocaleHref={`/${page.localizations.find((l) => l.locale === defaultLocale?.code)?.slug ?? slug}`}
          defaultLocaleLabel={defaultLocale?.nativeLabel ?? ""}
        />
      ) : (
        <>
          <BlockRenderer nodes={normalizePageNodes(page.blocks)} chrome="page" />
          {appearance.socialShareEnabled && appearance.socialShareNetworks.length > 0 && (
            <div className="mx-auto max-w-3xl px-4 pb-10 sm:px-6">
              <SocialShareButtons url={canonicalUrl} title={page.title} networks={appearance.socialShareNetworks} />
            </div>
          )}
        </>
      )}
    </>
  );
}
