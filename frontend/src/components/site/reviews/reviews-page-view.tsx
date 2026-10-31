import type { ReviewsStrings } from "@/lib/i18n/site-dictionaries/en/reviews";
import { fillReview } from "@/lib/review-format";
import type { ReviewsQuery } from "@/lib/review-query";
import { isReviewsFiltered, reviewsQueryString } from "@/lib/review-query";
import type { ReviewsListResponse } from "@/lib/review-types";
import { ReviewGridCard } from "@/components/site/reviews/review-grid-card";
import { ReviewsFilterForm } from "@/components/site/reviews/reviews-filter-form";
import { ReviewsPagination } from "@/components/site/reviews/reviews-pagination";
import { ReviewsSummaryStrip } from "@/components/site/reviews/reviews-summary-strip";
import { Alert } from "@/components/ui/alert";
import { LinkButton } from "@/components/ui/link-button";

/**
 * Paket AE — `/[lang]/reviews` gövdesi (sunucu, saf): başlık hiyerarşisi h1 > (gizli) h2 > kart başlıkları h3.
 * Üç durum: hata (`data === null`, yeniden dene bağlantılı), boş (filtreli/filtresiz ayrı metin) ve dolu liste.
 */
export function ReviewsPageView({
  t,
  data,
  query,
  basePath,
  intlLocale,
  defaultLocaleCode,
  dir,
}: {
  t: ReviewsStrings;
  data: ReviewsListResponse | null;
  query: ReviewsQuery;
  basePath: string;
  intlLocale: string;
  defaultLocaleCode: string;
  dir?: "ltr" | "rtl";
}) {
  const filtered = isReviewsFiltered(query);
  return (
    <div data-testid="reviews-page" dir={dir} className="mx-auto max-w-7xl px-4 py-10 sm:px-6 sm:py-14">
      <h1 className="font-heading text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">{t.reviewsPageTitle}</h1>
      <p className="mt-2 max-w-3xl text-base text-foreground/70">{t.reviewsPageIntro}</p>

      {data === null ? (
        <Alert variant="error" className="mt-8 flex flex-wrap items-center justify-between gap-3">
          <span>{t.reviewsPageError}</span>
          <LinkButton href={`${basePath}${reviewsQueryString(query)}`} variant="outline" size="sm" prefetch={false}>
            {t.reviewsRetry}
          </LinkButton>
        </Alert>
      ) : (
        <>
          <div className="mt-6">
            <ReviewsSummaryStrip summary={data.summary} countries={data.countries} />
          </div>
          <div className="mt-6">
            <ReviewsFilterForm t={t} action={basePath} intlLocale={intlLocale} query={query} languages={data.languages} doctors={data.doctors} />
          </div>

          <h2 className="sr-only">{t.reviewsListHeading}</h2>
          <p className="mt-6 text-sm text-foreground/60" aria-live="polite" data-testid="reviews-result-count">
            {fillReview(t.resultsCount, { count: data.total })}
          </p>

          {data.items.length === 0 ? (
            <p className="mt-6 rounded-[var(--site-radius)] border border-dashed border-border p-10 text-center text-sm text-foreground/60">
              {filtered ? t.reviewsFilteredEmpty : t.reviewsPageEmpty}
            </p>
          ) : (
            <ul className="mt-4 grid grid-cols-1 items-stretch gap-4 md:grid-cols-2 lg:grid-cols-3">
              {data.items.map((item) => (
                <li key={item.id} className="h-full">
                  <ReviewGridCard review={item} defaultLocaleCode={defaultLocaleCode} />
                </li>
              ))}
            </ul>
          )}

          <ReviewsPagination t={t} basePath={basePath} query={query} total={data.total} pageSize={data.pageSize} />
        </>
      )}
    </div>
  );
}
