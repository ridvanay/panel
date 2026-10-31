import Link from "next/link";
import type { ReviewsStrings } from "@/lib/i18n/site-dictionaries/en/reviews";
import { fillReview } from "@/lib/review-format";
import { languageName } from "@/lib/review-format";
import type { ReviewsQuery } from "@/lib/review-query";
import { isReviewsFiltered } from "@/lib/review-query";
import type { ReviewsListResponse } from "@/lib/review-types";
import { Button } from "@/components/ui/button";

const selectClass =
  "h-10 w-full rounded-md border border-input bg-surface px-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring";

/**
 * Paket AE — `/reviews` filtreleri (hekim / dil / en az puan). Düz `GET` formu: JS'siz de çalışır, sonuç URL'si
 * paylaşılabilir. Süzgeç değişince sayfa 1'e döner (form `page` göndermez). Sunucu bileşenidir (`t` prop ile gelir).
 */
export function ReviewsFilterForm({
  t,
  action,
  intlLocale,
  query,
  languages,
  doctors,
}: {
  t: ReviewsStrings;
  action: string;
  intlLocale: string;
  query: ReviewsQuery;
  languages: ReviewsListResponse["languages"];
  doctors: ReviewsListResponse["doctors"];
}) {
  return (
    <form
      method="get"
      action={action}
      role="search"
      aria-label={t.filtersAria}
      data-testid="reviews-filters"
      className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_auto] lg:items-end"
    >
      <label className="flex flex-col gap-1 text-xs font-medium text-foreground/70">
        {t.filterPhysician}
        <select name="doctor" defaultValue={query.doctor ?? ""} className={selectClass}>
          <option value="">{t.filterAllPhysicians}</option>
          {doctors.map((d) => (
            <option key={d.slug} value={d.slug}>
              {d.name} ({d.count})
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs font-medium text-foreground/70">
        {t.languageFilterLabel}
        <select name="language" defaultValue={query.language ?? ""} className={selectClass}>
          <option value="">{t.allLanguages}</option>
          {languages.map((l) => (
            <option key={l.code} value={l.code}>
              {languageName(l.code, intlLocale)} ({l.count})
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs font-medium text-foreground/70">
        {t.filterMinRating}
        <select name="minRating" defaultValue={query.minRating ? String(query.minRating) : ""} className={selectClass}>
          <option value="">{t.filterAnyRating}</option>
          {[5, 4, 3, 2].map((n) => (
            <option key={n} value={n}>
              {fillReview(t.filterRatingOption, { n })}
            </option>
          ))}
        </select>
      </label>
      <div className="flex items-center gap-3 sm:col-span-2 lg:col-span-1">
        <Button type="submit" size="lg">
          {t.filterApply}
        </Button>
        {isReviewsFiltered(query) && (
          <Link href={action} className="rounded-md text-sm font-medium text-[var(--site-primary)] outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring">
            {t.filterReset}
          </Link>
        )}
      </div>
    </form>
  );
}
