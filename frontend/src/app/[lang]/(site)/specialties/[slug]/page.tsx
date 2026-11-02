import { MatcherCtaCard } from "@/components/site/matcher/matcher-modal";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { UserRoundSearch } from "lucide-react";
import { fetchSpecialtyBySlugServer } from "@/lib/api/server-telehealth";
import { fetchLocalesServer } from "@/lib/api/server-locales";
import { fetchSiteSettingsServer } from "@/lib/api/server-settings";
import { ContactActions } from "@/components/site/contact-actions";
import { IntermediaryNotice } from "@/components/site/intermediary-notice";
import { requestFormPath } from "@/lib/intermediary";
import { withLocalePrefix } from "@/lib/i18n/site-path";
import { getSiteDictionary, formatSiteString } from "@/lib/i18n/site-dictionaries";
import { resolveIcon } from "@/lib/page-builder/icon-options";
import { buildSpecialtyBreadcrumbJsonLd, buildSpecialtyJsonLd } from "@/lib/specialty-json-ld";
import { BlogBreadcrumb } from "@/components/site/blog/blog-breadcrumb";
import Link from "next/link";
import { JsonLdScript } from "@/components/site/json-ld-script";
import { SITE_URL } from "@/lib/env";
import type { Locale } from "@/lib/api/types";
import { isServiceBookingEnabledServer } from "@/lib/api/server-service-consultations";

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
  const [specialty, locales, settings, dict] = await Promise.all([
    fetchSpecialtyBySlugServer(slug, lang),
    fetchLocalesServer(),
    fetchSiteSettingsServer(),
    getSiteDictionary(lang),
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

  const [specialty, locales, dict, settings, bookingEnabled] = await Promise.all([
    fetchSpecialtyBySlugServer(slug, lang),
    fetchLocalesServer(),
    getSiteDictionary(lang),
    fetchSiteSettingsServer(lang),
    isServiceBookingEnabledServer(),
  ]);
  if (!specialty) notFound();

  const parent = specialty.parent ?? null;
  const children = specialty.children ?? [];

  const defaultLocaleCode = locales.find((l) => l.isDefault)?.code ?? lang;
  const canonicalUrl = resolveCanonicalUrl(lang, defaultLocaleCode, slug);
  // Paket AH — ziyaretçi tarafında hekim yok: talep formu bağlantısı bu bölümü önceden seçer.
  const requestHref = `${withLocalePrefix("/request", lang, defaultLocaleCode)}?service=${encodeURIComponent(slug)}`;
  // AI İş 3 — rezervasyon açıkken birincil düğme rezervasyon sayfasına, ikincil düğme "Request a call back"e gider.
  const bookHref = bookingEnabled ? `${withLocalePrefix("/book-consultation", lang, defaultLocaleCode)}?service=${encodeURIComponent(slug)}` : requestHref;

  const specialtiesListHref = withLocalePrefix("/specialties", lang, defaultLocaleCode);
  const breadcrumbItems = parent
    ? [
        { label: dict.telehealth.breadcrumbSpecialties, href: specialtiesListHref, url: `${SITE_URL}${specialtiesListHref}` },
        {
          label: parent.name,
          href: withLocalePrefix(`/specialties/${parent.slug}`, lang, defaultLocaleCode),
          url: resolveCanonicalUrl(lang, defaultLocaleCode, parent.slug),
        },
        { label: specialty.name, href: undefined, url: canonicalUrl },
      ]
    : null;

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
      {breadcrumbItems && (
        <div className="mb-6">
          <BlogBreadcrumb items={breadcrumbItems.map(({ label, href }) => ({ label, href }))} ariaLabel={dict.ui.breadcrumb} />
        </div>
      )}
      <div className="flex items-start gap-4">
        <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
          {iconGlyph(specialty.icon, "h-7 w-7")}
        </span>
        <div>
          <h1 className="font-heading text-2xl font-semibold text-foreground sm:text-3xl">{specialty.name}</h1>
          {specialty.description && <p className="mt-2 text-foreground/60">{specialty.description}</p>}
        </div>
      </div>

      {children.length > 0 && (
        <section data-testid="specialty-procedures" aria-labelledby="specialty-procedures-title" className="mt-8">
          <h2 id="specialty-procedures-title" className="font-heading text-lg font-semibold text-foreground">
            {dict.telehealth.specialtyProceduresTitle}
          </h2>
          <ul className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {children.map((child) => (
              <li key={child.slug}>
                <Link
                  href={withLocalePrefix(`/specialties/${child.slug}`, lang, defaultLocaleCode)}
                  className="flex min-h-14 items-center gap-3 rounded-[var(--site-radius)] border border-border bg-surface px-4 py-3 text-foreground transition-colors duration-150 hover:border-primary/40 hover:bg-primary/5 focus-visible:outline-2 focus-visible:outline-primary"
                >
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                    {iconGlyph(child.icon, "h-5 w-5")}
                  </span>
                  <span className="min-w-0 flex-1 font-semibold">{child.name}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Paket AH — hekim listesi yerine talep formu çağrısı + aracı kuruluş ibaresi. */}
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
        <div className="flex flex-wrap items-center gap-3">
          <Link
            href={bookHref}
            data-testid="specialty-book-cta"
            aria-label={`${dict.services.bookConsultation}: ${specialty.name}`}
            className="inline-flex min-h-11 items-center justify-center rounded-[var(--site-radius)] bg-primary px-5 py-2.5 text-center text-sm font-semibold text-primary-foreground transition-colors duration-300 hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            {dict.services.bookConsultation}
          </Link>
          <Link
            href={requestHref}
            data-testid="specialty-request-cta"
            className="inline-flex min-h-11 items-center justify-center rounded-[var(--site-radius)] border border-primary px-5 py-2.5 text-center text-sm font-semibold text-primary transition-colors duration-300 hover:bg-primary/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            {bookingEnabled ? dict.serviceBooking.callbackLink : formatSiteString(dict.request.requestForService, { service: specialty.name })}
          </Link>
          <ContactActions
            chatEnabled={settings.liveChatEnabled === true}
            contactHref={withLocalePrefix("/contact", lang, defaultLocaleCode)}
            chatLabel={dict.common.liveChatCta}
            contactLabel={dict.common.contactUsCta}
          />
        </div>
      </section>
      <IntermediaryNotice strings={dict.intermediary} certificateNo={settings.healthTourismCertificateNo} className="mt-8" />
      {/* Paket W — eşleştirme sihirbazı. */}
      <MatcherCtaCard className="mt-10" />

      <JsonLdScript json={buildSpecialtyJsonLd(specialty, canonicalUrl)} />
      {breadcrumbItems && (
        <JsonLdScript json={buildSpecialtyBreadcrumbJsonLd(breadcrumbItems.map(({ label, url }) => ({ name: label, url })))} />
      )}
    </div>
  );
}
