import type { Metadata } from "next";
import { Clock, ShieldCheck, Video } from "lucide-react";
import { fetchSpecialtiesServer } from "@/lib/api/server-telehealth";
import { fetchPackageServer } from "@/lib/api/server-packages";
import { fetchPublishedPagesServer } from "@/lib/api/server-pages";
import { fetchLocalesServer } from "@/lib/api/server-locales";
import { fetchServiceConsultationConfigServer } from "@/lib/api/server-service-consultations";
import { SERVICE_GROUP_ORDER, serviceGroupTitle, type ServiceGroupId } from "@/lib/service-groups";
import { getSiteDictionary } from "@/lib/i18n/site-dictionaries";
import { localeDirection } from "@/lib/i18n/locale-direction";
import { withLocalePrefix } from "@/lib/i18n/site-path";
import { resolveExplicitConsentPage, resolveKvkkNoticePage } from "@/lib/legal-pages";
import { callbackPath } from "@/lib/service-booking-links";
import type { Specialty } from "@/lib/api/types";
import { buildServiceGroups } from "@/components/site/request/build-groups";
import { ServiceBookingWizard } from "@/components/site/service-booking/service-booking-wizard";
import { ServiceBookingUnavailable } from "@/components/site/service-booking/service-booking-unavailable";

/**
 * AI İş 3 — `/{lang}/book-consultation`: hasta koordinatörüyle ücretsiz görüntülü görüşme rezervasyonu.
 * `?service=<slug>` veya `?package=<slug>` hizmeti önceden seçer. Form/kişisel adım içerdiğinden `noindex`.
 * Rezervasyon kapalıysa (config.enabled=false) talep formuna yönlendiren bilgi kartı gösterilir.
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
  const dict = await getSiteDictionary(lang);
  return {
    title: dict.serviceBooking.metaTitle,
    description: dict.serviceBooking.metaDescription,
    robots: { index: false, follow: false },
  };
}

export default async function BookConsultationPage({ params, searchParams }: PageProps) {
  const { lang } = await params;
  const query = await searchParams;
  const serviceParam = firstParam(query.service);
  const packageParam = firstParam(query.package);

  const [locales, dict, config] = await Promise.all([fetchLocalesServer(), getSiteDictionary(lang), fetchServiceConsultationConfigServer()]);
  const defaultLocaleCode = locales.find((l) => l.isDefault)?.code ?? lang;
  const localize = (path: string) => withLocalePrefix(path, lang, defaultLocaleCode);
  const s = dict.serviceBooking;
  const callbackHref = localize(callbackPath({ service: serviceParam || null, pkg: packageParam || null }));

  const badges = [
    { icon: ShieldCheck, label: s.badgeFree },
    { icon: Video, label: s.badgeDuration },
    { icon: Clock, label: s.badgeConfirm },
  ];

  const header = (
    <header className="border-b border-border bg-[var(--site-primary)]/5">
      <div className="mx-auto max-w-[1360px] px-4 py-10 sm:px-6 md:py-14 xl:px-8">
        <h1 className="font-heading text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">{s.pageTitle}</h1>
        <p className="mt-3 max-w-2xl text-base text-foreground/80 sm:text-lg">{s.pageIntro}</p>
        <ul aria-label={s.trustAria} className="mt-6 flex flex-wrap gap-2" data-testid="booking-trust-badges">
          {badges.map(({ icon: Icon, label }) => (
            <li key={label} className="inline-flex min-h-9 items-center gap-2 rounded-full border border-[var(--site-primary)]/20 bg-background px-3.5 text-sm font-medium text-foreground">
              <Icon className="size-4 shrink-0 text-[var(--site-primary)]" aria-hidden="true" />
              {label}
            </li>
          ))}
        </ul>
        <p className="mt-4 max-w-3xl text-xs text-foreground/70">{s.medicalNote}</p>
      </div>
    </header>
  );

  if (!config?.enabled) {
    return (
      <div dir={localeDirection(lang)} data-testid="book-consultation-page">
        {header}
        <div className="mx-auto max-w-[1360px] px-4 py-10 sm:px-6 md:py-14 xl:px-8">
          <ServiceBookingUnavailable strings={s} callbackHref={callbackHref} />
        </div>
      </div>
    );
  }

  const [specialties, pages, pkg] = await Promise.all([
    fetchSpecialtiesServer(lang).catch(() => [] as Specialty[]),
    fetchPublishedPagesServer().catch(() => []),
    packageParam ? fetchPackageServer(packageParam, lang).catch(() => null) : Promise.resolve(null),
  ]);
  const groups = buildServiceGroups(specialties);
  const knownSlugs = new Set(groups.flatMap((g) => [g.slug, ...g.children.map((c) => c.slug)]));
  const initialService = serviceParam && knownSlugs.has(serviceParam) ? serviceParam : null;
  const selectedPackage = pkg ? { slug: pkg.slug, title: pkg.title } : null;
  const notice = resolveKvkkNoticePage(pages);
  const consent = resolveExplicitConsentPage(pages);
  const groupTitles = Object.fromEntries(SERVICE_GROUP_ORDER.map((id) => [id, serviceGroupTitle(id, dict.services)])) as Record<ServiceGroupId, string>;

  return (
    <div dir={localeDirection(lang)} data-testid="book-consultation-page">
      {header}
      <div className="mx-auto max-w-[1360px] px-4 py-10 sm:px-6 md:py-14 xl:px-8">
        <ServiceBookingWizard
          lang={lang}
          strings={s}
          requestStrings={dict.request}
          groups={groups}
          groupTitles={groupTitles}
          initialService={initialService}
          pkg={selectedPackage}
          config={{ timeZone: config.timeZone, durationMin: config.durationMin, horizonDays: config.horizonDays }}
          privacyHref={notice ? localize(`/${notice.slug}`) : null}
          consentHref={consent ? localize(`/${consent.slug}`) : null}
          homeHref={localize("/")}
          servicesHref={localize("/specialties")}
          callbackHref={callbackHref}
          findTreatmentHref={localize("/find-your-treatment")}
        />
      </div>
    </div>
  );
}
