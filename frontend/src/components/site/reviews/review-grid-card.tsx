"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { BadgeCheck, Languages, User } from "lucide-react";
import type { FeaturedReviewItem } from "@/lib/api/types";
import { fillReview, useReviewStrings } from "@/lib/i18n/use-review-strings";
import { withLocalePrefix } from "@/lib/i18n/site-path";
import { countryName, formatReviewDate, languageName, reviewAuthorName } from "@/lib/review-format";
import { countryFlag, reviewInitials } from "@/lib/review-flags";
import { StarRating } from "@/components/site/reviews/star-rating";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger, DialogClose } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/** CSS `line-clamp-5` ölçülemediğinde (SSR / ölçüm yok) kullanılan kaba eşik. */
const CLAMP_LINES = 5;
const CLAMP_CHAR_HEURISTIC = 260;

function looksLong(body: string): boolean {
  return body.length > CLAMP_CHAR_HEURISTIC || body.split("\n").length > CLAMP_LINES;
}

/**
 * Paket AE — anasayfa ve `/reviews` için EŞİT yükseklikli yorum kartı. Gövde 5 satırla sınırlanır; taşıyorsa
 * "Read more" tam metni erişilebilir bir modalda (Base UI Dialog: ESC, odak tuzağı, odak geri dönüşü) açar.
 * Başlık YALNIZCA hasta yazdıysa gösterilir — gövdeden başlık üretilmez. Düz metin basılır (HTML enjekte edilmez).
 */
export function ReviewGridCard({ review, defaultLocaleCode }: { review: FeaturedReviewItem; defaultLocaleCode: string }) {
  const { t, lang, intlLocale } = useReviewStrings();
  const [showTranslation, setShowTranslation] = useState(false);
  const [measuredOverflow, setMeasuredOverflow] = useState(false);
  const bodyRef = useRef<HTMLParagraphElement>(null);

  const translation = review.translation;
  const usingTranslation = showTranslation && translation !== null;
  const title = (usingTranslation ? (translation.title ?? review.title) : review.title).trim();
  const body = usingTranslation ? translation.body : review.body;
  const authorName = reviewAuthorName(review);
  const author = authorName ?? t.anonymousPatient;
  const initials = reviewInitials(authorName);
  const countryLabel = countryName(review.country, intlLocale);
  const flag = countryFlag(review.country);
  const dateText = formatReviewDate(review.publishedAt, intlLocale);
  const languageLabel = languageName(review.language, intlLocale);
  const bodyDir = usingTranslation ? undefined : "auto";
  const bodyLang = usingTranslation ? lang : review.language;

  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const measure = () => setMeasuredOverflow(el.scrollHeight > el.clientHeight + 1);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [body]);

  const hasMore = measuredOverflow || looksLong(body) || Boolean(review.doctorReply);
  const stars = <StarRating rating={review.rating} label={fillReview(t.starsAria, { rating: review.rating })} />;

  const translationToggle = translation ? (
    <button
      type="button"
      aria-pressed={showTranslation}
      onClick={() => setShowTranslation((v) => !v)}
      className="inline-flex items-center gap-1.5 rounded-md text-xs font-medium text-[var(--site-primary)] outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Languages className="h-3.5 w-3.5" aria-hidden="true" />
      {showTranslation ? t.showOriginal : t.showTranslation}
    </button>
  ) : null;

  const header = (
    <div className="flex items-start gap-3">
      <span
        aria-hidden="true"
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--site-primary)]/10 text-sm font-semibold text-[var(--site-primary)]"
      >
        {initials ?? <User className="h-5 w-5" />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="truncate text-sm font-semibold text-foreground">{author}</span>
          {review.verified && (
            <Badge tone="success" className="gap-1">
              <BadgeCheck className="h-3.5 w-3.5" aria-hidden="true" />
              {t.verifiedPatient}
            </Badge>
          )}
        </div>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-foreground/60">
          {flag && countryLabel && (
            <span className="inline-flex items-center gap-1">
              <span role="img" aria-label={countryLabel}>
                {flag}
              </span>
              <span>{countryLabel}</span>
            </span>
          )}
          <time dateTime={review.publishedAt}>{dateText}</time>
        </p>
      </div>
    </div>
  );

  return (
    <article data-testid="review-card" className="flex h-full flex-col rounded-[var(--site-radius)] border border-border bg-surface p-4 sm:p-5">
      {header}
      <div className="mt-3">{stars}</div>
      {title && <h3 className="mt-2 text-base font-semibold text-foreground">{title}</h3>}
      <p
        ref={bodyRef}
        dir={bodyDir}
        lang={bodyLang}
        data-testid="review-body"
        className="mt-2 line-clamp-5 whitespace-pre-line text-sm leading-6 text-foreground/80"
      >
        {body}
      </p>

      {hasMore && (
        <Dialog>
          <DialogTrigger
            render={
              <button
                type="button"
                aria-label={fillReview(t.readMoreAria, { author })}
                className="mt-2 self-start rounded-md text-sm font-medium text-[var(--site-primary)] outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
              />
            }
          >
            {t.readMore}
          </DialogTrigger>
          <DialogContent showCloseButton={false} data-testid="review-modal" className="max-h-[85vh] max-w-2xl overflow-y-auto p-5 sm:p-6">
            <div className="space-y-3">
              {header}
              {stars}
              <DialogTitle className={cn("text-base leading-snug", !title && "sr-only")}>{title || t.reviewModalTitle}</DialogTitle>
              <DialogDescription render={<div />} className="space-y-4 text-foreground/80">
                <p dir={bodyDir} lang={bodyLang} className="whitespace-pre-line text-sm leading-7">
                  {body}
                </p>
                {review.doctorReply && (
                  <div className="rounded-md border-s-2 border-[var(--site-primary)] bg-muted/40 p-3">
                    <p className="text-xs font-semibold uppercase tracking-wider text-foreground/50">{t.doctorReplyLabel}</p>
                    <p className="mt-1 whitespace-pre-line text-sm leading-6">{review.doctorReply}</p>
                  </div>
                )}
              </DialogDescription>
              <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                <div className="flex flex-wrap items-center gap-3 text-xs text-foreground/60">
                  <span>{fillReview(t.writtenInLanguage, { language: languageLabel })}</span>
                  {translationToggle}
                </div>
                <DialogClose className="inline-flex h-9 items-center rounded-md border border-border px-4 text-sm font-medium text-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring">
                  {t.closeAria}
                </DialogClose>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}

      <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-border/60 pt-3 text-xs text-foreground/60">
        {review.doctor && (
          <p className="w-full">
            <span>{t.physicianLabel}: </span>
            <Link
              href={withLocalePrefix(`/physicians/${review.doctor.slug}`, lang, defaultLocaleCode)}
              className="font-medium text-[var(--site-primary)] outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
            >
              {review.doctor.name}
            </Link>
          </p>
        )}
        <span className="inline-flex items-center gap-1" data-testid="review-language">
          <Languages className="h-3.5 w-3.5" aria-hidden="true" />
          {languageLabel}
        </span>
        {translationToggle}
      </div>
    </article>
  );
}
