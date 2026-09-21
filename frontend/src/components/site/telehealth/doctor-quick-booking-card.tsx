"use client";

import { CalendarClock, FileText, ShieldCheck } from "lucide-react";
import type { DoctorProfile } from "@/lib/api/types";
import { buttonVariants } from "@/components/ui/button";
import { formatPriceFromCents } from "@/lib/format-price";
import { formatDayLabel } from "@/lib/telehealth-format";
import { formatSiteString } from "@/lib/i18n/site-dictionaries";
import type { TelehealthStrings } from "@/lib/i18n/site-dictionaries";
import { useBookingSelection } from "@/components/site/telehealth/booking-selection-context";
import { cn } from "@/lib/utils";

/**
 * Grid görevi (2026-09-14) Görev 2b — `doctors/[slug]` sağ sütununun sticky "Hızlı Randevu"
 * kartı. `doctor-service-summary.tsx`'teki `DoctorServiceSummaryPanel` İLE KARIŞTIRILMAZ: o panel
 * `BookingWizard`'ın İÇİNDE (adım 2-5) `useBookingSelection()` context'ine BAĞIMLI, GERÇEK
 * seçim/booking durumunu render eder. BU kart TAMAMEN AYRI, context'e BAĞIMSIZ, SADECE bir
 * ÖNİZLEME/köprüdür — kendi içinde mini takvim/slot seçici İNŞA ETMEZ (BİLİNÇLİ KARAR, 2 tur önce
 * çözülen "çift buton/çakışan randevu akışı" sorununun GERİ GELMEMESİ için). GERÇEK randevu
 * seçimi/oluşturma TEK yerde (`BookingWizard`, `#randevu` section'ı) kalır — bu kart yalnızca o
 * section'a `<a href="#randevu">` ile KAYDIRIR.
 *
 * 2026-09-21 GÜNCELLEME (kullanıcı talebi) — "context'e bağımsız" ilkesi HÂLÂ geçerlidir (kendi
 * booking mantığı/state'i İNŞA ETMEZ), ama artık `booking-selection-context.tsx`'in paylaşılan
 * `hasCompletedBooking`/`requestBookingReset`ını OKUR/TETİKLER — sihirbaz zaten tamamlanmış bir
 * rezervasyon gösteriyorken bu CTA'ya tıklamak salt kaydırma YERİNE sihirbazı Adım 2'ye sıfırlar
 * (bkz. `booking-wizard.tsx`'teki `resetWizard`/`resetSignal` notu).
 */
interface DoctorQuickBookingCardProps {
  doctor: DoctorProfile;
  /** `page.tsx`'te aynı `slots` dizisinden türetilen en erken müsait ISO zaman damgası, veya hiç
   * müsait slot yoksa `null` — bu bileşen KENDİ hesabını YAPMAZ, salt-okunur bir gösterim alanıdır. */
  earliestAvailableIso: string | null;
  /** `formatPriceFromCents`'in `locale` parametresi — `doctor-service-summary.tsx` İLE AYNI desen. */
  intlLocale?: string;
  /**
   * `.claude/architect-scope-i18n.md` §14.5 madde 9 — sunucu ebeveyninden prop olarak geçirilir.
   * Bu bileşen SENKRON kalmak ZORUNDADIR — `doctor-profile-hero.tsx`'teki AYNI gerekçe (qa-agent
   * bulgusu: `@testing-library/react`/jsdom `async` Server Component render EDEMEZ).
   */
  dict: TelehealthStrings;
}

export function DoctorQuickBookingCard({ doctor, earliestAvailableIso, intlLocale, dict }: DoctorQuickBookingCardProps) {
  const unitPrice = doctor.sessionPriceCents != null ? formatPriceFromCents(doctor.sessionPriceCents, doctor.currency, intlLocale) : dict.freeSessionLabel;
  // Bug-fix turu (2026-09-21, kullanıcı talebi) — bu kart KENDİ booking mantığını İNŞA ETMEZ
  // (dosya başı yorum, DEĞİŞMEDİ), ama `BookingWizard` (KARDEŞ ağaç, `booking-selection-context.tsx`
  // paylaşılan context'i üzerinden) ZATEN tamamlanmış bir rezervasyonu gösteriyorsa, bu CTA'ya
  // tıklamak yalnızca `#randevu`'ya kaydırmak YERİNE sihirbazı TEMİZ Adım 2'ye SIFIRLAMALIDIR —
  // aksi halde kullanıcı eski "randevunuz tamamlandı" ekranına kaydırılır, yeni tarih SEÇEMEZ.
  const { hasCompletedBooking, requestBookingReset } = useBookingSelection();

  return (
    <div className="rounded-[var(--site-radius)] border border-border bg-surface p-5 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wider text-foreground/50">{dict.quickBookingLabel}</p>

      {/* Grid görevi (2026-09-14) — ui-designer turu: "kurumsal randevu widget'ı" fiyat vurgusu için
          `text-2xl font-semibold` → `text-3xl font-bold tracking-tight` (H1'deki `tracking-tight`
          diliyle TUTARLI). Süre etiketi `font-medium` — bold fiyatın yanında okunurluğu korumak için. */}
      <div className="mt-4 flex items-baseline gap-1.5">
        <span className="text-3xl font-bold tracking-tight text-foreground">{unitPrice}</span>
        <span className="text-sm font-medium text-foreground/60">
          {formatSiteString(dict.perUnitDurationSuffix, { minutes: doctor.sessionDurationMin })}
        </span>
      </div>

      <div className="mt-4 flex items-start gap-2 rounded-[var(--site-radius)] border border-border bg-muted/50 p-3 text-sm">
        <CalendarClock className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
        {earliestAvailableIso ? (
          <p className="text-foreground/80">
            <span className="font-medium text-foreground">{dict.earliestAppointmentLabel}</span>{" "}
            {formatDayLabel(earliestAvailableIso, doctor.timeZone, intlLocale)}
          </p>
        ) : (
          <p className="text-foreground/60">{dict.noAvailableAppointment}</p>
        )}
      </div>

      {/* Grid görevi (2026-09-14) — ui-designer turu: "Randevu Oluştur" CTA'sının görsel ağırlığı
          `buttonVariants`'ın PAYLAŞILAN `size="lg"` tabanına (h-9) göre bu KART için `h-11`/
          `text-base font-semibold` ile büyütüldü — global `button.tsx` DEĞİŞMEDİ, twMerge son
          sınıfları kazandırır. */}
      <a
        href="#randevu"
        onClick={hasCompletedBooking ? () => requestBookingReset() : undefined}
        className={cn(
          buttonVariants({ variant: "default", size: "lg" }),
          "mt-4 h-11 w-full rounded-[var(--site-radius)] text-base font-semibold",
        )}
      >
        {dict.createAppointmentCta}
      </a>

      <div className="mt-4 space-y-1.5 border-t border-border pt-4">
        {/* İkon+metin dengesi — Görev'de bu satırda İKİ ikon (Lock+ShieldCheck) art arda tek metnin
            önündeydi, alttaki satırla (TEK ikon + metin) asimetrik duruyordu; `Lock` kaldırıldı,
            `ShieldCheck` tek başına güvenlik+KVKK'yı temsil ediyor, her iki satır artık AYNI
            "1 ikon + 1 metin" ritmine sahip. */}
        <p className="flex items-center gap-1.5 text-xs text-foreground/60">
          <ShieldCheck className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {dict.securePaymentNotice}
        </p>
        <p className="flex items-center gap-1.5 text-xs text-foreground/60">
          <FileText className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {dict.recordingSupportNotice}
        </p>
      </div>
    </div>
  );
}
