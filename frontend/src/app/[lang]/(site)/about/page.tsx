import type { Metadata } from "next";
import { fetchDoctorsServer } from "@/lib/api/server-telehealth";
import { fetchLocalesServer } from "@/lib/api/server-locales";
import { fetchSiteSettingsServer } from "@/lib/api/server-settings";
import { withLocalePrefix } from "@/lib/i18n/site-path";
import { contentLocaleToIntl } from "@/lib/i18n/content-locale-to-intl";
import { getSiteDictionary } from "@/lib/i18n/site-dictionaries";
import { selectAboutDoctors } from "@/lib/about-page";
import { SITE_URL } from "@/lib/env";
import type { Locale } from "@/lib/api/types";
import { aboutSerif } from "@/components/site/about/about-fonts";
import { AboutHero } from "@/components/site/about/about-hero";
import { TreatmentAreas } from "@/components/site/about/treatment-areas";
import { WhyWmHealth } from "@/components/site/about/why-wm-health";
import { AboutDoctors } from "@/components/site/about/about-doctors";
import { ClosingBand } from "@/components/site/about/closing-band";
import { cn } from "@/lib/utils";

/**
 * "About Us" — `/doctors` İLE AYNI yapı: tek route, metinler `getSiteDictionary(lang).about`'tan
 * (`/about` tr, `/en/about` en). Statik bir klasör olduğu için `(site)/[slug]` CMS rotasından
 * ÖNCELİKLİDİR — admin panelinden ileride `about` slug'lı bir Page oluşturulursa o sayfa bu
 * route tarafından GÖLGELENİR ve görünmez.
 */
interface AboutPageProps {
  params: Promise<{ lang: string }>;
}

const ABOUT_PATH = "/about";

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

export async function generateMetadata({ params }: AboutPageProps): Promise<Metadata> {
  const { lang } = await params;
  const [locales, settings, dict] = await Promise.all([fetchLocalesServer(), fetchSiteSettingsServer(), getSiteDictionary(lang)]);
  const defaultLocaleCode = locales.find((l) => l.isDefault)?.code ?? lang;
  const canonical = `${SITE_URL}${withLocalePrefix(ABOUT_PATH, lang, defaultLocaleCode)}`;
  const { metaTitle, metaDescription } = dict.about;

  return {
    // Kök layout'un "%s · WM Health Istanbul" şablonu uygulanmasın — başlık birebir bu olmalı.
    title: { absolute: metaTitle },
    description: metaDescription,
    alternates: { canonical, languages: buildLanguageAlternates(locales, defaultLocaleCode) },
    openGraph: {
      title: metaTitle,
      description: metaDescription,
      type: "website",
      siteName: settings.siteName,
      url: canonical,
    },
    twitter: {
      card: "summary",
      title: metaTitle,
      description: metaDescription,
    },
  };
}

export default async function AboutPage({ params }: AboutPageProps) {
  const { lang } = await params;
  const [locales, dict, allDoctors] = await Promise.all([
    fetchLocalesServer(),
    getSiteDictionary(lang),
    // `telehealth` modülü kapalıysa/backend erişilemezse `[]` döner → doktor bölümü gizlenir.
    fetchDoctorsServer({}),
  ]);

  const defaultLocaleCode = locales.find((l) => l.isDefault)?.code ?? lang;
  const localize = (path: string) => withLocalePrefix(path, lang, defaultLocaleCode);
  const { doctors, founderId } = selectAboutDoctors(allDoctors);
  const hasDoctors = doctors.length > 0;

  // Ayrı bir randevu sayfası yok — randevu doktor profilindeki sihirbazdan alınır; CTA header'daki
  // "Doktorlar" CTA'sıyla aynı yere, doktor listesine gider.
  const doctorsHref = localize("/doctors");

  return (
    <div className={cn("about-page", aboutSerif.variable)}>
      <AboutHero
        dict={dict.about}
        homeLabel={dict.common.home}
        homeHref={localize("/")}
        bookHref={doctorsHref}
        showMeetDoctorsLink={hasDoctors}
      />
      <TreatmentAreas dict={dict.about} />
      <WhyWmHealth dict={dict.about} />
      {hasDoctors && (
        <AboutDoctors
          dict={dict.about}
          telehealthDict={dict.telehealth}
          doctors={doctors}
          founderId={founderId}
          doctorsHref={doctorsHref}
          activeLocaleCode={lang}
          defaultLocaleCode={defaultLocaleCode}
          intlLocale={contentLocaleToIntl(lang)}
        />
      )}
      <ClosingBand dict={dict.about} bookHref={doctorsHref} contactHref={localize("/contact")} />
    </div>
  );
}
