import type { Metadata } from "next";
import { fetchHomepageServer, fetchSiteSettingsServer } from "@/lib/api/server-settings";
import { fetchPageBySlugServer } from "@/lib/api/server-pages";
import { fetchLocalesServer } from "@/lib/api/server-locales";
import { BlockRenderer } from "@/components/site/blocks";
import { ViewTracker } from "@/components/site/view-tracker";
import { SyncLocaleAlternates } from "@/components/site/sync-locale-alternates";
import { LegalDocumentNotice } from "@/components/site/legal-document-notice";
import { FallbackHome } from "@/components/marketing/fallback-home";
import { buildContentMetadata } from "@/lib/seo";
import { SITE_URL } from "@/lib/env";
import { normalizePageNodes } from "@/lib/page-builder/normalize";

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

// `[lang]/(site)/layout.tsx` bu sayfayı sarmalar — ortak header/footer, `--site-*` renk/font
// CSS değişkenleri, Özel CSS/JS enjeksiyonu ve navigasyon menüsü ORADAN gelir (bkz. layout.tsx).
// Bu sayfa `(site)/[slug]/page.tsx` ile AYNI desende: sadece kendi içeriğini döndürür, header/
// footer'ı KENDİSİ render ETMEZ — daha önce bu dosya `(site)/` grubunun DIŞINDA olduğu için
// layout'u hiç almıyordu ve elle kendi header/footer'ını çiziyordu; bu da ana sayfanın Görünüm
// (renk/font/özel CSS/navigasyon) ayarlarını hiç yansıtmamasına yol açıyordu.
export default async function RootPage({ params }: PageProps) {
  const { lang } = await params;
  const [homePage, locales] = await Promise.all([fetchHomepageServer(), fetchLocalesServer()]);

  if (!homePage) {
    return <FallbackHome />;
  }

  const defaultLocale = locales.find((l) => l.isDefault);
  const page = lang === defaultLocale?.code ? homePage : await resolveLocalizedHome(homePage.slug, lang, homePage);

  const activeLocalization = page.localizations.find((l) => l.locale === lang);
  const showLegalNotice =
    page.isLegalDocument && lang !== defaultLocale?.code && activeLocalization?.translated === false;

  return (
    <>
      <SyncLocaleAlternates kind="page" items={page.localizations} />
      <ViewTracker kind="page" slug={page.slug} />
      {showLegalNotice ? (
        <LegalDocumentNotice
          title={page.title}
          defaultLocaleHref="/"
          defaultLocaleLabel={defaultLocale?.nativeLabel ?? ""}
        />
      ) : (
        <BlockRenderer nodes={normalizePageNodes(page.blocks)} chrome="page" />
      )}
    </>
  );
}
