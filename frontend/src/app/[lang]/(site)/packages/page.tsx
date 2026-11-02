import type { Metadata } from "next";
import { IntermediaryNotice } from "@/components/site/intermediary-notice";
import { fetchSiteSettingsServer } from "@/lib/api/server-settings";
import { notFound } from "next/navigation";
import { isModuleEnabledServer } from "@/lib/api/server-modules";
import { fetchLocalesServer } from "@/lib/api/server-locales";
import { fetchPackagesServer } from "@/lib/api/server-packages";
import { PACKAGE_CATEGORIES, type PackageCategory } from "@/lib/api/types";
import { getSiteDictionary } from "@/lib/i18n/site-dictionaries";
import { contentLocaleToIntl } from "@/lib/i18n/content-locale-to-intl";
import { localeDirection } from "@/lib/i18n/locale-direction";
import { withLocalePrefix } from "@/lib/i18n/site-path";
import { SITE_URL } from "@/lib/env";
import { PackagesPageView } from "@/components/site/packages/packages-page-view";
import { PackageViewBeacon } from "@/components/site/packages/package-view-beacon";

/**
 * Paket X — `/[lang]/packages`: kategori filtreli paket ızgarası (`?category=`). Telehealth modülü kapalıysa 404.
 * Filtreli görünüm temel yola canonical verir (kopya içerik üretmez).
 */
type PageProps = {
  params: Promise<{ lang: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function parseCategory(raw: string | string[] | undefined): PackageCategory | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return PACKAGE_CATEGORIES.find((c) => c === value) ?? null;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { lang } = await params;
  const [locales, dict] = await Promise.all([fetchLocalesServer(), getSiteDictionary(lang)]);
  const defaultLocaleCode = locales.find((l) => l.isDefault)?.code ?? lang;
  const canonical = `${SITE_URL}${withLocalePrefix("/packages", lang, defaultLocaleCode)}`;
  const languages: Record<string, string> = {};
  for (const locale of locales) {
    if (!locale.enabled) continue;
    languages[locale.hreflang ?? locale.code] = `${SITE_URL}${withLocalePrefix("/packages", locale.code, defaultLocaleCode)}`;
  }
  languages["x-default"] = `${SITE_URL}${withLocalePrefix("/packages", defaultLocaleCode, defaultLocaleCode)}`;
  const title = dict.packages.pageTitle;
  const description = dict.packages.pageMetaDescription;
  return {
    title,
    description,
    alternates: { canonical, languages },
    openGraph: { title, description, type: "website", url: canonical },
    twitter: { card: "summary", title, description },
  };
}

export default async function PackagesPage({ params, searchParams }: PageProps) {
  const { lang } = await params;
  if (!(await isModuleEnabledServer("telehealth"))) notFound();
  const category = parseCategory((await searchParams).category);
  const [locales, dict, all, filtered, settings] = await Promise.all([
    fetchLocalesServer(),
    getSiteDictionary(lang),
    fetchPackagesServer(lang),
    category ? fetchPackagesServer(lang, { category }) : Promise.resolve(null),
    fetchSiteSettingsServer(),
  ]);
  const defaultLocaleCode = locales.find((l) => l.isDefault)?.code ?? lang;
  const categories = all.categories.length > 0 ? all.categories : Array.from(new Set(all.items.map((p) => p.category)));
  return (
    <>
      <PackageViewBeacon kind="list" />
      <PackagesPageView
      t={dict.packages}
      items={(filtered ?? all).items}
      categories={categories}
      active={category}
      basePath={withLocalePrefix("/packages", lang, defaultLocaleCode)}
      intlLocale={contentLocaleToIntl(lang)}
      localize={(path) => withLocalePrefix(path, lang, defaultLocaleCode)}
      dir={localeDirection(lang)}
    />
      <div dir={localeDirection(lang)} className="mx-auto max-w-6xl px-4 pb-12 sm:px-6">
        <IntermediaryNotice strings={dict.intermediary} certificateNo={settings.healthTourismCertificateNo} />
      </div>
    </>
  );
}
