"use client";

import { useCallback, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Star } from "lucide-react";
import * as reviewsApi from "@/lib/api/reviews";
import type { DoctorReviewsResponse, ReviewSort, ReviewSummary } from "@/lib/api/types";
import { fillReview, useReviewStrings } from "@/lib/i18n/use-review-strings";
import { languageName } from "@/lib/review-format";
import { ReviewCard } from "@/components/site/reviews/review-card";
import { StarRating } from "@/components/site/reviews/star-rating";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Ortalama + dağılım YALNIZCA `summary.average` doluysa (en az 3 onaylı yorum) gösterilir. Aksi halde
 * yalnızca yorum listesi vardır — uydurma sosyal kanıt koruması (Paket Y).
 */
export function ReviewSummaryBlock({ summary }: { summary: ReviewSummary }) {
  const { t } = useReviewStrings();
  if (summary.average === null) return null;
  const distribution = summary.distribution;
  const max = distribution ? Math.max(1, ...Object.values(distribution)) : 1;
  return (
    <div className="flex flex-col gap-6 rounded-[var(--site-radius)] border border-border bg-surface p-4 sm:flex-row sm:items-center sm:p-5" data-testid="review-summary">
      <div className="flex flex-col items-start gap-1">
        <p className="flex items-baseline gap-1.5">
          <span className="text-4xl font-semibold text-foreground">{summary.average.toFixed(1)}</span>
          <span className="text-sm text-foreground/60">/ 5</span>
        </p>
        <StarRating rating={summary.average} label={fillReview(t.starsAria, { rating: summary.average.toFixed(1) })} />
        <p className="text-xs text-foreground/60">{fillReview(t.reviewsCountLabel, { count: summary.count })}</p>
      </div>
      {distribution && (
        <ul className="min-w-0 flex-1 space-y-1.5">
          {([5, 4, 3, 2, 1] as const).map((stars) => {
            const count = distribution[String(stars) as "1" | "2" | "3" | "4" | "5"] ?? 0;
            return (
              <li key={stars} className="flex items-center gap-2 text-xs text-foreground/70" aria-label={fillReview(t.distributionRowAria, { stars, count })}>
                <span className="flex w-12 shrink-0 items-center gap-1" aria-hidden="true">
                  {stars}
                  <Star className="h-3 w-3 fill-current text-warning" />
                </span>
                <span className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                  <span className="block h-full rounded-full bg-warning" style={{ width: `${(count / max) * 100}%` }} />
                </span>
                <span className="w-8 shrink-0 text-end tabular-nums" aria-hidden="true">
                  {count}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/**
 * Hekim profili "Patient Reviews" bölümü. İlk sayfa sunucuda çekilip `initial` ile gelir (yorum metinleri
 * ilk HTML'de bulunur — SEO); sıralama/dil/sayfa değişiminde istemci aynı uçtan yenisini çeker.
 * Yükleme (iskelet), hata (tekrar dene) ve filtre-boş durumları ayrı ele alınır.
 */
export function DoctorReviewsSection({ slug, initial }: { slug: string; initial: DoctorReviewsResponse }) {
  const { t, lang, intlLocale } = useReviewStrings();
  const [data, setData] = useState(initial);
  const [sort, setSort] = useState<ReviewSort>("newest");
  const [language, setLanguage] = useState("");
  const [page, setPage] = useState(initial.page);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const requestId = useRef(0);

  const load = useCallback(
    async (next: { sort: ReviewSort; language: string; page: number }) => {
      const current = ++requestId.current;
      setLoading(true);
      setError(false);
      try {
        const result = await reviewsApi.listDoctorReviews(slug, { locale: lang, sort: next.sort, language: next.language, page: next.page });
        if (current !== requestId.current) return;
        setData(result);
        setSort(next.sort);
        setLanguage(next.language);
        setPage(next.page);
      } catch {
        if (current === requestId.current) setError(true);
      } finally {
        if (current === requestId.current) setLoading(false);
      }
    },
    [slug, lang],
  );

  const pages = Math.max(1, Math.ceil(data.total / (data.pageSize || 10)));
  const retryTarget = { sort, language, page };

  return (
    <div className="space-y-5">
      <ReviewSummaryBlock summary={data.summary} />

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs font-medium text-foreground/60">
          {t.sortLabel}
          <select
            value={sort}
            onChange={(e) => void load({ sort: e.target.value as ReviewSort, language, page: 1 })}
            className="h-9 rounded-md border border-input bg-surface px-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="newest">{t.sortNewest}</option>
            <option value="highest">{t.sortHighest}</option>
          </select>
        </label>
        {data.languages.length > 1 && (
          <label className="flex flex-col gap-1 text-xs font-medium text-foreground/60">
            {t.languageFilterLabel}
            <select
              value={language}
              onChange={(e) => void load({ sort, language: e.target.value, page: 1 })}
              className="h-9 rounded-md border border-input bg-surface px-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="">{t.allLanguages}</option>
              {data.languages.map((l) => (
                <option key={l.code} value={l.code}>
                  {languageName(l.code, intlLocale)} ({l.count})
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      <div aria-live="polite" aria-busy={loading} className="space-y-4">
        {loading && (
          <div className="space-y-4" role="status" aria-label={t.reviewsLoading}>
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        )}
        {!loading && error && (
          <Alert variant="error" className="flex flex-wrap items-center justify-between gap-3">
            <span>{t.reviewsError}</span>
            <Button type="button" size="sm" variant="outline" onClick={() => void load(retryTarget)}>
              {t.reviewsRetry}
            </Button>
          </Alert>
        )}
        {!loading && !error && data.items.length === 0 && <p className="text-sm text-foreground/60">{t.reviewsFilteredEmpty}</p>}
        {!loading && !error && data.items.map((review) => <ReviewCard key={review.id} review={review} />)}
      </div>

      {pages > 1 && (
        <nav className="flex items-center justify-between gap-3" aria-label={t.sectionReviews}>
          <Button type="button" variant="outline" size="sm" disabled={loading || page <= 1} onClick={() => void load({ sort, language, page: page - 1 })}>
            <ChevronLeft className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />
            {t.previousPage}
          </Button>
          <span className="text-xs text-foreground/60">{fillReview(t.pageOf, { page, pages })}</span>
          <Button type="button" variant="outline" size="sm" disabled={loading || page >= pages} onClick={() => void load({ sort, language, page: page + 1 })}>
            {t.nextPage}
            <ChevronRight className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />
          </Button>
        </nav>
      )}
    </div>
  );
}
