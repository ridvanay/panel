import type { Metadata } from "next";
import { IntermediaryNotice } from "@/components/site/intermediary-notice";
import { fetchSiteSettingsServer } from "@/lib/api/server-settings";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { isModuleEnabledServer } from "@/lib/api/server-modules";
import { fetchLocalesServer } from "@/lib/api/server-locales";
import { fetchPackageServer } from "@/lib/api/server-packages";
import { getSiteDictionary } from "@/lib/i18n/site-dictionaries";
import { contentLocaleToIntl } from "@/lib/i18n/content-locale-to-intl";
import { localeDirection } from "@/lib/i18n/locale-direction";
import { withLocalePrefix } from "@/lib/i18n/site-path";
import { SITE_URL } from "@/lib/env";
import { JsonLdScript } from "@/components/site/json-ld-script";
import { SafeImage } from "@/components/site/safe-image";
import { PackageDetailBody } from "@/components/site/packages/package-detail-body";
import { PackageDetailActions } from "@/components/site/packages/package-detail-actions";
import { PackageViewBeacon } from "@/components/site/packages/package-view-beacon";
import { buildPackageJsonLd, packageSocialImage } from "@/components/site/packages/package-json-ld";
import { categoryLabel } from "@/components/site/packages/package-format";

/**
 * Paket X — `/[lang]/packages/[slug]`: SEO için tam sayfa. hreflang YALNIZCA paketin `availableLocales` dilleri (çevirisi
 * olmayan dil için alternatif yayımlanmaz). İstenen dilde çeviri yoksa içerik yedek dilde gelir: bu sayfa `noindex` olur ve
 * canonical, içeriğin gerçek dili sürümüne gider (kopya içerik üretmez). Modül kapalı ya da paket yoksa 404.
 */
type PageProps = { params: Promise<{ lang: string; slug: string }> };

function truncate(text: string, max = 160): string {
  const t = text.trim();
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { lang, slug } = await params;
  const [pkg, locales] = await Promise.all([fetchPackageServer(slug, lang), fetchLocalesServer()]);
  if (!pkg) return {};
  const defaultLocaleCode = locales.find((l) => l.isDefault)?.code ?? lang;
  const path = (code: string) => `${SITE_URL}${withLocalePrefix(`/packages/${pkg.slug}`, code, defaultLocaleCode)}`;
  const translated = pkg.contentLocale === lang;
  const canonical = path(translated ? lang : pkg.contentLocale);

  const languages: Record<string, string> = {};
  const available = locales.filter((l) => l.enabled && pkg.availableLocales.includes(l.code));
  for (const locale of available) languages[locale.hreflang ?? locale.code] = path(locale.code);
  const xDefault = available.find((l) => l.code === defaultLocaleCode) ?? available[0];
  if (xDefault) languages["x-default"] = path(xDefault.code);

  const image = packageSocialImage(pkg);
  const description = truncate(pkg.summary) || undefined;
  return {
    title: pkg.title,
    description,
    alternates: { canonical, ...(Object.keys(languages).length > 0 ? { languages } : {}) },
    openGraph: {
      title: pkg.title,
      description,
      type: "website",
      url: canonical,
      ...(image ? { images: [{ url: image, ...(pkg.cover?.width ? { width: pkg.cover.width } : {}), ...(pkg.cover?.height ? { height: pkg.cover.height } : {}) }] } : {}),
    },
    twitter: { card: image ? "summary_large_image" : "summary", title: pkg.title, description, ...(image ? { images: [image] } : {}) },
    ...(translated ? {} : { robots: { index: false, follow: true } }),
  };
}

export default async function PackagePage({ params }: PageProps) {
  const { lang, slug } = await params;
  if (!(await isModuleEnabledServer("telehealth"))) notFound();
  const [pkg, locales, dict, settings] = await Promise.all([fetchPackageServer(slug, lang), fetchLocalesServer(), getSiteDictionary(lang), fetchSiteSettingsServer()]);
  if (!pkg) notFound();
  const defaultLocaleCode = locales.find((l) => l.isDefault)?.code ?? lang;
  const localize = (path: string) => withLocalePrefix(path, lang, defaultLocaleCode);
  const t = dict.packages;
  const canonical = `${SITE_URL}${localize(`/packages/${pkg.slug}`)}`;

  return (
    <article dir={localeDirection(lang)} className="mx-auto max-w-4xl px-4 py-10 sm:px-6 sm:py-14" data-testid="package-page">
      <JsonLdScript json={buildPackageJsonLd(pkg, canonical)} />
      <PackageViewBeacon kind="package" slug={pkg.slug} />
      <Link href={localize("/packages")} className="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-[var(--site-link,var(--site-primary))]">
        <ChevronLeft className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />
        {t.backToList}
      </Link>
      <p className="mt-2 text-xs font-medium uppercase tracking-wide text-[var(--site-primary)]">{categoryLabel(t, pkg.category)}</p>
      <h1 className="mt-1 font-heading text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">{pkg.title}</h1>
      {pkg.summary && <p className="mt-3 max-w-3xl text-base text-foreground/80">{pkg.summary}</p>}
      {pkg.cover && (
        <div className="relative mt-6 aspect-[16/9] w-full overflow-hidden rounded-[var(--site-radius)] bg-[var(--site-primary)]/10">
          <SafeImage src={pkg.cover.url} alt={pkg.cover.alt ?? pkg.title} fill priority sizes="(min-width: 896px) 896px, 100vw" className="object-cover" />
        </div>
      )}
      <div className="mt-8 grid gap-10 lg:grid-cols-[1fr_22rem]">
        <PackageDetailBody pkg={pkg} t={t} intlLocale={contentLocaleToIntl(lang)} localize={localize} showFaq />
        <div className="lg:sticky lg:top-24 lg:self-start">
          <PackageDetailActions slug={pkg.slug} title={pkg.title} />
        </div>
      </div>
      <IntermediaryNotice strings={dict.intermediary} certificateNo={settings.healthTourismCertificateNo} className="mt-10" />
    </article>
  );
}
