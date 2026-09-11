"use client";

import { useEffect, useRef, useState } from "react";
import { buttonVariants } from "@/components/ui/button";
import { COOKIE_BANNER_VISIBILITY_EVENT } from "@/components/site/cookie-consent-banner";
import { formatPriceFromCents } from "@/lib/format-price";
import { cn } from "@/lib/utils";

interface DoctorPricePanelProps {
  sessionPriceCents: number;
  sessionDurationMin: number;
  currency: string;
  /** Sayfanın kendi slot takvimine kaydırır (`#randevu`) — `doctor-card.tsx`'in `ctaHref`iyle AYNI mekanizma. */
  ctaHref: string;
  /** `formatPriceFromCents`'in `locale` parametresi — verilmezse fonksiyonun kendi varsayılanı (`"tr-TR"`) kullanılır. */
  intlLocale?: string;
}

/**
 * `.claude/design-notes-telehealth.md` §2.1.4/§2.1.5 — sticky fiyat+CTA paneli (masaüstü) +
 * mobilde `sticky-add-to-cart-bar.tsx` ile BİREBİR AYNI `fixed bottom-0 z-40` alt çubuk deseni.
 * Panelin kendisi `lg:sticky lg:top-24 lg:self-start` sarmalayıcısı `doctors/[slug]/page.tsx`'te
 * uygulanır (bu bileşen yalnızca panel YÜZEYİNİ + gözlemlenen `ref`'i taşır); mobil çubuk bu
 * panel viewport'tan çıktığında görünür olur (`IntersectionObserver`, `sticky-add-to-cart-bar.tsx`
 * ile AYNI desen — YENİ bir mobil sticky-bar deseni İCAT EDİLMEDİ).
 */
export function DoctorPricePanel({ sessionPriceCents, sessionDurationMin, currency, ctaHref, intlLocale }: DoctorPricePanelProps) {
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

  const price = formatPriceFromCents(sessionPriceCents, currency, intlLocale);

  return (
    <>
      <div ref={panelRef} className="rounded-[var(--site-radius)] border border-border bg-surface p-5 shadow-sm">
        <div className="flex items-baseline gap-1.5">
          <span className="text-2xl font-semibold text-foreground">{price}</span>
          <span className="text-sm text-foreground/60">/ seans</span>
        </div>
        <p className="mt-1 text-sm text-foreground/60">{sessionDurationMin} dakika görüşme</p>
        <a href={ctaHref} className={cn(buttonVariants({ size: "lg" }), "mt-4 w-full rounded-[var(--site-radius)]")}>
          Randevu Al
        </a>
      </div>

      <div
        aria-hidden={!barVisible}
        className={cn(
          "fixed inset-x-0 z-40 h-16 border-t border-border bg-surface/95 shadow-[0_-2px_12px_rgba(0,0,0,0.08)] backdrop-blur-sm transition-transform duration-300 lg:hidden",
          cookieBannerVisible ? "bottom-[72px] sm:bottom-16" : "bottom-0",
          barVisible ? "translate-y-0" : "pointer-events-none translate-y-full"
        )}
      >
        <div className="flex h-full items-center gap-3 px-4">
          <div className="min-w-0 text-base font-semibold text-foreground">{price}</div>
          <div className="flex-1" />
          <a href={ctaHref} className={cn(buttonVariants({ size: "lg" }), "rounded-[var(--site-radius)]")}>
            Randevu Al
          </a>
        </div>
      </div>
    </>
  );
}
