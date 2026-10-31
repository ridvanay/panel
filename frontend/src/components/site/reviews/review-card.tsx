"use client";

import { useState } from "react";
import { BadgeCheck, Languages } from "lucide-react";
import type { ReviewItem } from "@/lib/api/types";
import { fillReview, useReviewStrings } from "@/lib/i18n/use-review-strings";
import { countryName, formatReviewDate, languageName, reviewAuthorName } from "@/lib/review-format";
import { StarRating } from "@/components/site/reviews/star-rating";
import { Badge } from "@/components/ui/badge";

/**
 * Paket Y — tek yorum kartı. Metin HTML olarak sayfadadır (SEO); çeviri varsa "Show translation" anahtarı
 * özgün metin ile yönetici çevirisi arasında geçiş yapar. `doctorReply` varsa altında gösterilir.
 * Yorum metni düz metin olarak basılır (`whitespace-pre-line`), `dangerouslySetInnerHTML` KULLANILMAZ.
 */
export function ReviewCard({ review, footer }: { review: ReviewItem; footer?: React.ReactNode }) {
  const { t, lang, intlLocale } = useReviewStrings();
  const [showTranslation, setShowTranslation] = useState(false);
  const translation = review.translation;
  const shown = showTranslation && translation ? { title: translation.title ?? review.title, body: translation.body } : { title: review.title, body: review.body };
  const author = reviewAuthorName(review) ?? t.anonymousPatient;
  const country = countryName(review.country, intlLocale);
  const foreign = review.language.toLowerCase() !== lang.toLowerCase().split("-")[0];

  return (
    <article className="rounded-[var(--site-radius)] border border-border bg-surface p-4 sm:p-5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <StarRating rating={review.rating} label={fillReview(t.starsAria, { rating: review.rating })} />
        {review.verified && (
          <Badge tone="success" className="gap-1">
            <BadgeCheck className="h-3.5 w-3.5" aria-hidden="true" />
            {t.verifiedPatient}
          </Badge>
        )}
      </div>
      <h3 className="mt-2 text-base font-semibold text-foreground">{shown.title}</h3>
      <p className="mt-1 whitespace-pre-line text-sm leading-7 text-foreground/80">{shown.body}</p>

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-foreground/60">
        <span className="font-medium text-foreground/80">{author}</span>
        {country && <span>{country}</span>}
        <time dateTime={review.publishedAt}>{formatReviewDate(review.publishedAt, intlLocale)}</time>
        {foreign && <span>{fillReview(t.originalLanguage, { language: languageName(review.language, intlLocale) })}</span>}
      </div>

      {translation && (
        <button
          type="button"
          aria-pressed={showTranslation}
          onClick={() => setShowTranslation((v) => !v)}
          className="mt-3 inline-flex items-center gap-1.5 rounded-md text-xs font-medium text-[var(--site-primary)] outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Languages className="h-3.5 w-3.5" aria-hidden="true" />
          {showTranslation ? t.showOriginal : t.showTranslation}
        </button>
      )}

      {review.doctorReply && (
        <div className="mt-4 rounded-md border-s-2 border-[var(--site-primary)] bg-muted/40 p-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-foreground/50">{t.doctorReplyLabel}</p>
          <p className="mt-1 whitespace-pre-line text-sm leading-6 text-foreground/80">{review.doctorReply}</p>
        </div>
      )}
      {footer}
    </article>
  );
}
