import type { Metadata } from "next";
import { Tag } from "lucide-react";
import { fetchSpecialtiesServer } from "@/lib/api/server-telehealth";
import { topLevelSpecialties } from "@/lib/specialty-hierarchy";
import { fetchLocalesServer } from "@/lib/api/server-locales";
import { fetchSiteSettingsServer } from "@/lib/api/server-settings";
import { ServiceCard, ServicesProcessStrip } from "@/components/site/services/service-card";
import { groupServices, serviceGroupTitle } from "@/lib/service-groups";
import { EmptyState } from "@/components/ui/empty-state";
import { withLocalePrefix } from "@/lib/i18n/site-path";
import { formatSiteString, getSiteDictionary } from "@/lib/i18n/site-dictionaries";
import { SITE_URL } from "@/lib/env";
import { IntermediaryNotice } from "@/components/site/intermediary-notice";
import { resolveSiteFeatures } from "@/lib/site-features";
import { isServiceBookingEnabledServer } from "@/lib/api/server-service-consultations";

/**
 * Görev (2026-09-16) — uzmanlık (branş) ızgarası. `doctors/page.tsx` İLE AYNI desen: veri sunucu
 * bileşeninde çekilir (`GET /specialties`, sayfalama YOK), `generateMetadata` SEO alanlarını
 * bağlar. `Specialty`'de `translations`/çok-dillilik YOK (backend bunu genişletmedi) — başlık/
 * açıklama İÇİN doğrudan DB alanları kullanılır, ekstra bir çeviri katmanı İCAT EDİLMEZ.
 */
interface SpecialtiesPageProps {
  params: Promise<{ lang: string }>;
}

export async function generateMetadata({ params }: SpecialtiesPageProps): Promise<Metadata> {
  const { lang } = await params;
  const [locales, settings, specialties, dict] = await Promise.all([
    fetchLocalesServer(),
    fetchSiteSettingsServer(),
    fetchSpecialtiesServer(lang).then(topLevelSpecialties),
    getSiteDictionary(lang),
  ]);
  const defaultLocaleCode = locales.find((l) => l.isDefault)?.code ?? lang;
  const canonical = `${SITE_URL}${withLocalePrefix("/specialties", lang, defaultLocaleCode)}`;
  const pageTitle = dict.telehealth.specialtiesPageTitle;

  const specialtyNames = specialties.map((s) => s.name);
  // Paket U (B4) — meta açıklaması dile göre (önceden her dilde Türkçe sabit metindi).
  const description =
    specialtyNames.length > 0
      ? formatSiteString(dict.telehealth.specialtiesMetaDescription, { specialties: specialtyNames.slice(0, 6).join(", ") })
      : dict.telehealth.specialtiesMetaDescriptionDefault;

  return {
    title: pageTitle,
    description,
    alternates: { canonical },
    openGraph: {
      title: pageTitle,
      description,
      type: "website",
      siteName: settings.siteName,
      url: canonical,
    },
    twitter: {
      card: "summary",
      title: pageTitle,
      description,
    },
  };
}

export default async function SpecialtiesIndexPage({ params }: SpecialtiesPageProps) {
  const { lang } = await params;
  const [allSpecialties, locales, dict, settings, bookingEnabled] = await Promise.all([
    fetchSpecialtiesServer(lang),
    fetchLocalesServer(),
    getSiteDictionary(lang),
    fetchSiteSettingsServer(),
    isServiceBookingEnabledServer(),
  ]);
  const defaultLocaleCode = locales.find((l) => l.isDefault)?.code ?? lang;
  // Paket AI: gruplu bölümler (sabit grup sırası, boş grup yok); alt uzmanlıklar üst kartta çip olur.
  const groups = groupServices(allSpecialties);
  const hasServices = topLevelSpecialties(allSpecialties).length > 0;

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
      <h1 className="font-heading text-2xl font-semibold text-foreground sm:text-3xl">{dict.telehealth.specialtiesPageTitle}</h1>
      <p className="mt-2 text-foreground/60">{dict.telehealth.specialtiesPageSubtitle}</p>

      <ServicesProcessStrip strings={dict.services} />

      {!hasServices ? (
        <EmptyState
          icon={Tag}
          title={dict.telehealth.specialtiesEmptyTitle}
          description={dict.telehealth.specialtiesEmptyDescription}
          className="mt-10"
        />
      ) : (
        <div className="mt-10 space-y-10">
          {groups.map((group) => (
            <section key={group.id} aria-labelledby={`services-group-${group.id}`} data-testid={`services-section-${group.id}`}>
              <h2 id={`services-group-${group.id}`} className="font-heading text-xl font-semibold text-foreground">
                {serviceGroupTitle(group.id, dict.services)}
              </h2>
              <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {group.items.map((item) => (
                  <ServiceCard
                    key={item.id}
                    service={item}
                    subServices={item.children}
                    strings={dict.services}
                    activeLocaleCode={lang}
                    defaultLocaleCode={defaultLocaleCode}
                    bookingEnabled={bookingEnabled}
                    callbackLabel={dict.serviceBooking.callbackLink}
                    bookCtaEnabled={resolveSiteFeatures(settings).bookConsultationCtaEnabled}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
      <IntermediaryNotice strings={dict.intermediary} certificateNo={settings.healthTourismCertificateNo} className="mt-10" />
    </div>
  );
}
