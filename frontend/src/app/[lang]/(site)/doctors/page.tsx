import type { Metadata } from "next";
import { Stethoscope } from "lucide-react";
import { fetchDoctorsServer } from "@/lib/api/server-telehealth";
import { fetchLocalesServer } from "@/lib/api/server-locales";
import { fetchSiteSettingsServer } from "@/lib/api/server-settings";
import { DoctorCard } from "@/components/site/telehealth/doctor-card";
import { DoctorFilters } from "@/components/site/telehealth/doctor-filters";
import { EmptyState } from "@/components/ui/empty-state";
import { withLocalePrefix } from "@/lib/i18n/site-path";
import { contentLocaleToIntl } from "@/lib/i18n/content-locale-to-intl";
import { SITE_URL } from "@/lib/env";

/**
 * `.claude/architect-scope-telehealth-template.md` §5.2/§9.5 — doktor ızgarası + uzmanlık/dil
 * filtresi + arama. `generateMetadata` seo-agent tarafından eklendi (§9.5): frontend-agent'ın
 * yazdığı bileşen mantığına (render kısmı) dokunulmadı.
 */
interface DoctorsPageProps {
  params: Promise<{ lang: string }>;
  searchParams: Promise<{ specialty?: string; language?: string; q?: string }>;
}

const DOCTORS_PAGE_TITLE = "Doktorlarımız";

/**
 * `products/page.tsx::generateMetadata` ile AYNI desen: `canonical` HER ZAMAN filtresiz temel
 * `/doctors`'a işaret eder; herhangi bir filtre/arama aktifse `robots: noindex, follow` (sonsuz
 * `?specialty=`/`?language=`/`?q=` kombinasyonu duplicate content üretmesin, ama linkler takip
 * edilsin). Açıklama DB'den (yayınlanmış doktorların uzmanlıklarından) türetilir — tıbbi iddia
 * İÇERMEZ, yalnızca uzmanlık adlarının jenerik bir listesidir (mimar "Kurallar" madde 1/2).
 */
export async function generateMetadata({ params, searchParams }: DoctorsPageProps): Promise<Metadata> {
  const { lang } = await params;
  const [rawSearchParams, locales, settings, unfilteredDoctors] = await Promise.all([
    searchParams,
    fetchLocalesServer(),
    fetchSiteSettingsServer(),
    fetchDoctorsServer({}),
  ]);
  const defaultLocaleCode = locales.find((l) => l.isDefault)?.code ?? lang;
  const canonical = `${SITE_URL}${withLocalePrefix("/doctors", lang, defaultLocaleCode)}`;
  const isFiltered = Boolean(rawSearchParams.specialty || rawSearchParams.language || rawSearchParams.q);

  const specialtyNames = Array.from(
    new Set(unfilteredDoctors.filter((d) => d.specialty).map((d) => d.specialty!.name))
  ).sort((a, b) => a.localeCompare(b, "tr"));

  const description =
    specialtyNames.length > 0
      ? `${specialtyNames.slice(0, 6).join(", ")} gibi uzmanlık alanlarında doktorlarımızla online randevu alın.`
      : "Doktorlarımızla online randevu alın.";

  return {
    title: DOCTORS_PAGE_TITLE,
    description,
    alternates: { canonical },
    openGraph: {
      title: DOCTORS_PAGE_TITLE,
      description,
      type: "website",
      siteName: settings.siteName,
      url: canonical,
    },
    twitter: {
      card: "summary",
      title: DOCTORS_PAGE_TITLE,
      description,
    },
    ...(isFiltered ? { robots: { index: false, follow: true } } : {}),
  };
}

export default async function DoctorsIndexPage({ params, searchParams }: DoctorsPageProps) {
  const { lang } = await params;
  const { specialty, language, q } = await searchParams;

  const [doctors, unfilteredDoctors, locales] = await Promise.all([
    fetchDoctorsServer({ specialtySlug: specialty, language, search: q }),
    // Filtre seçeneklerini (uzmanlık listesi) oluşturmak için — public bir `/specialties` ucu
    // YOKTUR (§3.2 — tek FK, ayrı bir uç açılmadı), bu yüzden mevcut doktorlardan türetilir.
    fetchDoctorsServer({}),
    fetchLocalesServer(),
  ]);

  const defaultLocaleCode = locales.find((l) => l.isDefault)?.code ?? lang;

  const specialtyOptions = Array.from(
    new Map(
      unfilteredDoctors
        .filter((d) => d.specialty)
        .map((d) => [d.specialty!.slug, { slug: d.specialty!.slug, name: d.specialty!.name }])
    ).values()
  ).sort((a, b) => a.name.localeCompare(b.name, "tr"));

  const languageOptions = Array.from(new Set(unfilteredDoctors.flatMap((d) => d.languages))).sort();

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
      <h1 className="font-heading text-2xl font-semibold text-foreground sm:text-3xl">Doktorlarımız</h1>
      <p className="mt-2 text-foreground/60">Uzmanına göre filtreleyin, uygun saati seçin ve online randevunuzu alın.</p>

      <div className="mt-6">
        <DoctorFilters
          specialtyOptions={specialtyOptions}
          languageOptions={languageOptions}
          activeSpecialty={specialty}
          activeLanguage={language}
          activeSearch={q}
        />
      </div>

      {doctors.length === 0 ? (
        <EmptyState
          icon={Stethoscope}
          title="Sonuç bulunamadı"
          description="Bu filtrelerle eşleşen bir doktor yok. Filtreleri değiştirmeyi deneyin."
          className="mt-10"
        />
      ) : (
        <div className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {doctors.map((doctor) => (
            <DoctorCard
              key={doctor.id}
              doctor={doctor}
              activeLocaleCode={lang}
              defaultLocaleCode={defaultLocaleCode}
              intlLocale={contentLocaleToIntl(lang)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
