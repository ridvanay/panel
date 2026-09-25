import type { Metadata } from "next";
import { notFound, permanentRedirect, redirect } from "next/navigation";
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
import { withLocalePrefix } from "@/lib/i18n/site-path";
import { ABOUT_PAGE_SLUG, isAboutTemplatePage } from "@/lib/about-page";
import { isHomeTemplatePage } from "@/lib/home-page";
import { aboutSerif } from "@/components/site/about/about-fonts";
import { buildContentMetadata } from "@/lib/seo";
import { SITE_URL } from "@/lib/env";
import { getSiteDictionary, formatSiteString } from "@/lib/i18n/site-dictionaries";
import { normalizePageNodes } from "@/lib/page-builder/normalize";
import { buildFaqPageJsonLd, buildMapPlaceJsonLd } from "@/lib/page-builder/structured-data";
import { JsonLdScript } from "@/components/site/json-ld-script";

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
  // Anasayfa → dile uygun kök (`/` veya `/en`), yinelenen içerik olmasın.
  const localeRoot = `${SITE_URL}${lang === defaultLocale?.code ? "" : `/${lang}`}`;
  const fallbackCanonicalUrl = isHomePage ? localeRoot : `${localeRoot}/${slug}`;

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
  const [page, locales, settings, appearance, dict] = await Promise.all([
    fetchPageBySlugServer(slug, lang),
    fetchLocalesServer(),
    fetchSiteSettingsServer(),
    fetchSiteAppearanceServer(),
    getSiteDictionary(lang),
  ]);
  if (!page) notFound();

  // "Hakkımızda" şablon sayfası YALNIZCA statik `/about` rotasında render edilir (tasarım kodda);
  // başka bir slug'dan (ör. dile özel slug) ulaşılırsa oraya kalıcı yönlendirilir.
  if (isAboutTemplatePage(page)) {
    const defaultLocaleCode = locales.find((l) => l.isDefault)?.code ?? lang;
    permanentRedirect(withLocalePrefix(`/${ABOUT_PAGE_SLUG}`, lang, defaultLocaleCode));
  }

  // Ayarlar'da anasayfa olarak seçilmiş sayfa kendi slug adresinden de açılırsa aynı içerik iki
  // adreste yayınlanmış olur — dile uygun köke (`/` veya `/en`) GEÇİCİ (307) yönlendirilir.
  // Kalıcı (308) DEĞİL: tarayıcılar 308'i önbelleğe alır; anasayfa seçimi geri alındığında bu
  // adres eski sayfaya dönmelidir.
  if (page.id === settings.homePageId) {
    const defaultLocaleCode = locales.find((l) => l.isDefault)?.code ?? lang;
    redirect(withLocalePrefix("/", lang, defaultLocaleCode));
  }

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
  // `generateMetadata`teki `noIndex` hesabıyla BİREBİR aynı (`isUntranslatedLegalNotice` ===
  // `showLegalNotice`) — yapılandırılmış veri bastırma kararı (Boşluk 2) bu TEK değeri kullanır.
  const noIndexEffective = page.noIndex || showLegalNotice;
  const normalizedNodes = normalizePageNodes(page.blocks);

  const canonicalUrl = `${SITE_URL}${lang === defaultLocale?.code ? "" : `/${lang}`}/${slug}`;
  const isHomeTemplate = isHomeTemplatePage(page);

  return (
    <>
      <SyncLocaleAlternates kind="page" items={page.localizations} />
      <ViewTracker kind="page" slug={slug} />
      <div className="mx-auto max-w-3xl px-4 pt-4 sm:px-6">
        <ViewCount count={page.viewCount} />
      </div>
      {/* Anasayfa şablonu kendi hero'sunu taşır — sayfa başlık bandı gösterilmez (ör. anasayfa seçilmeden önce önizleme). */}
      {!isHomeTemplate && (
        <PageHeader
          title={page.title}
          style={appearance.pageHeaderStyle}
          layout={appearance.pageHeaderLayout}
          backgroundColor={appearance.pageHeaderBackgroundColor}
          backgroundUrl={appearance.pageHeaderBackgroundUrl}
          overlayOpacity={appearance.pageHeaderOverlayOpacity}
        />
      )}
      {showLegalNotice ? (
        <LegalDocumentNotice
          title={page.title}
          defaultLocaleHref={`/${page.localizations.find((l) => l.locale === defaultLocale?.code)?.slug ?? slug}`}
          noticeText={dict.legal.notAvailableInLocale}
          viewInDefaultLocaleLabel={formatSiteString(dict.legal.viewInDefaultLocale, {
            defaultLocaleLabel: defaultLocale?.nativeLabel ?? "",
          })}
        />
      ) : (
        <>
          <div className={isHomeTemplate ? aboutSerif.variable : undefined}>
            <BlockRenderer nodes={normalizedNodes} chrome="page" siteContext={{ lang, defaultLocaleCode: defaultLocale?.code ?? lang }} />
          </div>
          {appearance.socialShareEnabled && appearance.socialShareNetworks.length > 0 && (
            <div className="mx-auto max-w-3xl px-4 pb-10 sm:px-6">
              <SocialShareButtons url={canonicalUrl} title={page.title} networks={appearance.socialShareNetworks} />
            </div>
          )}
          {/* İndekslenmeyen sayfada yapılandırılmış veri BASILMAZ (mimar §7.5 Boşluk 2) — `noIndex`
              burada `generateMetadata`teki AYNI hesapla (`page.noIndex || isUntranslatedLegalNotice`)
              tutarlı tutulur, TEK kaynak `page.noIndex`. Boş/veri yoksa `JsonLdScript` zaten hiçbir
              şey render ETMEZ. */}
          {!noIndexEffective && (
            <>
              <JsonLdScript json={buildFaqPageJsonLd(normalizedNodes)} />
              <JsonLdScript json={buildMapPlaceJsonLd(normalizedNodes)} />
            </>
          )}
        </>
      )}
    </>
  );
}
