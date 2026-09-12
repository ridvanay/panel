"use client";

import { useEffect, useRef, useState } from "react";
import { CalendarCheck, Clock, Pencil, X } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { COOKIE_BANNER_VISIBILITY_EVENT } from "@/components/site/cookie-consent-banner";
import { DoctorAvatarMedia } from "@/components/site/telehealth/doctor-avatar";
import { useBookingSelection } from "@/components/site/telehealth/booking-selection-context";
import { formatPriceFromCents } from "@/lib/format-price";
import { formatDayLabel, formatTime } from "@/lib/telehealth-format";
import type { DoctorProfile } from "@/lib/api/types";
import { cn } from "@/lib/utils";

/**
 * `.claude/design-notes-telehealth.md` §2.4/§12 — "Hizmet Özeti" paneli, §2.1.4'ün sade fiyat+CTA
 * panelini GENİŞLETİR: doktor profili özeti + hizmet detayı + ÇOKLU seçilen slot çip listesi
 * (§12.2.4) + dinamik toplam tutar (§12.2.5) + fiyat/CTA.
 *
 * [TCT] §9.7.2 (bağlayıcı) — §12.1: standalone "seçim onay şeridi" KALDIRILDI, "Değiştir"
 * aksiyonu bu kutunun başlık satırının SAĞINA taşındı (TÜM seçimi temizler); çip'in kendi `X`'i
 * SADECE o tek slotu kaldırır (farklı granülarite, §12.2.4).
 *
 * `selectedSlots`/`displayTimeZone` `booking-selection-context.tsx`'ten OKUNUR — bu panel
 * `AvailabilityCalendar` ile KARDEŞ Server Component ağaçlarının İÇİNDE render edildiği için
 * state prop-drilling ile PAYLAŞILAMAZ, context TEK doğruluk kaynağıdır.
 */
interface DoctorServiceSummaryPanelProps {
  doctor: DoctorProfile;
  /** Sayfanın kendi slot takvimine kaydırır (`#randevu`) — `doctor-card.tsx`'in `ctaHref`iyle AYNI mekanizma. */
  ctaHref: string;
  /** `formatPriceFromCents`'in `locale` parametresi — verilmezse fonksiyonun kendi varsayılanı (`"tr-TR"`) kullanılır. */
  intlLocale?: string;
}

export function DoctorServiceSummaryPanel({ doctor, ctaHref, intlLocale }: DoctorServiceSummaryPanelProps) {
  const { selectedSlots, removeSlot, clearAllSlots, displayTimeZone } = useBookingSelection();
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

  const unitPrice = formatPriceFromCents(doctor.sessionPriceCents, doctor.currency, intlLocale);
  const slotCount = selectedSlots.length;
  const totalCents = doctor.sessionPriceCents * slotCount;
  // §2.4.3 — `doctor-profile-hero.tsx`'in uzmanlık chip'iyle AYNI fallback zinciri, sabit
  // "Profesyonel Danışmanlık Seansı" metni İCAT EDİLMEZ.
  const specialtyName = doctor.specialty?.name ?? "Genel Danışmanlık";

  return (
    <>
      <div ref={panelRef} className="rounded-[var(--site-radius)] border border-border bg-surface p-5 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wider text-foreground/50">Hizmet Özeti</p>

        {/* §2.4.2 — doktor profili satırı. */}
        <div className="mt-4 flex items-center gap-3">
          <DoctorAvatarMedia doctor={doctor} sizeClassName="h-12 w-12 rounded-full shrink-0" textClassName="text-base" sizes="48px" />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-foreground">
              {doctor.title} {doctor.fullName}
            </p>
            <p className="truncate text-xs text-foreground/60">{specialtyName}</p>
          </div>
        </div>

        <div className="my-4 border-t border-border" />

        {/* §2.4.3 — hizmet detayı satırı. */}
        <div className="flex items-center justify-between gap-2 text-sm">
          <span className="text-foreground/80">{specialtyName} Seansı</span>
          <span className="flex shrink-0 items-center gap-1 text-foreground/60">
            <Clock className="h-3.5 w-3.5" aria-hidden="true" />
            {doctor.sessionDurationMin} Dk.
          </span>
        </div>

        {/* §12.2.4 — "Seçilen Randevu" kutusu, çoklu-çip listesi. */}
        <div className="mt-4 rounded-[var(--site-radius)] border border-border bg-muted/50 p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-foreground/50">Seçilen Randevu</p>
            {slotCount > 0 && (
              <button
                type="button"
                onClick={clearAllSlots}
                className="flex shrink-0 items-center gap-1 rounded-[var(--site-radius)] px-1.5 py-0.5 text-xs font-medium text-primary transition-colors hover:bg-primary/10 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
              >
                <Pencil className="h-3 w-3" aria-hidden="true" />
                Değiştir
              </button>
            )}
          </div>

          {slotCount === 0 ? (
            <p className="mt-1 text-sm text-foreground/40">Tarih ve saatleri seçin</p>
          ) : (
            <>
              <p className="mt-2 flex items-center gap-1.5 text-sm font-medium text-foreground">
                <CalendarCheck className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
                {formatDayLabel(selectedSlots[0]!.startsAt, displayTimeZone)}
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {selectedSlots.map((slot) => (
                  <span
                    key={slot.startsAt}
                    className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 py-1 pl-2.5 pr-1.5 text-xs font-medium tabular-nums text-primary"
                  >
                    {formatTime(slot.startsAt, displayTimeZone)}
                    <button
                      type="button"
                      onClick={() => removeSlot(slot)}
                      aria-label={`${formatTime(slot.startsAt, displayTimeZone)} slotunu kaldır`}
                      className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-primary/70 hover:bg-primary/20 hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                    >
                      <X className="h-3 w-3" aria-hidden="true" />
                    </button>
                  </span>
                ))}
              </div>
              <p className="mt-2 text-xs text-foreground/60">
                {slotCount} Slot · {slotCount * doctor.sessionDurationMin} Dk
              </p>
            </>
          )}
        </div>

        {/* §12.2.5 — tekil/çoklu fiyat sunumu ayrımı. */}
        {slotCount > 1 ? (
          <div className="mt-4 space-y-1.5 border-t border-border pt-4">
            <div className="flex items-center justify-between text-xs text-foreground/60">
              <span>
                {unitPrice} × {slotCount} seans
              </span>
              <span>{formatPriceFromCents(doctor.sessionPriceCents * slotCount, doctor.currency, intlLocale)}</span>
            </div>
            <div className="flex items-baseline justify-between">
              <span className="text-sm font-semibold text-foreground">Toplam</span>
              <span className="text-2xl font-semibold text-foreground">{formatPriceFromCents(totalCents, doctor.currency, intlLocale)}</span>
            </div>
          </div>
        ) : (
          <div className="mt-4 flex items-baseline gap-1.5">
            <span className="text-2xl font-semibold text-foreground">{unitPrice}</span>
            <span className="text-sm text-foreground/60">/ seans</span>
          </div>
        )}

        <a href={ctaHref} className={cn(buttonVariants({ size: "lg" }), "mt-3 w-full rounded-[var(--site-radius)]")}>
          Randevu Al
        </a>
      </div>

      {/* §2.1.5/§2.4.6 — mobil sade alt çubuk, `sticky-add-to-cart-bar.tsx` İLE BİREBİR AYNI desen,
          DEĞİŞMEDİ (yalnızca fiyat+CTA, zengin özet İÇERİĞİ BURAYA SIKIŞTIRILMAZ). */}
      <div
        aria-hidden={!barVisible}
        className={cn(
          "fixed inset-x-0 z-40 h-16 border-t border-border bg-surface/95 shadow-[0_-2px_12px_rgba(0,0,0,0.08)] backdrop-blur-sm transition-transform duration-300 lg:hidden",
          cookieBannerVisible ? "bottom-[72px] sm:bottom-16" : "bottom-0",
          barVisible ? "translate-y-0" : "pointer-events-none translate-y-full"
        )}
      >
        <div className="flex h-full items-center gap-3 px-4">
          <div className="min-w-0 text-base font-semibold text-foreground">{slotCount > 1 ? formatPriceFromCents(totalCents, doctor.currency, intlLocale) : unitPrice}</div>
          <div className="flex-1" />
          <a href={ctaHref} className={cn(buttonVariants({ size: "lg" }), "rounded-[var(--site-radius)]")}>
            Randevu Al
          </a>
        </div>
      </div>
    </>
  );
}
