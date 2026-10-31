import { Briefcase, FileText, Languages, Scissors, Star } from "lucide-react";
import type { ReactNode } from "react";
import type { DoctorProfile, ReviewSummary } from "@/lib/api/types";
import type { TelehealthStrings } from "@/lib/i18n/site-dictionaries";
import { formatSiteString } from "@/lib/i18n/site-dictionaries";

/** Puan ortalaması yalnızca en az 3 onaylı yorum varsa gösterilir (uydurma sosyal kanıt koruması). */
export const MIN_REVIEWS_FOR_RATING = 3;

export function resolveRatingFact(summary: ReviewSummary | null | undefined): { average: number; count: number } | null {
  if (!summary || summary.average === null || summary.count < MIN_REVIEWS_FOR_RATING) return null;
  return { average: summary.average, count: summary.count };
}

interface DoctorKeyFactsProps {
  doctor: DoctorProfile;
  dict: TelehealthStrings;
  languagesFullLabel: string;
  procedureCount?: number;
  reviewSummary?: ReviewSummary | null;
}

function Fact({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/10 text-white/80" aria-hidden="true">
        {icon}
      </span>
      <div className="min-w-0">
        <dt className="text-[11px] font-medium uppercase tracking-wider text-white/60">{label}</dt>
        <dd className="text-sm font-semibold text-white">{children}</dd>
      </div>
    </div>
  );
}

/**
 * Paket AE — hero altındaki "Önemli bilgiler" şeridi: deneyim yılı, diller, yayın sayısı, işlem sayısı, puan ortalaması.
 * Yalnızca verisi olan öğeler gösterilir. Koyu zemin kuralı: metin daima beyaz tonları.
 */
export function DoctorKeyFacts({ doctor, dict, languagesFullLabel, procedureCount = 0, reviewSummary }: DoctorKeyFactsProps) {
  const rating = resolveRatingFact(reviewSummary);
  const publicationCount = doctor.publications.length;
  const hasAny = doctor.experienceYears != null || doctor.languages.length > 0 || publicationCount > 0 || procedureCount > 0 || rating !== null;
  if (!hasAny) return null;

  return (
    <section aria-label={dict.keyFactsTitle} data-testid="doctor-key-facts" className="mt-5 rounded-[var(--site-radius)] border border-white/15 bg-white/5 px-4 py-3">
      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3 lg:flex lg:flex-wrap lg:gap-x-8">
        {doctor.experienceYears != null && (
          <Fact icon={<Briefcase className="h-4 w-4" />} label={dict.keyFactsExperience}>
            {formatSiteString(dict.keyFactsExperienceValue, { years: doctor.experienceYears })}
          </Fact>
        )}
        {doctor.languages.length > 0 && (
          <Fact icon={<Languages className="h-4 w-4" />} label={dict.keyFactsLanguages}>
            <span className="flex flex-wrap gap-1" aria-label={formatSiteString(dict.spokenLanguagesAriaLabel, { languages: languagesFullLabel })}>
              {doctor.languages.map((code) => (
                <span key={code} className="rounded-full border border-white/20 bg-white/10 px-2 py-0.5 text-xs font-medium text-white/90">
                  {code.toUpperCase()}
                </span>
              ))}
            </span>
          </Fact>
        )}
        {publicationCount > 0 && (
          <Fact icon={<FileText className="h-4 w-4" />} label={dict.keyFactsPublications}>
            {publicationCount}
          </Fact>
        )}
        {procedureCount > 0 && (
          <Fact icon={<Scissors className="h-4 w-4" />} label={dict.keyFactsProcedures}>
            {procedureCount}
          </Fact>
        )}
        {rating && (
          <Fact icon={<Star className="h-4 w-4 fill-current" />} label={dict.keyFactsRating}>
            {formatSiteString(dict.keyFactsRatingValue, { average: rating.average.toFixed(1), count: rating.count })}
          </Fact>
        )}
      </dl>
    </section>
  );
}
