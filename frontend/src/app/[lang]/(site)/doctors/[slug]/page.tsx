import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { fetchDoctorBySlugServer, fetchDoctorSlotsServer } from "@/lib/api/server-telehealth";
import { fetchLocalesServer } from "@/lib/api/server-locales";
import { fetchSiteSettingsServer } from "@/lib/api/server-settings";
import { fetchPublishedPagesServer } from "@/lib/api/server-pages";
import { resolveKvkkNoticePage } from "@/lib/legal-pages";
import { DoctorProfileHero } from "@/components/site/telehealth/doctor-profile-hero";
import { DoctorPricePanel } from "@/components/site/telehealth/doctor-price-panel";
import { EmergencyNoticeCard } from "@/components/site/telehealth/emergency-notice";
import { AvailabilityCalendar } from "@/components/site/telehealth/availability-calendar";
import { withLocalePrefix } from "@/lib/i18n/site-path";
import { contentLocaleToIntl } from "@/lib/i18n/content-locale-to-intl";
import { buildDoctorJsonLd } from "@/lib/doctor-json-ld";
import { JsonLdScript } from "@/components/site/json-ld-script";
import { SITE_URL } from "@/lib/env";

/**
 * `.claude/architect-scope-telehealth-template.md` §5.2/§9.5 — doktor profili + saat dilimi
 * duyarlı slot takvimi + randevu formu. `generateMetadata` + `schema.org/Physician` JSON-LD
 * seo-agent tarafından eklendi (§9.5); frontend-agent'ın yazdığı render mantığına dokunulmadı.
 * Acil durum uyarı şeridi zaten `doctors/layout.tsx`'te (§9.1); burada yalnızca §9.2'nin
 * booking-anı tekrarı (`EmergencyNoticeCard`) render edilir.
 */
interface DoctorDetailPageProps {
  params: Promise<{ lang: string; slug: string }>;
}

/** Meta açıklaması için 160 karakter sınırı — arama motoru snippet uzunluğu emsali. */
function truncateForDescription(text: string, maxLength = 160): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxLength) return trimmed;
  return `${trimmed.slice(0, maxLength - 1).trimEnd()}…`;
}

function resolveCanonicalUrl(lang: string, defaultLocaleCode: string, slug: string): string {
  return `${SITE_URL}${withLocalePrefix(`/doctors/${slug}`, lang, defaultLocaleCode)}`;
}

/**
 * `DoctorProfile`'da `Product`/`Page` gibi `seoTitle`/`seoDescription`/`ogTitle`/`ogImageUrl`/
 * `canonicalUrl`/`noIndex` alanları YOKTUR (§3.8 — doktor profili `ContentSlug`/SEO-override
 * sistemine dahil değil); bu yüzden `lib/seo.ts::buildContentMetadata` burada KULLANILMAZ,
 * alanlar doğrudan DB'den gelen `DoctorProfile` alanlarından (ad/unvan/uzmanlık/bio/avatar)
 * kurulur. Tıbbi iddia içeren hiçbir alan üretilmez (mimar "Kurallar" madde 1/2).
 */
export async function generateMetadata({ params }: DoctorDetailPageProps): Promise<Metadata> {
  const { lang, slug } = await params;
  const [doctor, locales, settings] = await Promise.all([
    fetchDoctorBySlugServer(slug),
    fetchLocalesServer(),
    fetchSiteSettingsServer(),
  ]);
  if (!doctor) return {};

  const defaultLocaleCode = locales.find((l) => l.isDefault)?.code ?? lang;
  const canonical = resolveCanonicalUrl(lang, defaultLocaleCode, slug);
  const title = `${doctor.title} ${doctor.fullName}${doctor.specialty ? ` | ${doctor.specialty.name}` : ""}`.trim();
  const description = truncateForDescription(doctor.bio);
  const images = doctor.avatarMedia?.url ? [doctor.avatarMedia.url] : undefined;

  return {
    title,
    description,
    alternates: { canonical },
    openGraph: {
      title,
      description,
      type: "profile",
      siteName: settings.siteName,
      url: canonical,
      images,
    },
    twitter: {
      card: images ? "summary_large_image" : "summary",
      title,
      description,
      images,
    },
  };
}

/** `GET /doctors/{slug}/slots` en fazla 31 günlük aralık kabul eder (mimari §4.2) — bugünden +30 gün. */
function defaultSlotRange(): { from: string; to: string } {
  const from = new Date();
  const to = new Date(from);
  to.setUTCDate(to.getUTCDate() + 30);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

export default async function DoctorDetailPage({ params }: DoctorDetailPageProps) {
  const { lang, slug } = await params;
  const { from, to } = defaultSlotRange();

  const [doctor, locales, pages, slots] = await Promise.all([
    fetchDoctorBySlugServer(slug),
    fetchLocalesServer(),
    fetchPublishedPagesServer(lang),
    fetchDoctorSlotsServer(slug, from, to),
  ]);
  if (!doctor) notFound();

  const defaultLocaleCode = locales.find((l) => l.isDefault)?.code ?? lang;
  const kvkkPage = resolveKvkkNoticePage(pages);
  const canonicalUrl = resolveCanonicalUrl(lang, defaultLocaleCode, slug);

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      {/* `.claude/design-notes-telehealth.md` §2.1.1 — iki sütun + sticky yan panel. `320px` sabit
          sağ sütun, `product-purchase-panel.tsx`'in `lg:sticky lg:top-24 lg:self-start` deseniyle
          BİREBİR aynı offset. */}
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr_320px] lg:items-start">
        <div className="min-w-0">
          <DoctorProfileHero doctor={doctor} />

          <section className="mt-10 max-w-prose space-y-3">
            <h2 className="text-xl font-semibold text-foreground">Hakkında</h2>
            <p className="whitespace-pre-line text-base leading-7 text-foreground/80">{doctor.bio}</p>
          </section>

          <section id="randevu" className="mt-10 scroll-mt-24">
            <h2 className="text-xl font-semibold text-foreground">Müsaitlik ve Randevu</h2>
            <div className="mt-4">
              <EmergencyNoticeCard />
            </div>
            <div className="mt-4">
              <AvailabilityCalendar
                doctorSlug={doctor.slug}
                doctorTimeZone={doctor.timeZone}
                lang={lang}
                defaultLocaleCode={defaultLocaleCode}
                initialSlots={slots}
                kvkkPage={kvkkPage}
              />
            </div>
          </section>
        </div>

        <aside className="lg:sticky lg:top-24 lg:self-start">
          <DoctorPricePanel
            sessionPriceCents={doctor.sessionPriceCents}
            sessionDurationMin={doctor.sessionDurationMin}
            currency={doctor.currency}
            ctaHref="#randevu"
            intlLocale={contentLocaleToIntl(lang)}
          />
        </aside>
      </div>

      <JsonLdScript json={buildDoctorJsonLd(doctor, canonicalUrl)} />
    </div>
  );
}
