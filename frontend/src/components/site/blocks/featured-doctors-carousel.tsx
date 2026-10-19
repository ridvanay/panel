"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, Pause, Play } from "lucide-react";
import { cn } from "@/lib/utils";

/** Otomatik kaydırmada bir kart ilerleme aralığı. */
export const FEATURED_DOCTORS_AUTOPLAY_MS = 5000;

/**
 * Görünür kart sayısı — `CARD_WIDTH_CLASS` ile AYNI kırılımlar. Mobilde ~1.2 kart görünür (sonraki
 * kartın kenarı kaydırılabildiğini belli eder), kontrol mantığı için tam sayı 1 sayılır.
 */
const VISIBLE_BREAKPOINTS: readonly (readonly [string, number])[] = [
  ["(min-width: 1024px)", 4],
  ["(min-width: 768px)", 3],
  ["(min-width: 640px)", 2],
];
const SERVER_VISIBLE_COUNT = 4;
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/** Bundan fazla sayfada noktalar yerine "3 / 12" sayacı gösterilir (24 doktor mobilde 24 nokta olurdu). */
const MAX_DOTS = 10;

/** `gap-6` (1.5rem) ile hesaplanmış genişlikler: mobil ~1.3 (sonraki kartın fotoğraf kenarı görünür), sm 2, md 3, lg 4 kart. */
const CARD_WIDTH_CLASS =
  "w-[72%] sm:w-[calc((100%-1.5rem)/2)] md:w-[calc((100%-3rem)/3)] lg:w-[calc((100%-4.5rem)/4)]";

function hasMatchMedia() {
  return typeof window !== "undefined" && typeof window.matchMedia === "function";
}

function subscribeMedia(callback: () => void) {
  if (!hasMatchMedia()) return () => {};
  const lists = [...VISIBLE_BREAKPOINTS.map(([query]) => query), REDUCED_MOTION_QUERY].map((query) => window.matchMedia(query));
  lists.forEach((list) => list.addEventListener?.("change", callback));
  return () => lists.forEach((list) => list.removeEventListener?.("change", callback));
}

function getVisibleCount() {
  if (!hasMatchMedia()) return SERVER_VISIBLE_COUNT;
  return VISIBLE_BREAKPOINTS.find(([query]) => window.matchMedia(query).matches)?.[1] ?? 1;
}

function prefersReducedMotion() {
  return hasMatchMedia() && window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

export interface FeaturedDoctorsCarouselLabels {
  region: string;
  previous: string;
  next: string;
  /** `{page}`/`{total}` yer tutuculu. */
  goToPage: string;
  pause: string;
  play: string;
}

/**
 * Öne Çıkan Doktorlar carousel'i (Paket D) — yeni paket YOK: CSS `scroll-snap` + yatay kaydırma,
 * native dokunmatik kaydırma. Doktor sayısı görünür kart sayısını aşmıyorsa oklar/noktalar gizlenir,
 * kartlar ortalanır (`justify-center-safe` taşmada başa hizalar, kart kırpılmaz).
 */
export function FeaturedDoctorsCarousel({
  items,
  labels,
  autoplay = false,
}: {
  items: { key: string; node: ReactNode }[];
  labels: FeaturedDoctorsCarouselLabels;
  autoplay?: boolean;
}) {
  const trackRef = useRef<HTMLUListElement>(null);
  const pausedRef = useRef({ hover: false, focus: false });
  // WCAG 2.2.2 — autoplay açıkken kullanıcı görünür bir düğmeyle durdurabilir.
  const [userPaused, setUserPaused] = useState(false);
  const visibleCount = useSyncExternalStore(subscribeMedia, getVisibleCount, () => SERVER_VISIBLE_COUNT);
  const reducedMotion = useSyncExternalStore(subscribeMedia, prefersReducedMotion, () => false);
  const [position, setPosition] = useState({ index: 0, atStart: true, atEnd: false });

  const count = items.length;
  const showControls = count > visibleCount;
  const lastStartIndex = Math.max(0, count - visibleCount);
  const pageCount = Math.ceil(count / visibleCount);
  const activePage = position.atEnd ? pageCount - 1 : Math.min(pageCount - 1, Math.floor(position.index / visibleCount));

  const readPosition = useCallback(() => {
    const track = trackRef.current;
    const first = track?.children[0] as HTMLElement | undefined;
    const second = track?.children[1] as HTMLElement | undefined;
    if (!track || !first) return;
    const step = second ? second.offsetLeft - first.offsetLeft : first.offsetWidth;
    const index = step > 0 ? Math.round(track.scrollLeft / step) : 0;
    const atStart = track.scrollLeft <= 1;
    const atEnd = track.scrollLeft + track.clientWidth >= track.scrollWidth - 1;
    setPosition((prev) => (prev.index === index && prev.atStart === atStart && prev.atEnd === atEnd ? prev : { index, atStart, atEnd }));
  }, []);

  const scrollToIndex = useCallback(
    (index: number) => {
      const track = trackRef.current;
      const target = track?.children[index] as HTMLElement | undefined;
      const first = track?.children[0] as HTMLElement | undefined;
      if (!track || !target || !first) return;
      track.scrollTo?.({ left: target.offsetLeft - first.offsetLeft, behavior: prefersReducedMotion() ? "auto" : "smooth" });
    },
    []
  );

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(readPosition);
    };
    readPosition();
    track.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      cancelAnimationFrame(frame);
      track.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [readPosition, visibleCount, count]);

  // Autoplay: fare üstte, odak içeride veya sekme arka plandayken tur atlanır; reduced-motion'da hiç başlamaz.
  const positionRef = useRef(position);
  useEffect(() => {
    positionRef.current = position;
  }, [position]);
  const autoplayActive = autoplay && showControls && !reducedMotion;
  useEffect(() => {
    if (!autoplayActive || userPaused || prefersReducedMotion()) return;
    const timer = window.setInterval(() => {
      const paused = pausedRef.current;
      if (paused.hover || paused.focus || document.visibilityState === "hidden") return;
      const current = positionRef.current;
      scrollToIndex(current.atEnd ? 0 : Math.min(lastStartIndex, current.index + 1));
    }, FEATURED_DOCTORS_AUTOPLAY_MS);
    return () => window.clearInterval(timer);
  }, [autoplayActive, userPaused, lastStartIndex, scrollToIndex]);

  const arrowClass =
    "flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[var(--site-primary)] bg-background text-[var(--site-primary)] shadow-sm transition-colors hover:bg-[var(--site-primary)] hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--site-primary)] disabled:pointer-events-none disabled:opacity-35 motion-reduce:transition-none";

  return (
    <div
      role="region"
      aria-roledescription="carousel"
      aria-label={labels.region}
      className="featured-doctors-carousel relative"
      // Yalnızca gerçek fare hover'ı duraklatır (dokunmatikte emüle edilen enter/leave takılı kalmasın);
      // odak duraklatması yalnızca klavye odağında (fareyle tıklanan ok/nokta autoplay'i kilitlemesin).
      onPointerEnter={(event) => {
        if (event.pointerType === "mouse") pausedRef.current.hover = true;
      }}
      onPointerLeave={(event) => {
        if (event.pointerType === "mouse") pausedRef.current.hover = false;
      }}
      onFocus={(event) => {
        pausedRef.current.focus = (event.target as HTMLElement).matches?.(":focus-visible") ?? true;
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) pausedRef.current.focus = false;
      }}
    >
      <div className={cn(showControls && "lg:px-14")}>
        {/* `py-3`: hover'daki yükselme/gölge yatay kaydırma kabında kırpılmasın. */}
        <ul
          ref={trackRef}
          className={cn(
            "relative -my-3 flex snap-x snap-mandatory gap-6 overflow-x-auto py-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
            !showControls && "justify-center-safe"
          )}
        >
          {items.map((item, index) => (
            <li
              key={item.key}
              role="group"
              aria-roledescription="slide"
              aria-label={`${index + 1} / ${count}`}
              className={cn("flex shrink-0 snap-start", CARD_WIDTH_CLASS)}
            >
              {item.node}
            </li>
          ))}
        </ul>
      </div>
      {showControls && (
        <div className="mt-6 flex items-center justify-center gap-4">
          {autoplayActive && (
            <button
              type="button"
              aria-label={userPaused ? labels.play : labels.pause}
              aria-pressed={userPaused}
              onClick={() => setUserPaused((paused) => !paused)}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[var(--site-primary)] transition-colors hover:bg-[var(--site-primary)]/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--site-primary)] motion-reduce:transition-none"
            >
              {userPaused ? <Play className="h-4 w-4" aria-hidden /> : <Pause className="h-4 w-4" aria-hidden />}
            </button>
          )}
          <button
            type="button"
            aria-label={labels.previous}
            disabled={position.atStart}
            onClick={() => scrollToIndex(Math.max(0, position.index - visibleCount))}
            className={cn(arrowClass, "lg:absolute lg:left-0 lg:top-[40%] lg:-translate-y-1/2")}
          >
            <ChevronLeft className="h-5 w-5" aria-hidden />
          </button>
          {pageCount > MAX_DOTS ? (
            <p className="min-w-16 text-center text-sm font-medium tabular-nums text-[var(--site-primary)]" aria-live="polite">
              {`${activePage + 1} / ${pageCount}`}
            </p>
          ) : (
            <div className="flex flex-wrap items-center justify-center gap-1">
              {Array.from({ length: pageCount }, (_, page) => (
                <button
                  key={page}
                  type="button"
                  aria-label={labels.goToPage.replace("{page}", String(page + 1)).replace("{total}", String(pageCount))}
                  aria-current={page === activePage ? "true" : undefined}
                  onClick={() => scrollToIndex(Math.min(lastStartIndex, page * visibleCount))}
                  className="group/dot flex h-6 min-w-6 items-center justify-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--site-primary)]"
                >
                  <span
                    className={cn(
                      "block h-2.5 rounded-full transition-all duration-300 motion-reduce:transition-none",
                      page === activePage ? "w-6 bg-[var(--site-primary)]" : "w-2.5 bg-[var(--site-primary)]/25 group-hover/dot:bg-[var(--site-accent)]"
                    )}
                  />
                </button>
              ))}
            </div>
          )}
          <button
            type="button"
            aria-label={labels.next}
            disabled={position.atEnd}
            onClick={() => scrollToIndex(Math.min(lastStartIndex, position.index + visibleCount))}
            className={cn(arrowClass, "lg:absolute lg:right-0 lg:top-[40%] lg:-translate-y-1/2")}
          >
            <ChevronRight className="h-5 w-5" aria-hidden />
          </button>
        </div>
      )}
    </div>
  );
}
