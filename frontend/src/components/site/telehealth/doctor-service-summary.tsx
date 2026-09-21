"use client";

import { useEffect, useRef, useState } from "react";
import { CalendarCheck, Clock, Pencil, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { COOKIE_BANNER_VISIBILITY_EVENT } from "@/components/site/cookie-consent-banner";
import { DoctorAvatarMedia } from "@/components/site/telehealth/doctor-avatar";
import { useBookingSelection } from "@/components/site/telehealth/booking-selection-context";
import { formatPriceFromCents } from "@/lib/format-price";
import { formatDayLabel, formatTime } from "@/lib/telehealth-format";
import type { DoctorProfile } from "@/lib/api/types";
import { formatSiteString } from "@/lib/i18n/site-dictionaries";
import type { TelehealthStrings } from "@/lib/i18n/site-dictionaries";
import { telehealthStrings as legacyFallbackTelehealthStrings } from "@/lib/i18n/site-dictionaries/tr/telehealth";
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
 *
 * Grid görevi (2026-09-14) Görev 1 — eski `ctaHref` ANKOR butonu ("Randevu Al", `#randevu`'ya
 * kaydırıyordu, bir SUBMIT DEĞİLDİ) KALDIRILDI; bu panel artık `booking-wizard.tsx`'in İÇİNDE
 * render edilir ve TEK dinamik "Devam Et" butonunu barındırır (`currentStep`'e göre adım 2'de
 * "en az 1 slot seçili" koşulunu, adım 3'te `booking-identity-step.tsx` doğrulamasının SONUCUNU
 * `continueDisabled` prop'u üzerinden dışarıdan alır — bu panel KENDİ doğrulama mantığını
 * İCAT ETMEZ, yalnızca dışarıdan gelen durumu render eder). `locked` (adım 4/5, booking ZATEN
 * oluşturulduktan sonra) modunda "Değiştir"/çip kaldırma aksiyonları GİZLENİR (booking'i
 * ETKİLEMEYEN salt-okunur bir özet) VE "Devam Et" butonu HİÇ render edilmez — o adımların KENDİ
 * birincil aksiyonu (`BookingIntakeStep`/`BookingPaymentStep`) TEK buton olarak kalır.
 */
interface DoctorServiceSummaryPanelProps {
  doctor: DoctorProfile;
  /** `formatPriceFromCents`'in `locale` parametresi — verilmezse fonksiyonun kendi varsayılanı (`"tr-TR"`) kullanılır. */
  intlLocale?: string;
  currentStep: 2 | 3 | 4 | 5;
  onContinue: () => void;
  continueDisabled: boolean;
  continueLoading: boolean;
  /** Adım 2/3'te `true` — "Devam Et" butonu render edilir. Adım 4/5'te `false` (o adımların KENDİ butonu var). */
  showContinueButton: boolean;
  /** Adım 4/5 — booking ZATEN oluşturuldu, seçim artık DEĞİŞTİRİLEMEZ (salt-okunur özet). */
  locked: boolean;
  /**
   * `.claude/architect-scope-i18n.md` §14.3/§14.5 madde 9 — bu bileşen `booking-wizard.tsx`'in
   * (Faz 2 kapsamı, DOKUNULMADI) İÇİNDE render edilir; `dict` bu yüzden OPSİYONELDİR.
   *
   * **Geriye dönük uyumluluk sapması (BİLİNÇLİ, `site-header.tsx`'teki AYNI gerekçe):** §14.3'ün
   * harfi "verilmezse KAYNAK dile (`en`) düşer" der, ANCAK `booking-wizard.tsx` (Faz 2, bu turda
   * DOKUNULMADI) bu bileşene HENÜZ `dict` GEÇİRMİYOR — bugünkü ÜRETİM randevu sihirbazı baştan
   * sona Türkçedir. EN kaynağa düşmek, Faz 2 bu bileşene gerçek `dict`'i bağlayana kadar sihirbazın
   * İÇİNDE tek bir panelin aniden İngilizceye dönmesine (karışık dil, kullanıcıyı şaşırtan bir
   * regresyon) yol açardı — bu yüzden verilmezse mevcut/legacy Türkçe metinlerle BİREBİR aynı
   * `tr/telehealth.ts`'e düşer (`doctor-service-summary.test.tsx`, 4 protected `site-header-*`
   * testiyle AYNI mantık — mevcut testler DEĞİŞTİRİLMEDEN geçer).
   */
  dict?: TelehealthStrings;
}

export function DoctorServiceSummaryPanel({
  doctor,
  intlLocale,
  currentStep,
  onContinue,
  continueDisabled,
  continueLoading,
  showContinueButton,
  locked,
  dict = legacyFallbackTelehealthStrings,
}: DoctorServiceSummaryPanelProps) {
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

  const isFree = doctor.sessionPriceCents == null;
  const unitPrice = doctor.sessionPriceCents != null ? formatPriceFromCents(doctor.sessionPriceCents, doctor.currency, intlLocale) : dict.freeSessionLabel;
  const slotCount = selectedSlots.length;
  const totalCents = (doctor.sessionPriceCents ?? 0) * slotCount;
  // §2.4.3 — `doctor-profile-hero.tsx`'in uzmanlık chip'iyle AYNI fallback zinciri, sabit
  // "Profesyonel Danışmanlık Seansı" metni İCAT EDİLMEZ.
  const specialtyName = doctor.specialty?.name ?? dict.generalConsultationSpecialty;

  return (
    <>
      <div ref={panelRef} className="rounded-[var(--site-radius)] border border-border bg-surface p-5 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wider text-foreground/50">{dict.serviceSummaryLabel}</p>

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
          <span className="text-foreground/80">{formatSiteString(dict.sessionWithSpecialtyLabel, { specialty: specialtyName })}</span>
          <span className="flex shrink-0 items-center gap-1 text-foreground/60">
            <Clock className="h-3.5 w-3.5" aria-hidden="true" />
            {formatSiteString(dict.serviceDurationLabel, { minutes: doctor.sessionDurationMin })}
          </span>
        </div>

        {/* §12.2.4 — "Seçilen Randevu" kutusu, çoklu-çip listesi. */}
        <div className="mt-4 rounded-[var(--site-radius)] border border-border bg-muted/50 p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-foreground/50">{dict.selectedAppointmentLabel}</p>
            {/* Grid görevi (2026-09-14) Görev 1 — `locked` (adım 4/5) modunda booking ZATEN
                oluşturulduğu için "Değiştir" KALDIRILIR (tıklanırsa yalnızca UI'daki seçimi
                temizler, gerçek booking'i ETKİLEMEZ — kafa karıştırıcı olurdu). */}
            {slotCount > 0 && !locked && (
              <button
                type="button"
                onClick={clearAllSlots}
                className="flex shrink-0 items-center gap-1 rounded-[var(--site-radius)] px-1.5 py-0.5 text-xs font-medium text-primary transition-colors hover:bg-primary/10 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
              >
                <Pencil className="h-3 w-3" aria-hidden="true" />
                {dict.changeAction}
              </button>
            )}
          </div>

          {slotCount === 0 ? (
            <p className="mt-1 text-sm text-foreground/40">{dict.selectDateTimePrompt}</p>
          ) : (
            <>
              <p className="mt-2 flex items-center gap-1.5 text-sm font-medium text-foreground">
                <CalendarCheck className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
                {formatDayLabel(selectedSlots[0]!.startsAt, displayTimeZone, intlLocale)}
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {selectedSlots.map((slot) => (
                  <span
                    key={slot.startsAt}
                    className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 py-1 pl-2.5 pr-1.5 text-xs font-medium tabular-nums text-primary"
                  >
                    {formatTime(slot.startsAt, displayTimeZone, intlLocale)}
                    {!locked && (
                      <button
                        type="button"
                        onClick={() => removeSlot(slot)}
                        aria-label={formatSiteString(dict.removeSlotAriaLabel, {
                          time: formatTime(slot.startsAt, displayTimeZone, intlLocale),
                        })}
                        className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-primary/70 hover:bg-primary/20 hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                      >
                        <X className="h-3 w-3" aria-hidden="true" />
                      </button>
                    )}
                  </span>
                ))}
              </div>
              <p className="mt-2 text-xs text-foreground/60">
                {formatSiteString(dict.slotSummaryLabel, { count: slotCount, minutes: slotCount * doctor.sessionDurationMin })}
              </p>
            </>
          )}
        </div>

        {/* §12.2.5 — tekil/çoklu fiyat sunumu ayrımı. */}
        {slotCount > 1 ? (
          <div className="mt-4 space-y-1.5 border-t border-border pt-4">
            <div className="flex items-center justify-between text-xs text-foreground/60">
              <span>
                {unitPrice} × {slotCount} {dict.sessionsUnitWord}
              </span>
              <span>{isFree ? dict.freeSessionLabel : formatPriceFromCents(totalCents, doctor.currency, intlLocale)}</span>
            </div>
            <div className="flex items-baseline justify-between">
              <span className="text-sm font-semibold text-foreground">{dict.totalLabel}</span>
              <span className="text-2xl font-semibold text-foreground">{isFree ? dict.freeSessionLabel : formatPriceFromCents(totalCents, doctor.currency, intlLocale)}</span>
            </div>
          </div>
        ) : (
          <div className="mt-4 flex items-baseline gap-1.5">
            <span className="text-2xl font-semibold text-foreground">{unitPrice}</span>
            {!isFree && <span className="text-sm text-foreground/60">{dict.perSessionPriceSuffix}</span>}
          </div>
        )}

        {/* Grid görevi (2026-09-14) Görev 1 — eski "Randevu Al" ANKOR (`#randevu`'ya kaydıran,
            SUBMIT OLMAYAN bir CTA) KALDIRILDI. TEK gerçek aksiyon butonu — dış (`booking-wizard.tsx`)
            `currentStep`'e göre adım 2'de "en az 1 slot seç", adım 3'te "kimlik formunu doğrula ve
            gönder" davranışını buraya `onContinue`/`continueDisabled` ile bağlar. Adım 4/5'te
            (`showContinueButton=false`) bu buton HİÇ render edilmez — o adımların KENDİ birincil
            aksiyonu (Kaydet ve Devam Et / Bu adımı atla / Ödemeye Geç) TEK buton olarak kalır. */}
        {showContinueButton && (
          <div className="mt-3 space-y-1.5">
            <Button type="button" size="lg" className="w-full rounded-[var(--site-radius)]" disabled={continueDisabled} loading={continueLoading} onClick={onContinue}>
              {dict.continueCta}
            </Button>
            <p className="text-center text-[11px] text-foreground/40">{formatSiteString(dict.stepProgressLabel, { current: currentStep })}</p>
          </div>
        )}
      </div>

      {/* §2.1.5/§2.4.6 — mobil sade alt çubuk, `sticky-add-to-cart-bar.tsx` İLE BİREBİR AYNI desen
          (yalnızca fiyat+CTA, zengin özet İÇERİĞİ BURAYA SIKIŞTIRILMAZ). Adım 4/5'te (booking
          zaten oluşmuşken) TAMAMEN GİZLENİR — o adımların kendi butonu sayfanın kendi akışında
          zaten görünür, mobilde de İKİNCİ bir sabit CTA ÇUBUĞU YARATILMAZ. */}
      {showContinueButton && (
        <div
          aria-hidden={!barVisible}
          className={cn(
            "fixed inset-x-0 z-40 h-16 border-t border-border bg-surface/95 shadow-[0_-2px_12px_rgba(0,0,0,0.08)] backdrop-blur-sm transition-transform duration-300 lg:hidden",
            cookieBannerVisible ? "bottom-[72px] sm:bottom-16" : "bottom-0",
            barVisible ? "translate-y-0" : "pointer-events-none translate-y-full"
          )}
        >
          <div className="flex h-full items-center gap-3 px-4">
            <div className="min-w-0 text-base font-semibold text-foreground">
              {slotCount > 1 ? (isFree ? dict.freeSessionLabel : formatPriceFromCents(totalCents, doctor.currency, intlLocale)) : unitPrice}
            </div>
            <div className="flex-1" />
            <Button type="button" size="lg" className="rounded-[var(--site-radius)]" disabled={continueDisabled} loading={continueLoading} onClick={onContinue}>
              {dict.continueCta}
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
