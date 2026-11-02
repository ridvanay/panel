import type { Metadata } from "next";
import { fetchDoctorsServer, fetchSpecialtiesServer } from "@/lib/api/server-telehealth";
import { fetchLocalesServer } from "@/lib/api/server-locales";
import { fetchSiteSettingsServer } from "@/lib/api/server-settings";
import { fetchPageBySlugServer } from "@/lib/api/server-pages";
import { withLocalePrefix } from "@/lib/i18n/site-path";
import { contentLocaleToIntl } from "@/lib/i18n/content-locale-to-intl";
import { getSiteDictionary } from "@/lib/i18n/site-dictionaries";
import {
  ABOUT_DOCTORS_ANCHOR,
  ABOUT_PAGE_SLUG,
  buildDefaultAboutContent,
  getAboutDataForLocale,
  resolveAboutContent,
  sanitizeAboutOverrides,
  resolveAboutHref,
  selectAboutDoctors,
} from "@/lib/about-page";
import { SITE_URL } from "@/lib/env";
import type { Locale, SitePage } from "@/lib/api/types";
import { aboutSerif } from "@/components/site/about/about-fonts";
import { AboutHero } from "@/components/site/about/about-hero";
import { TreatmentAreas } from "@/components/site/about/treatment-areas";
import { WhyWmHealth } from "@/components/site/about/why-wm-health";
import { AboutDoctors } from "@/components/site/about/about-doctors";
import { OurRole, WhoWeAre } from "@/components/site/about/intermediary-sections";
import { DOCTORS_VISIBLE_TO_VISITORS } from "@/lib/intermediary";
import { ClosingBand } from "@/components/site/about/closing-band";
import { cn } from "@/lib/utils";
import { fetchAccreditationsServer } from "@/lib/api/server-accreditations";
import { AccreditationList } from "@/components/site/accreditations/accreditation-list";
import { ogCompatibleImageUrl } from "@/lib/og-image";

/**
 * "About Us" — içerik admin → Sayfalar'daki `slug = "about"` CMS kaydının `about-page` bloğundan
 * gelir, tasarım bu dosyadaki bileşenlerde sabittir. Kayıt yoksa/yayında değilse/silinmişse ya da
 * bir alan boşsa o alan için sözlük metni (`site-dictionaries/<lang>/about.ts`) gösterilir.
 *
 * Sayfa VARSAYILAN dilde (çeviri uygulanmadan) çekilir; aktif dilin bloğu `translations`'tan
 * doğrudan okunur — bir dilin kendi içeriği yoksa o dilin sözlüğü gösterilir, Türkçe içerik başka
 * bir dile sızmaz (bkz. `getAboutDataForLocale`).
 *
 * Statik bir klasör olduğu için `(site)/[slug]` CMS rotasından ÖNCELİKLİDİR; şablon sayfasına başka
 * bir slug'dan ulaşılırsa `[slug]/page.tsx` buraya yönlendirir.
 */
interface AboutPageProps {
  params: Promise<{ lang: string }>;
}

const ABOUT_PATH = `/${ABOUT_PAGE_SLUG}`;

/** `specialties/[slug]/page.tsx::buildSelfLanguageAlternates` İLE AYNI "kendine referans" deseni. */
function buildLanguageAlternates(locales: Locale[], defaultLocaleCode: string): Record<string, string> {
  const languages: Record<string, string> = {};
  for (const locale of locales) {
    if (!locale.enabled) continue;
    languages[locale.hreflang ?? locale.code] = `${SITE_URL}${withLocalePrefix(ABOUT_PATH, locale.code, defaultLocaleCode)}`;
  }
  languages["x-default"] = `${SITE_URL}${ABOUT_PATH}`;
  return languages;
}

/** Aktif dilin SEO alanı — varsayılan dilde kolon, diğer dillerde yalnızca o dilin çevirisi. */
function seoField(page: SitePage | null, lang: string, defaultLocaleCode: string, key: "seoTitle" | "seoDescription" | "ogTitle" | "canonicalUrl"): string | null {
  if (!page) return null;
  const value = lang === defaultLocaleCode ? page[key] : (page.translations?.[lang] as Record<string, unknown> | undefined)?.[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export async function generateMetadata({ params }: AboutPageProps): Promise<Metadata> {
  const { lang } = await params;
  const [locales, settings, dict, page] = await Promise.all([
    fetchLocalesServer(),
    fetchSiteSettingsServer(),
    getSiteDictionary(lang),
    fetchPageBySlugServer(ABOUT_PAGE_SLUG),
  ]);
  const defaultLocaleCode = locales.find((l) => l.isDefault)?.code ?? lang;
  const canonical =
    seoField(page, lang, defaultLocaleCode, "canonicalUrl") ?? `${SITE_URL}${withLocalePrefix(ABOUT_PATH, lang, defaultLocaleCode)}`;
  // Paket AH — hekimler kapalıyken CMS SEO metinleri kullanılmaz (aracı kuruluş vurgusu sözlükten).
  const useCmsText = DOCTORS_VISIBLE_TO_VISITORS;
  const title = (useCmsText ? seoField(page, lang, defaultLocaleCode, "seoTitle") : null) ?? dict.about.metaTitle;
  const description = (useCmsText ? seoField(page, lang, defaultLocaleCode, "seoDescription") : null) ?? dict.about.metaDescription;
  const ogTitle = (useCmsText ? seoField(page, lang, defaultLocaleCode, "ogTitle") : null) ?? title;
  const ogImage = page?.ogImageUrl?.trim() || null;

  return {
    // Kök layout'un "%s · WM Health Istanbul" şablonu uygulanmasın — başlık birebir bu olmalı.
    title: { absolute: title },
    description,
    alternates: { canonical, languages: buildLanguageAlternates(locales, defaultLocaleCode) },
    openGraph: {
      title: ogTitle,
      description,
      type: "website",
      siteName: settings.siteName,
      url: canonical,
      ...(ogImage ? { images: [ogCompatibleImageUrl(ogImage)] } : {}),
    },
    twitter: {
      card: ogImage ? "summary_large_image" : "summary",
      title: ogTitle,
      description,
    },
    ...(page?.noIndex ? { robots: { index: false, follow: true } } : {}),
  };
}

export default async function AboutPage({ params }: AboutPageProps) {
  const { lang } = await params;
  const [locales, dict, page, allDoctors, specialties, accreditations] = await Promise.all([
    fetchLocalesServer(),
    getSiteDictionary(lang),
    // Yalnızca YAYINDAKİ kaydı döner; yoksa/hata olursa `null` → sözlük metinleri.
    fetchPageBySlugServer(ABOUT_PAGE_SLUG),
    // `telehealth` modülü kapalıysa/backend erişilemezse `[]` döner → doktor bölümü gizlenir.
    DOCTORS_VISIBLE_TO_VISITORS ? fetchDoctorsServer({ locale: lang }) : Promise.resolve([]),
    // Aynı şekilde `[]` döner → "Tedavi alanları" kutuları hiçbirinde bağlantı olmaz, sade kutu kalır.
    fetchSpecialtiesServer(lang),
    // Paket V — yetki belgeleri; boşsa liste hiç render edilmez.
    fetchAccreditationsServer(lang),
  ]);

  const defaultLocaleCode = locales.find((l) => l.isDefault)?.code ?? lang;
  const content = resolveAboutContent(
    sanitizeAboutOverrides(getAboutDataForLocale(page, lang, defaultLocaleCode), DOCTORS_VISIBLE_TO_VISITORS),
    buildDefaultAboutContent(dict.about)
  );
  const href = (value: string) => resolveAboutHref(value, lang, defaultLocaleCode);

  // "Tedavi alanları" kutusu adı (isim bazlı, case-insensitive) bir uzmanlığa karşılık geliyorsa
  // dil önekli `/specialties/<slug>`'a bağlanır — `AboutTreatmentItem`'da ayrı bir slug alanı YOK.
  const specialtyHrefByName: Record<string, string> = {};
  for (const specialty of specialties) specialtyHrefByName[specialty.name.trim().toLowerCase()] = href(`/specialties/${specialty.slug}`);

  const { doctors, founderId } = content.doctors.enabled && DOCTORS_VISIBLE_TO_VISITORS
    ? selectAboutDoctors(allDoctors, content.doctors.founderDoctorId, content.doctors.count)
    : { doctors: [], founderId: null };
  const showDoctors = doctors.length > 0;

  // "#doctors" çapası gizli bir bölüme işaret ediyorsa ölü link render edilmez.
  const secondaryHeroHref = content.hero.secondaryCta.href === ABOUT_DOCTORS_ANCHOR && !showDoctors ? null : href(content.hero.secondaryCta.href);

  return (
    <div className={cn("about-page", aboutSerif.variable)}>
      <AboutHero
        hero={content.hero}
        homeLabel={dict.common.home}
        breadcrumbCurrent={dict.about.breadcrumbCurrent}
        breadcrumbLabel={dict.ui.breadcrumb}
        homeHref={withLocalePrefix("/", lang, defaultLocaleCode)}
        primaryHref={href(content.hero.primaryCta.href)}
        secondaryHref={secondaryHeroHref}
      />
      {/* Paket AH — "Who we are" (üst şerit bağlantısının hedefi: #authorized-facilities). */}
      <WhoWeAre t={dict.request} />
      {content.treatments.enabled && <TreatmentAreas treatments={content.treatments} specialtyHrefByName={specialtyHrefByName} />}
      {content.approach.enabled && <WhyWmHealth approach={content.approach} />}
      <OurRole t={dict.request} />
      {showDoctors && (
        <AboutDoctors
          section={content.doctors}
          telehealthDict={dict.telehealth}
          doctors={doctors}
          founderId={founderId}
          doctorsHref={withLocalePrefix("/physicians", lang, defaultLocaleCode)}
          activeLocaleCode={lang}
          defaultLocaleCode={defaultLocaleCode}
          intlLocale={contentLocaleToIntl(lang)}
        />
      )}
      <AccreditationList badges={accreditations} dict={dict.common} intlLocale={contentLocaleToIntl(lang)} />
      <ClosingBand
        closing={content.closing}
        primaryHref={href(content.closing.primaryCta.href)}
        secondaryHref={href(content.closing.secondaryCta.href)}
      />
    </div>
  );
}
