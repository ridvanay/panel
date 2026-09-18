import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { fetchDoctorBySlugServer, fetchDoctorSlotsServer } from "@/lib/api/server-telehealth";
import { fetchLocalesServer } from "@/lib/api/server-locales";
import { fetchSiteSettingsServer } from "@/lib/api/server-settings";
import { fetchPublishedPagesServer } from "@/lib/api/server-pages";
import { resolveKvkkNoticePage } from "@/lib/legal-pages";
import { DoctorProfileHero } from "@/components/site/telehealth/doctor-profile-hero";
import { DoctorProfileTabs } from "@/components/site/telehealth/doctor-profile-tabs";
import { DoctorQuickBookingCard } from "@/components/site/telehealth/doctor-quick-booking-card";
import { BookingSelectionProvider } from "@/components/site/telehealth/booking-selection-context";
import { EmergencyNoticeCard } from "@/components/site/telehealth/emergency-notice";
import { BookingWizard } from "@/components/site/telehealth/booking-wizard";
import { withLocalePrefix } from "@/lib/i18n/site-path";
import { contentLocaleToIntl } from "@/lib/i18n/content-locale-to-intl";
import { getSiteDictionary } from "@/lib/i18n/site-dictionaries";
import { buildDoctorJsonLd } from "@/lib/doctor-json-ld";
import { JsonLdScript } from "@/components/site/json-ld-script";
import { SITE_URL, toPublicMediaUrl } from "@/lib/env";
import type { Locale } from "@/lib/api/types";

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
 * qa-agent bulgusu (2026-09-16) — `alternates.languages` hiç üretilmiyordu. `DoctorProfile`'da
 * (`lib/api/types.ts`) `Specialty` İLE AYNI durum: `translations`/`localizations` alanı YOKTUR
 * (§3.8 — doktor profili `ContentSlug`/i18n sistemine dahil değil), dolayısıyla `.claude/architect-
 * scope-i18n.md` §6.1'in `localizations` DTO dizisinden hreflang türetme kaynağı burada da YOKTUR.
 * `specialties/[slug]/page.tsx::buildSelfLanguageAlternates` İLE BİREBİR AYNI "kendine referans"
 * deseni: sayfa İÇERİĞİ (doktor profili) tüm dillerde AYNIDIR, yalnızca site kabuğu aktif dile göre
 * değişir — bu yüzden AYNI slug her aktif dilin kendi prefix'li URL'sine eşlenir, `x-default`
 * varsayılan dilin prefix'siz URL'südür.
 */
function buildSelfLanguageAlternates(locales: Locale[], defaultLocaleCode: string, slug: string): Record<string, string> {
  const languages: Record<string, string> = {};
  for (const locale of locales) {
    if (!locale.enabled) continue;
    const hreflangKey = locale.hreflang ?? locale.code;
    languages[hreflangKey] = resolveCanonicalUrl(locale.code, defaultLocaleCode, slug);
  }
  languages["x-default"] = `${SITE_URL}/doctors/${slug}`;
  return languages;
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
  // `toPublicMediaUrl` — bkz. `lib/env.ts` başlık yorumu: `fetchDoctorBySlugServer` Docker'da
  // `toInternalMediaUrl` uyguladığından `doctor.avatarMedia.url` internal (`backend:4000` gibi)
  // bir host taşıyor olabilir; og:image dış sosyal paylaşım bot'larının DOĞRUDAN erişmesi gereken
  // GERÇEK genel URL'i taşımalıdır.
  const publicAvatarUrl = toPublicMediaUrl(doctor.avatarMedia?.url);
  const images = publicAvatarUrl ? [publicAvatarUrl] : undefined;

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

  const [doctor, locales, pages, slots, dict] = await Promise.all([
    fetchDoctorBySlugServer(slug),
    fetchLocalesServer(),
    fetchPublishedPagesServer(lang),
    fetchDoctorSlotsServer(slug, from, to),
    getSiteDictionary(lang),
  ]);
  if (!doctor) notFound();

  const defaultLocaleCode = locales.find((l) => l.isDefault)?.code ?? lang;
  const kvkkPage = resolveKvkkNoticePage(pages);
  const canonicalUrl = resolveCanonicalUrl(lang, defaultLocaleCode, slug);

  /* Grid görevi (2026-09-14) Görev 2a — `DoctorQuickBookingCard`'ın "En erken müsait tarih"
   * gösterimi İÇİN, `BookingWizard`'a ZATEN geçirilen AYNI `slots` dizisinden BAĞIMSIZ, basit bir
   * türetme. `availability-calendar.tsx`'in kendi (dışa aktarılmamış) `earliestAvailableDayKey`
   * mantığı KOPYALANMAZ/DEĞİŞTİRİLMEZ — bu SADECE bir gösterim alanı. */
  const earliestAvailableIso =
    slots
      .filter((slot) => slot.available)
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt))[0]?.startsAt ?? null;

  return (
    <>
      {/* `.claude/design-notes-doctor-portfolio-console.md` §1.1 — koyu lacivert kurumsal başlık
          bandı, [TDN] §2.1.2'yi SUPERSEDE eder. Zemin `secondaryColor` (ZATEN kurulu kök token),
          edge-to-edge tam genişlik (`.site-scope` konteynerinin DIŞINA taşar), içerik AYNI
          `max-w-7xl` konteyner genişliği (Grid görevi 2026-09-14 — `max-w-5xl`'den genişletildi,
          `BookingWizard`'ın 12 kolonluk gridine daha ferah bir alan sağlamak için). */}
      <div className="w-full bg-[var(--site-secondary)]">
        <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 sm:py-14">
          <DoctorProfileHero doctor={doctor} dict={dict.telehealth} lang={lang} />
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
        {/* Grid görevi (2026-09-14) Görev 1 — eski iki-sütun (takvim solda/hizmet özeti sağda,
            AYRI "Randevu Al" ANKOR + AYRI "Randevu Oluştur" SUBMIT butonlu) yapı `BookingWizard`'a
            (`booking-wizard.tsx`) DEVREDİLDİ — kurumsal, TEK butonlu, 5 adımlı numaralandırılmış
            sihirbaz (`BookingStepperBar`, ui-designer). `BookingSelectionProvider` DEĞİŞMEDİ —
            sihirbazın İÇİNDEKİ takvim adımı ile sağ sticky özet paneli hâlâ KARDEŞ ağaçlar (Context
            paylaşımı gerekir). */}
        <BookingSelectionProvider doctorTimeZone={doctor.timeZone}>
          {/* `.claude/design-notes-doctor-portfolio-console.md` §1.2/§1.3 — hero içeriği bandın
              içine taşındığı için İLK eleman artık Tab çubuğudur. Grid görevi (2026-09-14) Görev 2a
              — eski tek-kolon yapı (sağda BOŞLUK) 12-kolonlu 2-sütun yapıya genişletildi: sol
              (lg:col-span-8) sekmeler, sağ (lg:col-span-4) sticky "Hızlı Randevu" önizleme kartı.
              `<section id="randevu">` (EmergencyNoticeCard + BookingWizard, KENDİ 12-kolonlu iç
              grid'iyle) BU grid'in DIŞINDA/ALTINDA kalır — SIRALI iki AYRI bölüm, İÇ İÇE grid
              DEĞİL.

              qa-agent bulgusu (2026-09-14, iki turda düzeltildi) — `lg:sticky`'i İÇ İÇE bir
              wrapper `<div>`'e koymak (ilk deneme) YETERSİZDİ: o wrapper'ın kendi kutusu kartın
              doğal yüksekliğine eşitti, sticky'nin "kayma payı" neredeyse sıfır kalıyordu. Doğru
              desen `booking-wizard.tsx`'in KENDİ `<aside>`'iyle BİREBİR AYNI: `lg:sticky`/`lg:top-6`/
              `lg:self-start` GRİD ÖĞESİNİN (`<aside>`) KENDİSİNE uygulanır, ara wrapper YOK —
              `lg:self-start` aside'ın grid satırının tam yüksekliğine ESNEMESİNİ (stretch)
              engelleyip KENDİ içerik yüksekliğine sahip olmasını sağlar, `lg:sticky` de bu kutunun
              üstünde çalışır; dış grid'in `lg:items-start`'ı bununla TUTARLI (redundant ama zararsız,
              `booking-wizard.tsx`'te de İKİSİ BİRLİKTE var). */}
          <div className="grid grid-cols-1 gap-8 lg:grid-cols-12 lg:items-start">
            <div className="lg:col-span-8">
              <DoctorProfileTabs doctor={doctor} dict={dict.telehealth} />
            </div>
            <aside className="lg:col-span-4 lg:sticky lg:top-6 lg:self-start">
              <DoctorQuickBookingCard
                doctor={doctor}
                earliestAvailableIso={earliestAvailableIso}
                intlLocale={contentLocaleToIntl(lang)}
                dict={dict.telehealth}
              />
            </aside>
          </div>

          <section id="randevu" className="mt-10 scroll-mt-24">
            <h2 className="text-xl font-semibold text-foreground">{dict.telehealth.availabilityAndBookingTitle}</h2>
            <div className="mt-4">
              <EmergencyNoticeCard text={dict.telehealth.emergencyNotice} />
            </div>
            <div className="mt-4">
              <BookingWizard
                doctor={doctor}
                doctorSlug={doctor.slug}
                doctorTimeZone={doctor.timeZone}
                lang={lang}
                defaultLocaleCode={defaultLocaleCode}
                initialSlots={slots}
                kvkkPage={kvkkPage}
                intlLocale={contentLocaleToIntl(lang)}
              />
            </div>
          </section>
        </BookingSelectionProvider>

        <JsonLdScript json={buildDoctorJsonLd(doctor, canonicalUrl)} />
      </div>
    </>
  );
}
