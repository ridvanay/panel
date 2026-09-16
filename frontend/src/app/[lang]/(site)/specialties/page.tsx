import type { Metadata } from "next";
import { Tag } from "lucide-react";
import { fetchSpecialtiesServer } from "@/lib/api/server-telehealth";
import { fetchLocalesServer } from "@/lib/api/server-locales";
import { fetchSiteSettingsServer } from "@/lib/api/server-settings";
import { SpecialtyCard } from "@/components/site/telehealth/specialty-card";
import { EmptyState } from "@/components/ui/empty-state";
import { withLocalePrefix } from "@/lib/i18n/site-path";
import { getSiteDictionary } from "@/lib/i18n/site-dictionaries";
import { SITE_URL } from "@/lib/env";

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
    fetchSpecialtiesServer(),
    getSiteDictionary(lang),
  ]);
  const defaultLocaleCode = locales.find((l) => l.isDefault)?.code ?? lang;
  const canonical = `${SITE_URL}${withLocalePrefix("/specialties", lang, defaultLocaleCode)}`;
  const pageTitle = dict.telehealth.specialtiesPageTitle;

  const specialtyNames = specialties.map((s) => s.name);
  const description =
    specialtyNames.length > 0
      ? `${specialtyNames.slice(0, 6).join(", ")} gibi uzmanlık alanlarında doktorlarımızı keşfedin.`
      : "Uzmanlık alanlarımızı keşfedin ve online randevu alın.";

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
  const [specialties, locales, dict] = await Promise.all([fetchSpecialtiesServer(), fetchLocalesServer(), getSiteDictionary(lang)]);
  const defaultLocaleCode = locales.find((l) => l.isDefault)?.code ?? lang;

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
      <h1 className="font-heading text-2xl font-semibold text-foreground sm:text-3xl">{dict.telehealth.specialtiesPageTitle}</h1>
      <p className="mt-2 text-foreground/60">{dict.telehealth.specialtiesPageSubtitle}</p>

      {specialties.length === 0 ? (
        <EmptyState
          icon={Tag}
          title={dict.telehealth.specialtiesEmptyTitle}
          description={dict.telehealth.specialtiesEmptyDescription}
          className="mt-10"
        />
      ) : (
        <div className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {specialties.map((specialty) => (
            <SpecialtyCard
              key={specialty.id}
              specialty={specialty}
              activeLocaleCode={lang}
              defaultLocaleCode={defaultLocaleCode}
            />
          ))}
        </div>
      )}
    </div>
  );
}
