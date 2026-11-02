"use client";

import { useEffect, useRef, useState } from "react";
import { CalendarCheck, Clock, Pencil, Video } from "lucide-react";
import { Button } from "@/components/ui/button";
import { COOKIE_BANNER_VISIBILITY_EVENT } from "@/components/site/cookie-consent-banner";
import { useBookingSelection } from "@/components/site/telehealth/booking-selection-context";
import { DualDateTimeSummary } from "@/components/site/telehealth/dual-time";
import { mergeSlotRanges } from "@/lib/country-display";
import { formatDayLabel } from "@/lib/telehealth-format";
import { formatSiteString } from "@/lib/i18n/site-dictionaries";
import type { ServiceBookingStrings } from "@/lib/i18n/site-dictionaries/en/service-booking";
import { cn } from "@/lib/utils";

/**
 * "Consultation summary" — eski `DoctorServiceSummaryPanel` ile AYNI kart yüzeyi, başlık/ikon düzeni, "Seçilen randevu"
 * kutusu, çift saat özeti ve tek dinamik "Continue" düğmesi (+ mobil alt çubuk). Hekim satırı/avatarı/ücret YOK:
 * "Service", "Patient Coordinator" ve "Free of charge" gösterilir.
 */
export function ServiceBookingSummaryPanel({
  strings: s,
  serviceName,
  durationMin,
  intlLocale,
  currentStep,
  totalSteps,
  onContinue,
  continueDisabled,
  continueLoading,
  showContinueButton,
  locked,
  continueLabel,
}: {
  strings: ServiceBookingStrings;
  serviceName: string | null;
  durationMin: number;
  intlLocale: string;
  currentStep: number;
  totalSteps: number;
  onContinue: () => void;
  continueDisabled: boolean;
  continueLoading: boolean;
  showContinueButton: boolean;
  /** Onay/başarı adımında seçim değiştirilemez. */
  locked: boolean;
  continueLabel: string;
}) {
  const { selectedSlots, clearAllSlots, displayTimeZone } = useBookingSelection();
  const panelRef = useRef<HTMLDivElement>(null);
  const [barVisible, setBarVisible] = useState(false);
  const [cookieBannerVisible, setCookieBannerVisible] = useState(false);

  useEffect(() => {
    const target = panelRef.current;
    if (!target) return;
    const observer = new IntersectionObserver(([entry]) => setBarVisible(!entry.isIntersecting), { threshold: 0 });
    observer.observe(target);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    function handleVisibility(event: Event) {
      setCookieBannerVisible((event as CustomEvent<{ visible: boolean }>).detail.visible);
    }
    window.addEventListener(COOKIE_BANNER_VISIBILITY_EVENT, handleVisibility);
    return () => window.removeEventListener(COOKIE_BANNER_VISIBILITY_EVENT, handleVisibility);
  }, []);

  const slot = selectedSlots[0] ?? null;

  return (
    <>
      <div ref={panelRef} className="rounded-[var(--site-radius)] border border-border bg-surface p-5 shadow-sm" data-testid="service-booking-summary">
        <p className="text-xs font-semibold uppercase tracking-wider text-foreground/50">{s.summaryLabel}</p>

        <div className="mt-4 flex items-center gap-3">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary" aria-hidden="true">
            <Video className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-foreground">{s.coordinatorTitle}</p>
            <p className="truncate text-xs text-foreground/60" data-testid="summary-service">
              {serviceName ?? s.summaryServicePending}
            </p>
          </div>
        </div>

        <div className="my-4 border-t border-border" />

        <div className="flex items-center justify-between gap-2 text-sm">
          <span className="text-foreground/80">{formatSiteString(s.durationLine, { minutes: durationMin })}</span>
          <span className="flex shrink-0 items-center gap-1 text-foreground/60">
            <Clock className="h-3.5 w-3.5" aria-hidden="true" />
            {formatSiteString(s.minutesShort, { minutes: durationMin })}
          </span>
        </div>

        <div className="mt-4 rounded-[var(--site-radius)] border border-border bg-muted/50 p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-foreground/50">{s.selectedLabel}</p>
            {slot && !locked && (
              <button
                type="button"
                onClick={clearAllSlots}
                className="flex shrink-0 items-center gap-1 rounded-[var(--site-radius)] px-1.5 py-0.5 text-xs font-medium text-primary transition-colors hover:bg-primary/10 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
              >
                <Pencil className="h-3 w-3" aria-hidden="true" />
                {s.changeAction}
              </button>
            )}
          </div>

          {!slot ? (
            <p className="mt-1 text-sm text-foreground/40">{s.selectDatePrompt}</p>
          ) : (
            <>
              <p className="mt-2 flex items-center gap-1.5 text-sm font-medium text-foreground">
                <CalendarCheck className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
                {formatDayLabel(slot.startsAt, displayTimeZone, intlLocale)}
              </p>
              <div className="mt-2 space-y-2 border-t border-border pt-2">
                {mergeSlotRanges(selectedSlots).map((range) => (
                  <DualDateTimeSummary key={range.startsAt} iso={range.startsAt} endIso={range.endsAt} timeZone={displayTimeZone} intlLocale={intlLocale} />
                ))}
              </div>
            </>
          )}
        </div>

        <div className="mt-4 flex items-baseline gap-1.5">
          <span className="text-2xl font-semibold text-foreground">{s.freeLabel}</span>
        </div>

        {showContinueButton && (
          <div className="mt-3 space-y-1.5">
            <Button type="button" size="lg" className="w-full rounded-[var(--site-radius)]" disabled={continueDisabled} loading={continueLoading} onClick={onContinue} data-testid="summary-continue">
              {continueLabel}
            </Button>
            <p className="text-center text-[11px] text-foreground/40">{formatSiteString(s.stepProgress, { current: currentStep, total: totalSteps })}</p>
          </div>
        )}
      </div>

      {showContinueButton && (
        <div
          data-bottom-bar=""
          aria-hidden={!barVisible}
          className={cn(
            "fixed inset-x-0 z-40 h-16 border-t border-border bg-surface/95 shadow-[0_-2px_12px_rgba(0,0,0,0.08)] backdrop-blur-sm transition-transform duration-300 lg:hidden",
            cookieBannerVisible ? "bottom-[72px] sm:bottom-16" : "bottom-0",
            barVisible ? "translate-y-0" : "pointer-events-none translate-y-full"
          )}
        >
          <div className="flex h-full items-center gap-3 px-4">
            <div className="min-w-0 text-base font-semibold text-foreground">{s.freeLabel}</div>
            <div className="flex-1" />
            <Button type="button" size="lg" className="rounded-[var(--site-radius)]" disabled={continueDisabled} loading={continueLoading} onClick={onContinue} tabIndex={barVisible ? 0 : -1}>
              {continueLabel}
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
