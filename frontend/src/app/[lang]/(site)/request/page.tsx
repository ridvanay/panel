import type { Metadata } from "next";
import { fetchSpecialtiesServer } from "@/lib/api/server-telehealth";
import { fetchPackageServer } from "@/lib/api/server-packages";
import { fetchPublishedPagesServer } from "@/lib/api/server-pages";
import { fetchLocalesServer } from "@/lib/api/server-locales";
import { fetchSiteSettingsServer } from "@/lib/api/server-settings";
import { getSiteDictionary } from "@/lib/i18n/site-dictionaries";
import { localeDirection } from "@/lib/i18n/locale-direction";
import { withLocalePrefix } from "@/lib/i18n/site-path";
import { resolveExplicitConsentPage, resolveKvkkNoticePage } from "@/lib/legal-pages";
import { SITE_URL } from "@/lib/env";
import type { Specialty } from "@/lib/api/types";
import { IntermediaryNotice } from "@/components/site/intermediary-notice";
import { RequestForm, type RequestServiceGroup } from "@/components/site/request/request-form";

/**
 * Paket AH — `/{lang}/request`: bölüm bazlı talep formu (randevu/ödeme yerine). `?service=<slug>` bölümü,
 * `?package=<slug>` paketi önceden seçer. Başarı ekranı aynı sayfada (istemci bileşeni).
 */
type PageProps = {
  params: Promise<{ lang: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function firstParam(value: string | string[] | undefined): string {
  const raw = Array.isArray(value) ? value[0] : value;
  return typeof raw === "string" ? raw.trim().slice(0, 120) : "";
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { lang } = await params;
  const [locales, dict, settings] = await Promise.all([fetchLocalesServer(), getSiteDictionary(lang), fetchSiteSettingsServer()]);
  const defaultLocaleCode = locales.find((l) => l.isDefault)?.code ?? lang;
  const canonical = `${SITE_URL}${withLocalePrefix("/request", lang, defaultLocaleCode)}`;
  const languages: Record<string, string> = {};
  for (const locale of locales) {
    if (!locale.enabled) continue;
    languages[locale.hreflang ?? locale.code] = `${SITE_URL}${withLocalePrefix("/request", locale.code, defaultLocaleCode)}`;
  }
  languages["x-default"] = `${SITE_URL}${withLocalePrefix("/request", defaultLocaleCode, defaultLocaleCode)}`;
  const title = dict.request.metaTitle;
  const description = dict.request.metaDescription;
  return {
    title,
    description,
    alternates: { canonical, languages },
    openGraph: { title, description, type: "website", siteName: settings.siteName, url: canonical },
    twitter: { card: "summary", title, description },
  };
}

/** Üst bölümler + alt bölümler (yalnızca aktif olanlar), sıralı. */
function buildGroups(specialties: Specialty[]): RequestServiceGroup[] {
  const active = specialties.filter((s) => s.isActive !== false);
  const byOrder = (a: Specialty, b: Specialty) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name);
  const parents = active.filter((s) => s.parentId == null).sort(byOrder);
  return parents.map((parent) => ({
    slug: parent.slug,
    name: parent.name,
    children: active
      .filter((s) => s.parentId === parent.id)
      .sort(byOrder)
      .map((child) => ({ slug: child.slug, name: child.name })),
  }));
}

export default async function RequestPage({ params, searchParams }: PageProps) {
  const { lang } = await params;
  const query = await searchParams;
  const serviceParam = firstParam(query.service);
  const packageParam = firstParam(query.package);

  const [locales, dict, settings, specialties, pages, pkg] = await Promise.all([
    fetchLocalesServer(),
    getSiteDictionary(lang),
    fetchSiteSettingsServer(),
    fetchSpecialtiesServer(lang).catch(() => [] as Specialty[]),
    fetchPublishedPagesServer().catch(() => []),
    packageParam ? fetchPackageServer(packageParam, lang) : Promise.resolve(null),
  ]);
  const defaultLocaleCode = locales.find((l) => l.isDefault)?.code ?? lang;
  const localize = (path: string) => withLocalePrefix(path, lang, defaultLocaleCode);

  const groups = buildGroups(specialties);
  const knownSlugs = new Set(groups.flatMap((g) => [g.slug, ...g.children.map((c) => c.slug)]));
  const initialService = serviceParam && knownSlugs.has(serviceParam) ? serviceParam : null;

  // Paket seçiliyse paket adı gösterilir; paket yoksa/pasifse parametre yok sayılır.
  const selectedPackage = pkg ? { slug: pkg.slug, title: pkg.title } : null;

  const notice = resolveKvkkNoticePage(pages);
  const consent = resolveExplicitConsentPage(pages);

  return (
    <div dir={localeDirection(lang)} className="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-14" data-testid="request-page">
      <h1 className="font-heading text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">{dict.request.pageTitle}</h1>
      <p className="mt-3 text-base text-foreground/80">{dict.request.pageIntro}</p>
      <div className="mt-8">
        <RequestForm
          lang={lang}
          strings={dict.request}
          groups={groups}
          initialService={initialService}
          pkg={selectedPackage}
          privacyHref={notice ? localize(`/${notice.slug}`) : null}
          consentHref={consent ? localize(`/${consent.slug}`) : null}
          homeHref={localize("/")}
          servicesHref={localize("/specialties")}
          contactHref={localize("/contact")}
        />
      </div>
      <IntermediaryNotice strings={dict.intermediary} certificateNo={settings.healthTourismCertificateNo} className="mt-8" />
    </div>
  );
}
