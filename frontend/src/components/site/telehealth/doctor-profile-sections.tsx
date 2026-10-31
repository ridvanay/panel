import type { ReactNode } from "react";
import { Building2, Languages, Stethoscope } from "lucide-react";
import type { DoctorProfile, DoctorReviewsResponse, DoctorShowcase } from "@/lib/api/types";
import type { ReviewsStrings } from "@/lib/i18n/site-dictionaries/en/reviews";
import type { CommonStrings, TelehealthStrings } from "@/lib/i18n/site-dictionaries";
import type { ResolvedLanguageSupport } from "@/lib/language-support";
import { contentLocaleToIntl } from "@/lib/i18n/content-locale-to-intl";
import { Badge } from "@/components/ui/badge";
import { SupportBadge } from "@/components/site/support/support-badge";
import { CvTimeline, PublicationsList } from "@/components/site/telehealth/doctor-profile-tabs";
import { DoctorProcedures } from "@/components/site/telehealth/doctor-procedures";
import { DoctorMediaGallery } from "@/components/site/telehealth/doctor-media-gallery";
import { DoctorSectionNav, type DoctorSectionNavItem } from "@/components/site/telehealth/doctor-section-nav";
import { DoctorReviewsSection } from "@/components/site/reviews/doctor-reviews-section";

export type ProfileSectionId = "overview" | "treatments" | "media" | "experience" | "reviews" | "faq";

interface SectionInput {
  doctor: DoctorProfile;
  showcase: DoctorShowcase;
  reviews: DoctorReviewsResponse | null;
  dict: ReviewsStrings;
}

/**
 * Paket Y — hangi bölümlerin gösterileceği. BOŞ BÖLÜM GÖSTERİLMEZ: işlem/medya/CV-yayın/yorum/SSS yoksa ilgili
 * bölüm ve çubuk öğesi hiç oluşmaz. Genel Bakış, kısa özet (`bio`) ya da uzun biyografi varsa vardır.
 */
export function resolveProfileSections({ doctor, showcase, reviews, dict }: SectionInput): (DoctorSectionNavItem & { id: ProfileSectionId })[] {
  const sections: (DoctorSectionNavItem & { id: ProfileSectionId })[] = [];
  const hasOverview =
    Boolean(doctor.bio?.trim()) || Boolean(doctor.aboutHtml) || doctor.languages.length > 0 || Boolean(doctor.hospitalName?.trim()) || Boolean(doctor.specialty?.name);
  if (hasOverview) sections.push({ id: "overview", label: dict.sectionOverview });
  if (showcase.procedures.length > 0) sections.push({ id: "treatments", label: dict.sectionTreatments });
  if (showcase.media.length > 0) sections.push({ id: "media", label: dict.sectionMedia });
  if (doctor.cvEntries.length > 0 || doctor.publications.length > 0) sections.push({ id: "experience", label: dict.sectionExperience });
  if (reviews && (reviews.summary.count > 0 || reviews.items.length > 0)) sections.push({ id: "reviews", label: dict.sectionReviews });
  if ((doctor.faq ?? []).length > 0) sections.push({ id: "faq", label: dict.sectionFaq });
  return sections;
}

function Section({ id, title, children }: { id: ProfileSectionId; title: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-heading`} className="scroll-mt-28 space-y-4 lg:scroll-mt-44">
      <h2 id={`${id}-heading`} className="text-xl font-semibold text-foreground">
        {title}
      </h2>
      {children}
    </section>
  );
}

interface DoctorProfileSectionsProps extends SectionInput {
  lang: string;
  telehealthDict: TelehealthStrings;
  commonDict: CommonStrings;
  support: ResolvedLanguageSupport | null;
}

/**
 * Paket Y — hekim profilinin yeni bölümlü düzeni (Overview, Treatments & Procedures, Photos & Videos,
 * Experience & Publications, Patient Reviews, FAQ). Eski sekmeli `DoctorProfileTabs` yerine kullanılır.
 */
export function DoctorProfileSections({ doctor, showcase, reviews, dict, lang, telehealthDict, commonDict, support }: DoctorProfileSectionsProps) {
  const sections = resolveProfileSections({ doctor, showcase, reviews, dict });
  const has = (id: ProfileSectionId) => sections.some((s) => s.id === id);

  let languageNames: Intl.DisplayNames | null = null;
  try {
    languageNames = new Intl.DisplayNames([contentLocaleToIntl(lang)], { type: "language" });
  } catch {
    languageNames = null;
  }
  const hospital = doctor.hospitalName?.trim();
  const faq = doctor.faq ?? [];

  return (
    <div className="space-y-10">
      <DoctorSectionNav items={sections} ariaLabel={dict.sectionNavAria} />

      {has("overview") && (
        <Section id="overview" title={dict.sectionOverview}>
          <div className="space-y-6">
            {doctor.bio?.trim() && <p className="whitespace-pre-line text-base leading-7 text-foreground/80">{doctor.bio}</p>}

            {doctor.aboutHtml && (
              // `aboutHtml` `lib/html-sanitize.ts`'ten GEÇMİŞ, GÜVENİLİR HTML'dir (bkz. `doctor-profile-tabs.tsx`); yeniden sanitize EDİLMEZ.
              <div
                className="max-w-prose space-y-3 text-sm leading-7 text-foreground/80 [&_a]:text-primary [&_a]:underline [&_a]:underline-offset-4 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-foreground [&_h3]:text-base [&_h3]:font-semibold [&_h3]:text-foreground [&_ol]:list-decimal [&_ol]:ps-5 [&_strong]:font-semibold [&_strong]:text-foreground [&_ul]:list-disc [&_ul]:ps-5"
                dangerouslySetInnerHTML={{ __html: doctor.aboutHtml }}
              />
            )}

            <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {doctor.specialty?.name && (
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wider text-foreground/50">{dict.overviewSpecialty}</dt>
                  <dd className="mt-1 flex flex-wrap items-center gap-2">
                    <Badge tone="primary" size="lg" className="gap-1.5">
                      <Stethoscope className="h-4 w-4" aria-hidden="true" />
                      {doctor.specialty.name}
                    </Badge>
                    {doctor.subSpecialty && <span className="text-sm text-foreground/70">{doctor.subSpecialty}</span>}
                  </dd>
                </div>
              )}
              {hospital && (
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wider text-foreground/50">{dict.overviewHospital}</dt>
                  <dd className="mt-1 flex items-center gap-2 text-sm text-foreground/80">
                    <Building2 className="h-4 w-4 shrink-0 text-foreground/50" aria-hidden="true" />
                    {hospital}
                  </dd>
                </div>
              )}
              {doctor.languages.length > 0 && (
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wider text-foreground/50">{dict.overviewLanguages}</dt>
                  <dd className="mt-1 flex items-start gap-2 text-sm text-foreground/80">
                    <Languages className="mt-0.5 h-4 w-4 shrink-0 text-foreground/50" aria-hidden="true" />
                    {doctor.languages.map((code) => languageNames?.of(code) ?? code.toUpperCase()).join(", ")}
                  </dd>
                </div>
              )}
            </dl>

            <SupportBadge support={support} label={commonDict.supportBadge} />
          </div>
        </Section>
      )}

      {has("treatments") && (
        <Section id="treatments" title={dict.sectionTreatments}>
          <DoctorProcedures procedures={showcase.procedures} dict={dict} />
        </Section>
      )}

      {has("media") && (
        <Section id="media" title={dict.sectionMedia}>
          <DoctorMediaGallery media={showcase.media} />
        </Section>
      )}

      {has("experience") && (
        <Section id="experience" title={dict.sectionExperience}>
          <div className="space-y-8">
            {doctor.cvEntries.length > 0 && (
              <div>
                <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-foreground/50">{telehealthDict.tabCv}</h3>
                <CvTimeline entries={doctor.cvEntries} dict={telehealthDict} />
              </div>
            )}
            {doctor.publications.length > 0 && (
              <div>
                <h3 className="mb-2 text-sm font-semibold uppercase tracking-wider text-foreground/50">{telehealthDict.tabPublications}</h3>
                <PublicationsList publications={doctor.publications} dict={telehealthDict} />
              </div>
            )}
          </div>
        </Section>
      )}

      {has("reviews") && reviews && (
        <Section id="reviews" title={dict.sectionReviews}>
          <DoctorReviewsSection slug={doctor.slug} initial={reviews} />
        </Section>
      )}

      {has("faq") && (
        <Section id="faq" title={dict.sectionFaq}>
          <div className="space-y-3">
            {faq.map((item, index) => (
              <details key={index} className="group rounded-[var(--site-radius)] border border-border bg-surface">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-[var(--site-radius)] px-4 py-3 text-base font-semibold text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
                  {item.question}
                  <span aria-hidden="true" className="text-foreground/50 transition-transform duration-300 group-open:rotate-45">
                    +
                  </span>
                </summary>
                <p className="whitespace-pre-line border-t border-border px-4 py-3 text-sm leading-7 text-foreground/80">{item.answer}</p>
              </details>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}
