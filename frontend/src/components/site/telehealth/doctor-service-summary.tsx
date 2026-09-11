"use client";

import { useEffect, useRef, useState } from "react";
import { CalendarCheck, Clock } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { COOKIE_BANNER_VISIBILITY_EVENT } from "@/components/site/cookie-consent-banner";
import { DoctorAvatarMedia } from "@/components/site/telehealth/doctor-avatar";
import { useBookingSelection } from "@/components/site/telehealth/booking-selection-context";
import { formatPriceFromCents } from "@/lib/format-price";
import { formatDayLabel, formatTime } from "@/lib/telehealth-format";
import type { DoctorProfile } from "@/lib/api/types";
import { cn } from "@/lib/utils";

/**
 * `.claude/design-notes-telehealth.md` §2.4 — "Hizmet Özeti" paneli, §2.1.4'ün sade fiyat+CTA
 * panelini (eski `doctor-price-panel.tsx`) GENİŞLETİR: doktor profili özeti + hizmet detayı +
 * seçilen randevu satırı + fiyat/CTA. Dosya BİLİNÇLİ olarak YENİDEN ADLANDIRILDI
 * (`doctor-price-panel.tsx` → `doctor-service-summary.tsx`, bileşen adı `DoctorPricePanel` →
 * `DoctorServiceSummaryPanel`) — artık sadece fiyatı DEĞİL, doktor+hizmet+randevu özetini taşıyor,
 * eski ad yanıltıcı olurdu.
 *
 * `selectedSlot`/`displayTimeZone` `booking-selection-context.tsx`'ten OKUNUR — bu panel `AvailabilityCalendar`
 * ile KARDEŞ Server Component ağaçlarının (page.tsx'in sol/sağ sütunları) İÇİNDE render edildiği
 * için state prop-drilling ile PAYLAŞILAMAZ, context TEK doğruluk kaynağıdır (bkz. context
 * dosyasının başlığı). Bu panel context'e YAZMAZ, yalnızca OKUR (salt-okunur özet).
 *
 * §2.1.4/§2.1.5'in sticky/mobil-çubuk MEKANİZMASI DEĞİŞMEDİ — sticky sarmalayıcı
 * (`lg:sticky lg:top-24 lg:max-h-[calc(100vh-7rem)] lg:self-start lg:overflow-y-auto`)
 * `doctors/[slug]/page.tsx`'te uygulanır; mobildeki sade `fixed bottom-0` çubuk (§2.1.5,
 * `sticky-add-to-cart-bar.tsx` İLE BİREBİR AYNI desen) BİLİNÇLİ olarak SADE kalır (yalnızca
 * fiyat+CTA) — zengin özet İÇERİĞİ o dar `h-16` çubuğa SIKIŞTIRILMAZ (§2.4.6).
 */
interface DoctorServiceSummaryPanelProps {
  doctor: DoctorProfile;
  /** Sayfanın kendi slot takvimine kaydırır (`#randevu`) — `doctor-card.tsx`'in `ctaHref`iyle AYNI mekanizma. */
  ctaHref: string;
  /** `formatPriceFromCents`'in `locale` parametresi — verilmezse fonksiyonun kendi varsayılanı (`"tr-TR"`) kullanılır. */
  intlLocale?: string;
}

export function DoctorServiceSummaryPanel({ doctor, ctaHref, intlLocale }: DoctorServiceSummaryPanelProps) {
  const { selectedSlot, displayTimeZone } = useBookingSelection();
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

  const price = formatPriceFromCents(doctor.sessionPriceCents, doctor.currency, intlLocale);
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

        {/* §2.4.4 — dinamik "Seçilen Randevu" satırı. */}
        <div className="mt-4 rounded-[var(--site-radius)] border border-border bg-muted/50 p-3">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-foreground/50">Seçilen Randevu</p>
          {selectedSlot ? (
            <p className="mt-1 flex items-center gap-1.5 text-sm font-medium text-foreground">
              <CalendarCheck className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
              {formatDayLabel(selectedSlot.startsAt, displayTimeZone)} · {formatTime(selectedSlot.startsAt, displayTimeZone)}
            </p>
          ) : (
            <p className="mt-1 text-sm text-foreground/40">Tarih ve saat seçin</p>
          )}
        </div>

        {/* §2.4.5 — fiyat + CTA (`selectedSlot` olmasa da CTA DEVRE DIŞI BIRAKILMAZ, takvime çapa). */}
        <div className="mt-4 flex items-baseline gap-1.5">
          <span className="text-2xl font-semibold text-foreground">{price}</span>
          <span className="text-sm text-foreground/60">/ seans</span>
        </div>
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
