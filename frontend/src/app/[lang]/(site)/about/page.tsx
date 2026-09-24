import type { Metadata } from "next";
import { fetchDoctorsServer } from "@/lib/api/server-telehealth";
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
import { ClosingBand } from "@/components/site/about/closing-band";
import { cn } from "@/lib/utils";

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
  const title = seoField(page, lang, defaultLocaleCode, "seoTitle") ?? dict.about.metaTitle;
  const description = seoField(page, lang, defaultLocaleCode, "seoDescription") ?? dict.about.metaDescription;
  const ogTitle = seoField(page, lang, defaultLocaleCode, "ogTitle") ?? title;
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
      ...(ogImage ? { images: [ogImage] } : {}),
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
  const [locales, dict, page, allDoctors] = await Promise.all([
    fetchLocalesServer(),
    getSiteDictionary(lang),
    // Yalnızca YAYINDAKİ kaydı döner; yoksa/hata olursa `null` → sözlük metinleri.
    fetchPageBySlugServer(ABOUT_PAGE_SLUG),
    // `telehealth` modülü kapalıysa/backend erişilemezse `[]` döner → doktor bölümü gizlenir.
    fetchDoctorsServer({}),
  ]);

  const defaultLocaleCode = locales.find((l) => l.isDefault)?.code ?? lang;
  const content = resolveAboutContent(getAboutDataForLocale(page, lang, defaultLocaleCode), buildDefaultAboutContent(dict.about));
  const href = (value: string) => resolveAboutHref(value, lang, defaultLocaleCode);

  const { doctors, founderId } = content.doctors.enabled
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
        homeHref={withLocalePrefix("/", lang, defaultLocaleCode)}
        primaryHref={href(content.hero.primaryCta.href)}
        secondaryHref={secondaryHeroHref}
      />
      {content.treatments.enabled && <TreatmentAreas treatments={content.treatments} />}
      {content.approach.enabled && <WhyWmHealth approach={content.approach} />}
      {showDoctors && (
        <AboutDoctors
          section={content.doctors}
          telehealthDict={dict.telehealth}
          doctors={doctors}
          founderId={founderId}
          doctorsHref={withLocalePrefix("/doctors", lang, defaultLocaleCode)}
          activeLocaleCode={lang}
          defaultLocaleCode={defaultLocaleCode}
          intlLocale={contentLocaleToIntl(lang)}
        />
      )}
      <ClosingBand
        closing={content.closing}
        primaryHref={href(content.closing.primaryCta.href)}
        secondaryHref={href(content.closing.secondaryCta.href)}
      />
    </div>
  );
}
