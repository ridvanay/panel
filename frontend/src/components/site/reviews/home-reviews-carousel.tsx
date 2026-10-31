"use client";

import { useRef } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { FeaturedReviewsResponse } from "@/lib/api/types";
import { fillReview, useReviewStrings } from "@/lib/i18n/use-review-strings";
import { withLocalePrefix } from "@/lib/i18n/site-path";
import { ReviewCard } from "@/components/site/reviews/review-card";
import { StarRating } from "@/components/site/reviews/star-rating";

/**
 * Paket Y — anasayfa "What our patients say" karuseli. `items` boşsa bölüm HİÇ render edilmez.
 * `summary.average` null ise (3'ten az onaylı yorum) ortalama VE yorum sayısı gizlenir; yalnızca kartlar kalır.
 * Karusel kaydırma-yakalamalı (scroll-snap) bir şerittir; oklar ve klavye ile gezilebilir.
 */
export function HomeReviewsCarousel({ data, lang, defaultLocaleCode }: { data: FeaturedReviewsResponse | null; lang: string; defaultLocaleCode: string }) {
  const { t } = useReviewStrings();
  const trackRef = useRef<HTMLUListElement>(null);
  if (!data || data.items.length === 0) return null;

  const { summary, items } = data;
  const showSummary = summary.average !== null;

  function scrollByCard(direction: 1 | -1) {
    const track = trackRef.current;
    if (!track) return;
    const dir = getComputedStyle(track).direction === "rtl" ? -1 : 1;
    track.scrollBy({ left: direction * dir * track.clientWidth * 0.85, behavior: "smooth" });
  }

  return (
    <section aria-labelledby="home-reviews-heading" className="bg-muted/20 py-12 sm:py-16">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 id="home-reviews-heading" className="text-2xl font-semibold text-foreground sm:text-3xl">
              {t.homeHeading}
            </h2>
            {showSummary && summary.average !== null && (
              <p className="mt-2 flex flex-wrap items-center gap-2 text-sm text-foreground/70" data-testid="home-reviews-summary">
                <StarRating rating={summary.average} label={fillReview(t.starsAria, { rating: summary.average.toFixed(1) })} />
                {fillReview(t.homeSummary, { average: summary.average.toFixed(1), count: summary.count })}
              </p>
            )}
          </div>
          {items.length > 1 && (
            <div className="flex gap-2">
              <button
                type="button"
                aria-label={t.homePrevious}
                onClick={() => scrollByCard(-1)}
                className="flex h-10 w-10 items-center justify-center rounded-full border border-border bg-surface text-foreground outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
              >
                <ChevronLeft className="h-5 w-5 rtl:rotate-180" aria-hidden="true" />
              </button>
              <button
                type="button"
                aria-label={t.homeNext}
                onClick={() => scrollByCard(1)}
                className="flex h-10 w-10 items-center justify-center rounded-full border border-border bg-surface text-foreground outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
              >
                <ChevronRight className="h-5 w-5 rtl:rotate-180" aria-hidden="true" />
              </button>
            </div>
          )}
        </div>

        <ul
          ref={trackRef}
          aria-label={t.homeCarouselAria}
          className="mt-6 flex snap-x snap-mandatory gap-4 overflow-x-auto pb-3 [scrollbar-width:thin]"
        >
          {items.map((item) => (
            <li key={item.id} className="w-[85%] shrink-0 snap-start sm:w-[26rem]">
              <ReviewCard
                review={item}
                footer={
                  item.doctor ? (
                    <p className="mt-3 text-xs">
                      <Link
                        href={withLocalePrefix(`/physicians/${item.doctor.slug}`, lang, defaultLocaleCode)}
                        className="font-medium text-[var(--site-primary)] hover:underline"
                      >
                        {fillReview(t.homeAboutDoctor, { doctor: item.doctor.name })}
                      </Link>
                    </p>
                  ) : null
                }
              />
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
