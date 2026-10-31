"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { ReviewGridCard } from "@/components/site/reviews/review-grid-card";
import { ReviewsSummaryStrip } from "@/components/site/reviews/reviews-summary-strip";
import { LinkButton } from "@/components/ui/link-button";
import { fillReview, useReviewStrings } from "@/lib/i18n/use-review-strings";
import { withLocalePrefix } from "@/lib/i18n/site-path";
import type { FeaturedReviewsData } from "@/lib/review-types";
import { cn } from "@/lib/utils";

/** Kartlar arası boşluk (`gap-4`) — sayfa kaydırma genişliğine eklenir. */
const GAP_PX = 16;

const arrowClass =
  "flex h-10 w-10 items-center justify-center rounded-full border border-border bg-surface text-foreground outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40";

function isRtl(el: HTMLElement): boolean {
  return getComputedStyle(el).direction === "rtl" || el.closest("[dir='rtl']") !== null;
}

/**
 * Paket AE — anasayfa "What our patients say" karuseli. Satırda 3/2/1 kart (lg/md/sm), hepsi eşit yükseklikte.
 * Yatay `scroll-snap` izi; oklar bir "sayfa" kaydırır (RTL'de yön ters), noktalar sayfa sayısı kadardır ve kaydırma
 * konumundan güncellenir (`aria-current`). OTOMATİK OYNATMA YOK. `items` boşsa bölüm hiç çizilmez.
 */
export function HomeReviewsCarousel({ data, lang, defaultLocaleCode }: { data: FeaturedReviewsData | null; lang: string; defaultLocaleCode: string }) {
  const { t } = useReviewStrings();
  const trackRef = useRef<HTMLUListElement>(null);
  const [perPage, setPerPage] = useState(1);
  const [page, setPage] = useState(0);
  const itemCount = data?.items.length ?? 0;
  const pageCount = Math.max(1, Math.ceil(itemCount / perPage));

  const sync = useCallback(() => {
    const track = trackRef.current;
    if (!track) return;
    const first = track.firstElementChild as HTMLElement | null;
    const cardWidth = first?.offsetWidth ?? 0;
    const nextPerPage = cardWidth > 0 ? Math.max(1, Math.round((track.clientWidth + GAP_PX) / (cardWidth + GAP_PX))) : 1;
    setPerPage(nextPerPage);
    const step = track.clientWidth + GAP_PX;
    setPage(step > 0 ? Math.round(Math.abs(track.scrollLeft) / step) : 0);
  }, []);

  useEffect(() => {
    sync();
    const track = trackRef.current;
    if (!track || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(sync);
    observer.observe(track);
    return () => observer.disconnect();
  }, [sync, itemCount]);

  if (!data || data.items.length === 0) return null;
  const { items } = data;
  const showControls = itemCount > 1;

  function behavior(): ScrollBehavior {
    return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
  }

  function scrollByPage(direction: 1 | -1) {
    const track = trackRef.current;
    if (!track) return;
    const dir = isRtl(track) ? -1 : 1;
    track.scrollBy({ left: direction * dir * (track.clientWidth + GAP_PX), behavior: behavior() });
  }

  function scrollToPage(index: number) {
    const track = trackRef.current;
    if (!track) return;
    const dir = isRtl(track) ? -1 : 1;
    track.scrollTo({ left: dir * index * (track.clientWidth + GAP_PX), behavior: behavior() });
  }

  return (
    <section data-testid="home-reviews" aria-labelledby="home-reviews-heading" className="bg-muted/20 py-12 sm:py-16">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <h2 id="home-reviews-heading" className="text-2xl font-semibold text-foreground sm:text-3xl">
            {t.homeHeading}
          </h2>
          {showControls && (
            <div className="flex gap-2">
              <button type="button" aria-label={t.homePrevious} disabled={page <= 0} onClick={() => scrollByPage(-1)} className={arrowClass} data-testid="reviews-prev">
                <ChevronLeft className="h-5 w-5 rtl:rotate-180" aria-hidden="true" />
              </button>
              <button type="button" aria-label={t.homeNext} disabled={page >= pageCount - 1} onClick={() => scrollByPage(1)} className={arrowClass} data-testid="reviews-next">
                <ChevronRight className="h-5 w-5 rtl:rotate-180" aria-hidden="true" />
              </button>
            </div>
          )}
        </div>
        <div className="mt-6">
          <ReviewsSummaryStrip summary={data.summary} countries={data.countries} />
        </div>

        <div role="region" aria-label={t.homeCarouselAria} className="mt-6">
          <ul
            ref={trackRef}
            onScroll={sync}
            data-testid="reviews-track"
            className="flex snap-x snap-mandatory items-stretch gap-4 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {items.map((item) => (
              <li key={item.id} className="flex w-full shrink-0 flex-col snap-start md:w-[calc((100%-1rem)/2)] lg:w-[calc((100%-2rem)/3)]">
                <ReviewGridCard review={item} defaultLocaleCode={defaultLocaleCode} />
              </li>
            ))}
          </ul>
        </div>

        {showControls && pageCount > 1 && (
          <div className="mt-4 flex items-center justify-center gap-2" data-testid="reviews-dots">
            {Array.from({ length: pageCount }, (_, i) => (
              <button
                key={i}
                type="button"
                aria-label={fillReview(t.pageLinkAria, { page: i + 1 })}
                aria-current={i === page ? "true" : undefined}
                onClick={() => scrollToPage(i)}
                className={cn("h-2.5 rounded-full outline-none transition-all focus-visible:ring-2 focus-visible:ring-ring", i === page ? "w-6 bg-[var(--site-primary)]" : "w-2.5 bg-foreground/25 hover:bg-foreground/40")}
              />
            ))}
          </div>
        )}

        <div className="mt-8 flex justify-center">
          <LinkButton href={withLocalePrefix("/reviews", lang, defaultLocaleCode)} variant="outline" size="lg">
            {t.viewAllReviews}
          </LinkButton>
        </div>
      </div>
    </section>
  );
}
