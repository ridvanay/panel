"use client";

import { useEffect, useState } from "react";
import { COOKIE_BANNER_VISIBILITY_EVENT } from "@/components/site/cookie-consent-banner";
import { CalendarCheck } from "lucide-react";
import { useReviewStrings } from "@/lib/i18n/use-review-strings";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Paket Y — mobilde alt sabit "Book" düğmesi (randevu bölümüne kaydırır). Sihirbazın kendi alt çubuğuyla
 * çift çubuk oluşmasın diye, randevu bölümü (`#randevu`) ekrandayken gizlenir. `data-bottom-bar` ile
 * yüzen düğmelerin (canlı sohbet vb.) konumu otomatik ayarlanır.
 */
export function DoctorMobileBookBar({ targetId = "randevu" }: { targetId?: string }) {
  const { t } = useReviewStrings();
  const [sectionVisible, setSectionVisible] = useState(false);
  const [otherBarVisible, setOtherBarVisible] = useState(false);
  const [cookieBannerVisible, setCookieBannerVisible] = useState(false);
  const targetVisible = sectionVisible || otherBarVisible;

  useEffect(() => {
    const el = document.getElementById(targetId);
    if (!el || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => setSectionVisible(Boolean(entry?.isIntersecting)), { threshold: 0.05 });
    observer.observe(el);
    return () => observer.disconnect();
  }, [targetId]);

  // Frontend incelemesi — sihirbazın kendi alt çubuğu (ya da başka bir `data-bottom-bar`) görünürken bu çubuk gizlenir.
  useEffect(() => {
    if (typeof MutationObserver === "undefined") return;
    const check = () =>
      setOtherBarVisible(Array.from(document.querySelectorAll<HTMLElement>("[data-bottom-bar]")).some((el) => el.dataset.testid !== "doctor-mobile-book-bar" && el.getAttribute("aria-hidden") === "false"));
    check();
    const observer = new MutationObserver(check);
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["aria-hidden"] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const onVisibility = (event: Event) => setCookieBannerVisible(Boolean((event as CustomEvent<{ visible: boolean }>).detail?.visible));
    window.addEventListener(COOKIE_BANNER_VISIBILITY_EVENT, onVisibility);
    return () => window.removeEventListener(COOKIE_BANNER_VISIBILITY_EVENT, onVisibility);
  }, []);

  return (
    <div
      data-bottom-bar=""
      data-testid="doctor-mobile-book-bar"
      aria-hidden={targetVisible}
      className={cn(
        "fixed inset-x-0 z-40 border-t border-border bg-surface/95 px-4 pt-2.5 pb-[calc(0.625rem+env(safe-area-inset-bottom,0px))] shadow-[0_-2px_12px_rgba(0,0,0,0.08)] backdrop-blur-sm transition-transform duration-300 lg:hidden",
        cookieBannerVisible ? "bottom-[72px] sm:bottom-16" : "bottom-0",
        targetVisible ? "pointer-events-none translate-y-full" : "translate-y-0",
      )}
    >
      <Button
        type="button"
        size="lg"
        tabIndex={targetVisible ? -1 : 0}
        aria-label={t.bookCtaAria}
        className="w-full rounded-[var(--site-radius)]"
        onClick={() => document.getElementById(targetId)?.scrollIntoView({ behavior: "smooth", block: "start" })}
      >
        <CalendarCheck className="h-4 w-4" aria-hidden="true" />
        {t.bookCta}
      </Button>
    </div>
  );
}
