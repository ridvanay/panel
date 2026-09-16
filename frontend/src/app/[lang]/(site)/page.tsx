import type { Metadata } from "next";
import { fetchHomepageServer, fetchSiteSettingsServer } from "@/lib/api/server-settings";
import { fetchPageBySlugServer } from "@/lib/api/server-pages";
import { fetchLocalesServer } from "@/lib/api/server-locales";
import { fetchNavigationConfigServer } from "@/lib/api/server-navigation";
import { isModuleEnabledServer } from "@/lib/api/server-modules";
import { BlockRenderer } from "@/components/site/blocks";
import { ViewTracker } from "@/components/site/view-tracker";
import { SyncLocaleAlternates } from "@/components/site/sync-locale-alternates";
import { LegalDocumentNotice } from "@/components/site/legal-document-notice";
import { FallbackHome } from "@/components/marketing/fallback-home";
import { buildContentMetadata } from "@/lib/seo";
import { SITE_URL } from "@/lib/env";
import { withLocalePrefix } from "@/lib/i18n/site-path";
import { getSiteDictionary, formatSiteString } from "@/lib/i18n/site-dictionaries";
import { normalizePageNodes } from "@/lib/page-builder/normalize";
import {
  buildFaqPageJsonLd,
  buildMapPlaceJsonLd,
  buildMedicalOrganizationJsonLd,
  buildWebSiteJsonLd,
} from "@/lib/page-builder/structured-data";
import { JsonLdScript } from "@/components/site/json-ld-script";

type PageProps = { params: Promise<{ lang: string }> };

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { lang } = await params;
  const [homePage, settings, locales] = await Promise.all([
    fetchHomepageServer(),
    fetchSiteSettingsServer(),
    fetchLocalesServer(),
  ]);
  if (!homePage) return {};

  const defaultLocaleCode = locales.find((l) => l.isDefault)?.code ?? lang;
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
    {
      // qa-agent bulgusu (2026-09-16) — sabit `SITE_URL` HER dil için AYNI (prefix'siz) kanonik
      // URL'i üretiyordu (`/tr` canonical'ı yanlışlıkla köke işaret ediyordu). Kök `/` rotası
      // varsayılan dilde prefix'siz, diğer dillerde `withLocalePrefix` ile prefix'li olmalıdır
      // (bkz. sitemap.ts'teki AYNI ana sayfa istisnası).
      fallbackCanonicalUrl: `${SITE_URL}${withLocalePrefix("/", lang, defaultLocaleCode)}`,
      siteName: settings.siteName,
      type: "website",
      localizations: localized.localizations,
      locales,
      activeLocale: lang,
      pathPrefix: "",
      // Ana sayfanın kaydı bir `Page` (`slug: "anasayfa"`) olsa da PREFİX'SİZ kanonik URL'i HER
      // ZAMAN `/` / `/tr`'dir, kaydın kendi slug'ı DEĞİL — `buildLanguageAlternates` bu bayrakla
      // `pathPrefix + slug` yerine kök path kullanır (bkz. `lib/seo.ts::isHomepage`).
      isHomepage: true,
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
  const [homePage, locales, settings, navigation, telehealthModuleEnabled, dict] = await Promise.all([
    fetchHomepageServer(),
    fetchLocalesServer(),
    fetchSiteSettingsServer(),
    fetchNavigationConfigServer(),
    // Görev (2026-09-16) — `MedicalOrganization` yalnızca `telehealth` modülü açıkken render
    // edilir (bu site şablonu/tema-nötr bir iskelet, HER kurulum bir sağlık kuruluşu DEĞİL —
    // `doctors/layout.tsx`'teki AYNI `isModuleEnabledServer("telehealth")` kapı deseni).
    isModuleEnabledServer("telehealth"),
    getSiteDictionary(lang),
  ]);

  if (!homePage) {
    return <FallbackHome />;
  }

  const defaultLocale = locales.find((l) => l.isDefault);
  const page = lang === defaultLocale?.code ? homePage : await resolveLocalizedHome(homePage.slug, lang, homePage);

  const activeLocalization = page.localizations.find((l) => l.locale === lang);
  const showLegalNotice =
    page.isLegalDocument && lang !== defaultLocale?.code && activeLocalization?.translated === false;
  // `generateMetadata`teki `noIndex` hesabıyla tutarlı (`page.noIndex` TEK kaynak) — mimar §7.5
  // Boşluk 2: `noIndex`teki sayfada yapılandırılmış veri BASILMAZ.
  const noIndexEffective = page.noIndex || showLegalNotice;
  const normalizedNodes = normalizePageNodes(page.blocks);

  return (
    <>
      <SyncLocaleAlternates kind="home" items={page.localizations} />
      <ViewTracker kind="page" slug={page.slug} />
      {showLegalNotice ? (
        <LegalDocumentNotice
          title={page.title}
          defaultLocaleHref="/"
          noticeText={dict.legal.notAvailableInLocale}
          viewInDefaultLocaleLabel={formatSiteString(dict.legal.viewInDefaultLocale, {
            defaultLocaleLabel: defaultLocale?.nativeLabel ?? "",
          })}
        />
      ) : (
        <>
          <BlockRenderer nodes={normalizedNodes} chrome="page" />
          {/* Sayfa başına TEK `FAQPage`/`Place` script — mimar §7.5 Boşluk 1/3, bkz.
              `lib/page-builder/structured-data.ts`. */}
          {!noIndexEffective && (
            <>
              <JsonLdScript json={buildFaqPageJsonLd(normalizedNodes)} />
              <JsonLdScript json={buildMapPlaceJsonLd(normalizedNodes)} />
              <JsonLdScript json={buildWebSiteJsonLd(settings, SITE_URL)} />
              {telehealthModuleEnabled && (
                <JsonLdScript json={buildMedicalOrganizationJsonLd(settings, navigation.socialLinks, SITE_URL)} />
              )}
            </>
          )}
        </>
      )}
    </>
  );
}
