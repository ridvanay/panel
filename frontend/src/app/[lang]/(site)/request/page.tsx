import type { Metadata } from "next";
import { fetchSpecialtiesServer } from "@/lib/api/server-telehealth";
import { fetchPackageServer } from "@/lib/api/server-packages";
import { fetchPublishedPagesServer } from "@/lib/api/server-pages";
import { fetchLocalesServer } from "@/lib/api/server-locales";
import { fetchSiteSettingsServer } from "@/lib/api/server-settings";
import { fetchContactChannelsServer } from "@/lib/api/server-contact-channels";
import { fetchContactPageServer } from "@/lib/api/server-contact";
import { buildWhatsappHref } from "@/lib/whatsapp-link";
import { SERVICE_GROUP_ORDER, serviceGroupTitle, type ServiceGroupId } from "@/lib/service-groups";
import { Clock, Globe, ShieldCheck, Building2 } from "lucide-react";
import { getSiteDictionary } from "@/lib/i18n/site-dictionaries";
import { localeDirection } from "@/lib/i18n/locale-direction";
import { withLocalePrefix } from "@/lib/i18n/site-path";
import { resolveExplicitConsentPage, resolveKvkkNoticePage } from "@/lib/legal-pages";
import { SITE_URL } from "@/lib/env";
import type { ContactConsentLocale, Specialty } from "@/lib/api/types";
import { RequestForm, type RequestServiceGroup } from "@/components/site/request/request-form";
import { RequestSidePanel } from "@/components/site/request/request-side-panel";

/**
 * Paket AH — `/{lang}/request`: bölüm bazlı talep formu (randevu/ödeme yerine). `?service=<slug>` bölümü,
 * `?package=<slug>` paketi önceden seçer. Başarı ekranı aynı sayfada (istemci bileşeni).
 */
type PageProps = {
  params: Promise<{ lang: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const CONSENT_LOCALES = ["en", "tr", "es", "de", "ar", "ru", "ro", "fr", "sr-latn"] as const;
function contactLocale(lang: string): ContactConsentLocale {
  return (CONSENT_LOCALES as readonly string[]).includes(lang) ? (lang as ContactConsentLocale) : "en";
}

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
  const title = dict.services.bookConsultation;
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
    icon: parent.icon,
    serviceGroup: parent.serviceGroup ?? null,
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
  const topicParam = firstParam(query.topic);

  const [locales, dict, settings, specialties, pages, pkg, channels, contactPage] = await Promise.all([
    fetchLocalesServer(),
    getSiteDictionary(lang),
    fetchSiteSettingsServer(),
    fetchSpecialtiesServer(lang).catch(() => [] as Specialty[]),
    fetchPublishedPagesServer().catch(() => []),
    packageParam ? fetchPackageServer(packageParam, lang) : Promise.resolve(null),
    fetchContactChannelsServer(lang),
    fetchContactPageServer(contactLocale(lang)).catch(() => null),
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

  const t = dict.request;
  // VIP sayfası "Request" bağlantıları: ?topic=<vip-...> mesaj alanını kısa hizmet notuyla ön-doldurur; bilinmeyen topic yok sayılır.
  const topicNotes: Record<string, string> = {
    "vip-transfer": t.topicVipTransfer,
    "vip-accommodation": t.topicVipAccommodation,
    "vip-coordinator": t.topicVipCoordinator,
    "vip-city-transport": t.topicVipCityTransport,
    "vip-companion": t.topicVipCompanion,
    "vip-recovery": t.topicVipRecovery,
  };
  const topicNote = Object.hasOwn(topicNotes, topicParam) ? topicNotes[topicParam]! : null;
  const badges = [
    { icon: ShieldCheck, label: t.badgeFree },
    { icon: Clock, label: t.badgeReply },
    { icon: Globe, label: t.badgeLanguages },
    { icon: Building2, label: t.badgeFacilities },
  ];
  const groupTitles = Object.fromEntries(SERVICE_GROUP_ORDER.map((id) => [id, serviceGroupTitle(id, dict.services)])) as Record<ServiceGroupId, string>;
  const whatsappHref = channels.whatsapp ? buildWhatsappHref(channels.whatsapp, settings.siteName) : null;

  return (
    <div dir={localeDirection(lang)} data-testid="request-page">
      <header className="border-b border-border bg-[var(--site-primary)]/5">
        <div className="mx-auto max-w-[1360px] px-4 py-12 sm:px-6 md:py-16 xl:px-8">
          <h1 className="font-heading text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">{dict.services.bookConsultation}</h1>
          <p className="mt-3 max-w-2xl text-base text-foreground/80 sm:text-lg">{t.heroSubtitle}</p>
          <ul aria-label={t.trustAria} className="mt-6 flex flex-wrap gap-2" data-testid="request-trust-badges">
            {badges.map(({ icon: Icon, label }) => (
              <li key={label} className="inline-flex min-h-9 items-center gap-2 rounded-full border border-[var(--site-primary)]/20 bg-background px-3.5 text-sm font-medium text-foreground">
                <Icon className="size-4 shrink-0 text-[var(--site-primary)]" aria-hidden="true" />
                {label}
              </li>
            ))}
          </ul>
        </div>
      </header>
      <div className="mx-auto max-w-[1360px] px-4 py-10 sm:px-6 md:py-14 xl:px-8">
        <div className="grid gap-8 lg:grid-cols-[minmax(0,62fr)_minmax(0,38fr)] lg:items-start xl:gap-12">
          <RequestForm
            lang={lang}
            strings={t}
            groups={groups}
            groupTitles={groupTitles}
            initialService={initialService}
            pkg={selectedPackage}
            initialMessage={topicNote}
            privacyHref={notice ? localize(`/${notice.slug}`) : null}
            consentHref={consent ? localize(`/${consent.slug}`) : null}
            homeHref={localize("/")}
            servicesHref={localize("/specialties")}
            contactHref={localize("/contact")}
            findTreatmentHref={localize("/find-your-treatment")}
            vipHref={localize("/vip-accommodation-transfer")}
            guidesHref={localize("/blog")}
            whatsappHref={whatsappHref}
          />
          <RequestSidePanel
            strings={t}
            intermediary={dict.intermediary}
            certificateNo={settings.healthTourismCertificateNo}
            whatsappHref={whatsappHref}
            phone={contactPage?.content.phone?.trim() || null}
            email={contactPage?.content.email?.trim() || null}
          />
        </div>
      </div>
    </div>
  );
}
