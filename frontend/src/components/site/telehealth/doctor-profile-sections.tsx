import type { ReactNode } from "react";
import type { DoctorProfile, DoctorReviewsResponse, DoctorShowcase } from "@/lib/api/types";
import type { ReviewsStrings } from "@/lib/i18n/site-dictionaries/en/reviews";
import type { CommonStrings, TelehealthStrings } from "@/lib/i18n/site-dictionaries";
import type { ResolvedLanguageSupport } from "@/lib/language-support";
import { SupportBadge } from "@/components/site/support/support-badge";
import { CvTimeline, PublicationsList } from "@/components/site/telehealth/doctor-profile-tabs";
import { DoctorProcedures } from "@/components/site/telehealth/doctor-procedures";
import { DoctorMediaGallery } from "@/components/site/telehealth/doctor-media-gallery";
import { DoctorProfileTabset, type DoctorSectionNavItem } from "@/components/site/telehealth/doctor-section-nav";
import { DoctorOverviewPanel } from "@/components/site/telehealth/doctor-overview-panel";
import { DoctorReviewsSection } from "@/components/site/reviews/doctor-reviews-section";
import { Fragment } from "react";

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

interface DoctorProfileSectionsProps extends SectionInput {
  lang: string;
  telehealthDict: TelehealthStrings;
  commonDict: CommonStrings;
  support: ResolvedLanguageSupport | null;
}

/**
 * Paket AE — hekim profilinin sekmeli düzeni: Genel bakış · Tedaviler · Foto/Video · Deneyim ve yayınlar · Yorumlar · SSS.
 * Boş sekmeler oluşmaz. Aynı anda tek panel görünür; tüm panellerin içeriği HTML'de kalır (`hidden`, SEO).
 */
export function DoctorProfileSections({ doctor, showcase, reviews, dict, telehealthDict, commonDict, support }: DoctorProfileSectionsProps) {
  const sections = resolveProfileSections({ doctor, showcase, reviews, dict });
  const has = (id: ProfileSectionId) => sections.some((s) => s.id === id);
  const faq = doctor.faq ?? [];
  const latestReviews = [...(reviews?.items ?? [])].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));

  const content: Record<ProfileSectionId, () => ReactNode> = {
    overview: () => (
      <DoctorOverviewPanel
        doctor={doctor}
        media={showcase.media}
        latestReviews={latestReviews}
        dict={dict}
        telehealthDict={telehealthDict}
        supportSlot={<SupportBadge support={support} label={commonDict.supportBadge} />}
      />
    ),
    treatments: () => <DoctorProcedures procedures={showcase.procedures} dict={dict} />,
    media: () => <DoctorMediaGallery media={showcase.media} telehealthDict={telehealthDict} />,
    experience: () => (
      <div className="space-y-8">
        {doctor.cvEntries.length > 0 && (
          <div>
            <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-foreground/50">{telehealthDict.tabCv}</h3>
            <CvTimeline entries={doctor.cvEntries} dict={telehealthDict} />
          </div>
        )}
        {doctor.publications.length > 0 && (
          <div>
            <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-foreground/50">
              {telehealthDict.tabPublications} ({doctor.publications.length})
            </h3>
            <PublicationsList publications={doctor.publications} dict={telehealthDict} />
          </div>
        )}
      </div>
    ),
    reviews: () => (reviews ? <DoctorReviewsSection slug={doctor.slug} initial={reviews} /> : null),
    faq: () => (
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
    ),
  };

  return <DoctorProfileTabset ariaLabel={dict.sectionNavAria} tabs={sections.filter((s) => has(s.id)).map((s) => ({ id: s.id, label: s.label, content: <Fragment key={s.id}>{content[s.id]()}</Fragment> }))} />;
}
