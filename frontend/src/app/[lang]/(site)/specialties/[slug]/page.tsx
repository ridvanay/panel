import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { UserRoundSearch } from "lucide-react";
import { fetchSpecialtyBySlugServer, fetchDoctorsServer } from "@/lib/api/server-telehealth";
import { fetchLocalesServer } from "@/lib/api/server-locales";
import { fetchSiteSettingsServer } from "@/lib/api/server-settings";
import { DoctorCard } from "@/components/site/telehealth/doctor-card";
import { ContactActions } from "@/components/site/contact-actions";
import { withLocalePrefix } from "@/lib/i18n/site-path";
import { contentLocaleToIntl } from "@/lib/i18n/content-locale-to-intl";
import { getSiteDictionary, formatSiteString } from "@/lib/i18n/site-dictionaries";
import { resolveIcon } from "@/lib/page-builder/icon-options";
import { buildSpecialtyJsonLd } from "@/lib/specialty-json-ld";
import { JsonLdScript } from "@/components/site/json-ld-script";
import { SITE_URL } from "@/lib/env";
import type { Locale } from "@/lib/api/types";

/** `specialty-card.tsx` İLE AYNI `react-hooks/static-components` yanlış-pozitifi kaçınma deseni. */
function iconGlyph(name: string, className: string) {
  const Icon = resolveIcon(name);
  return <Icon className={className} aria-hidden="true" />;
}

/**
 * Görev (2026-09-16) — `doctors/[slug]/page.tsx` İLE AYNI desen: profil/detay sunucu bileşeninde
 * çekilir, `generateMetadata` SEO alanlarını bağlar, `schema.org/MedicalSpecialty` JSON-LD
 * `specialty-json-ld.ts`'ten render edilir.
 */
interface SpecialtyDetailPageProps {
  params: Promise<{ lang: string; slug: string }>;
}

function truncateForDescription(text: string, maxLength = 160): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxLength) return trimmed;
  return `${trimmed.slice(0, maxLength - 1).trimEnd()}…`;
}

function resolveCanonicalUrl(lang: string, defaultLocaleCode: string, slug: string): string {
  return `${SITE_URL}${withLocalePrefix(`/specialties/${slug}`, lang, defaultLocaleCode)}`;
}

/**
 * `Specialty`de `translations`/çok-dillilik YOK (§ görev notu) — dolayısıyla `.claude/architect-
 * scope-i18n.md` §6.1'in `localizations` DTO dizisinden hreflang türetme kaynağı burada YOKTUR.
 * Bu sayfanın kendisi (slug/entity İÇERİĞİ) tüm dillerde AYNIDIR — yalnızca çevresindeki site
 * kabuğu (header/footer/nav) aktif dile göre değişir; bu yüzden hreflang, AYNI slug'ı etkin HER
 * dilin kendi prefix'li URL'sine eşleyen bir "kendine referans" haritası olarak üretilir (§6.1'in
 * `x-default` zorunluluğu KORUNUR — varsayılan dilin prefix'siz URL'si).
 */
function buildSelfLanguageAlternates(locales: Locale[], defaultLocaleCode: string, slug: string): Record<string, string> {
  const languages: Record<string, string> = {};
  for (const locale of locales) {
    if (!locale.enabled) continue;
    const hreflangKey = locale.hreflang ?? locale.code;
    languages[hreflangKey] = resolveCanonicalUrl(locale.code, defaultLocaleCode, slug);
  }
  languages["x-default"] = `${SITE_URL}/specialties/${slug}`;
  return languages;
}

export async function generateMetadata({ params }: SpecialtyDetailPageProps): Promise<Metadata> {
  const { lang, slug } = await params;
  const [specialty, locales, settings, dict, doctors] = await Promise.all([
    fetchSpecialtyBySlugServer(slug, lang),
    fetchLocalesServer(),
    fetchSiteSettingsServer(),
    getSiteDictionary(lang),
    // Sayfa gövdesiyle AYNI kaynak (aynı istek, önbellekte tekilleşir): hekim listesi boşsa noindex.
    fetchDoctorsServer({ specialtySlug: slug, locale: lang }),
  ]);
  if (!specialty) return {};

  const defaultLocaleCode = locales.find((l) => l.isDefault)?.code ?? lang;
  const canonical = resolveCanonicalUrl(lang, defaultLocaleCode, slug);
  const title = specialty.name;
  const description = specialty.description
    ? truncateForDescription(specialty.description)
    : formatSiteString(dict.telehealth.specialtyMetaDescription, { specialty: specialty.name });

  return {
    title,
    description,
    // Paket V — hekimi olmayan uzmanlık sayfası yayında ama hekim atanana kadar indekslenmez
    // (sitemap'e de girmez, bkz. `lib/sitemap/build.ts`).
    ...(doctors.length === 0 ? { robots: { index: false, follow: true } } : {}),
    alternates: {
      canonical,
      languages: buildSelfLanguageAlternates(locales, defaultLocaleCode, slug),
    },
    openGraph: {
      title,
      description,
      type: "website",
      siteName: settings.siteName,
      url: canonical,
    },
    twitter: {
      card: "summary",
      title,
      description,
    },
  };
}

export default async function SpecialtyDetailPage({ params }: SpecialtyDetailPageProps) {
  const { lang, slug } = await params;

  const [specialty, doctors, locales, dict, settings] = await Promise.all([
    fetchSpecialtyBySlugServer(slug, lang),
    fetchDoctorsServer({ specialtySlug: slug, locale: lang }),
    fetchLocalesServer(),
    getSiteDictionary(lang),
    fetchSiteSettingsServer(lang),
  ]);
  if (!specialty) notFound();

  const defaultLocaleCode = locales.find((l) => l.isDefault)?.code ?? lang;
  const canonicalUrl = resolveCanonicalUrl(lang, defaultLocaleCode, slug);
  const doctorCountLabel = formatSiteString(
    specialty.doctorCount === 1 ? dict.telehealth.doctorCountOne : dict.telehealth.doctorCountOther,
    { count: specialty.doctorCount },
  );

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
      <div className="flex items-start gap-4">
        <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
          {iconGlyph(specialty.icon, "h-7 w-7")}
        </span>
        <div>
          <h1 className="font-heading text-2xl font-semibold text-foreground sm:text-3xl">{specialty.name}</h1>
          {specialty.description && <p className="mt-2 text-foreground/60">{specialty.description}</p>}
          <p className="mt-1 text-sm text-foreground/50">{doctorCountLabel}</p>
        </div>
      </div>

      {doctors.length === 0 ? (
        // Paket V — hekimi olmayan uzmanlıkta liste yerine koordinatöre yönlendirme (W paketinden
        // sonra eşleştirme sihirbazı da buraya eklenecek).
        <section
          data-testid="specialty-coordinator-box"
          aria-labelledby="specialty-coordinator-title"
          className="mt-10 flex flex-col items-start gap-4 rounded-[var(--site-radius)] border border-border bg-surface-muted/60 p-6 sm:flex-row sm:items-center sm:p-8"
        >
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
            <UserRoundSearch className="h-6 w-6" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="specialty-coordinator-title" className="font-heading text-lg font-semibold text-foreground">
              {dict.telehealth.specialtyCoordinatorTitle}
            </h2>
            <p className="mt-1 text-sm text-foreground/70">{dict.telehealth.specialtyCoordinatorText}</p>
          </div>
          <ContactActions
            chatEnabled={settings.liveChatEnabled === true}
            contactHref={withLocalePrefix("/contact", lang, defaultLocaleCode)}
            chatLabel={dict.common.liveChatCta}
            contactLabel={dict.common.contactUsCta}
          />
        </section>
      ) : (
        <div className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {doctors.map((doctor) => (
            <DoctorCard
              key={doctor.id}
              doctor={doctor}
              activeLocaleCode={lang}
              defaultLocaleCode={defaultLocaleCode}
              intlLocale={contentLocaleToIntl(lang)}
              dict={dict.telehealth}
            />
          ))}
        </div>
      )}

      <JsonLdScript json={buildSpecialtyJsonLd(specialty, canonicalUrl)} />
    </div>
  );
}
