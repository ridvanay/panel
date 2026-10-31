"use client";

import type { ReviewSummary } from "@/lib/api/types";
import type { ReviewCountries } from "@/lib/review-types";
import { fillReview, useReviewStrings } from "@/lib/i18n/use-review-strings";
import { countryName } from "@/lib/review-format";
import { countryFlag } from "@/lib/review-flags";
import { StarRating } from "@/components/site/reviews/star-rating";

/**
 * Paket AE — özet şeridi: büyük ortalama + yıldızlar + "N doğrulanmış yorum" ve hasta ülkeleri (en çok 6 bayrak + "+N").
 * `summary.average === null` (3'ten az onaylı yorum) iken ortalama VE sayı gizlenir (uydurma sosyal kanıt koruması);
 * ülke bayrakları bundan bağımsızdır. Gösterilecek hiçbir şey yoksa `null` döner.
 */
export function ReviewsSummaryStrip({ summary, countries }: { summary: ReviewSummary; countries?: ReviewCountries }) {
  const { t, intlLocale } = useReviewStrings();
  const codes = (countries?.codes ?? []).slice(0, 6);
  const more = countries?.more ?? 0;
  const average = summary.average;
  if (average === null && codes.length === 0) return null;

  return (
    <div
      data-testid="reviews-summary-strip"
      className="flex flex-wrap items-center gap-x-8 gap-y-4 rounded-[var(--site-radius)] border border-border bg-surface p-4 sm:p-5"
    >
      {average !== null && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2" data-testid="home-reviews-summary">
          <p className="text-5xl font-semibold leading-none text-foreground" aria-label={fillReview(t.averageAria, { average: average.toFixed(1) })}>
            {average.toFixed(1)}
          </p>
          <div className="flex flex-col gap-1">
            <StarRating rating={average} label={fillReview(t.starsAria, { rating: average.toFixed(1) })} />
            <p className="text-sm text-foreground/70">{fillReview(t.verifiedCount, { count: summary.count })}</p>
          </div>
        </div>
      )}
      {codes.length > 0 && (
        <ul aria-label={t.countriesAria} data-testid="reviews-countries" className="flex flex-wrap items-center gap-2">
          {codes.map((code) => {
            const name = countryName(code, intlLocale) ?? code;
            const flag = countryFlag(code);
            return (
              <li key={code} title={name} className="flex h-8 min-w-8 items-center justify-center rounded-full bg-muted px-1.5 text-lg leading-none">
                <span role="img" aria-label={name}>
                  {flag || code}
                </span>
              </li>
            );
          })}
          {more > 0 && (
            <li className="flex h-8 items-center rounded-full bg-muted px-2.5 text-xs font-medium text-foreground/70" aria-label={fillReview(t.countriesMoreAria, { count: more })}>
              {fillReview(t.countriesMore, { count: more })}
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
