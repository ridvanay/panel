import { CalendarClock, FileText, ShieldCheck } from "lucide-react";
import type { DoctorProfile } from "@/lib/api/types";
import { buttonVariants } from "@/components/ui/button";
import { formatPriceFromCents } from "@/lib/format-price";
import { formatDayLabel } from "@/lib/telehealth-format";
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
 */
interface DoctorQuickBookingCardProps {
  doctor: DoctorProfile;
  /** `page.tsx`'te aynı `slots` dizisinden türetilen en erken müsait ISO zaman damgası, veya hiç
   * müsait slot yoksa `null` — bu bileşen KENDİ hesabını YAPMAZ, salt-okunur bir gösterim alanıdır. */
  earliestAvailableIso: string | null;
  /** `formatPriceFromCents`'in `locale` parametresi — `doctor-service-summary.tsx` İLE AYNI desen. */
  intlLocale?: string;
}

export function DoctorQuickBookingCard({ doctor, earliestAvailableIso, intlLocale }: DoctorQuickBookingCardProps) {
  const unitPrice = formatPriceFromCents(doctor.sessionPriceCents, doctor.currency, intlLocale);

  return (
    <div className="rounded-[var(--site-radius)] border border-border bg-surface p-5 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wider text-foreground/50">Online Görüşme / Randevu Al</p>

      {/* Grid görevi (2026-09-14) — ui-designer turu: "kurumsal randevu widget'ı" fiyat vurgusu için
          `text-2xl font-semibold` → `text-3xl font-bold tracking-tight` (H1'deki `tracking-tight`
          diliyle TUTARLI). Süre etiketi `font-medium` — bold fiyatın yanında okunurluğu korumak için. */}
      <div className="mt-4 flex items-baseline gap-1.5">
        <span className="text-3xl font-bold tracking-tight text-foreground">{unitPrice}</span>
        <span className="text-sm font-medium text-foreground/60">/ {doctor.sessionDurationMin} Dk.</span>
      </div>

      <div className="mt-4 flex items-start gap-2 rounded-[var(--site-radius)] border border-border bg-muted/50 p-3 text-sm">
        <CalendarClock className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
        {earliestAvailableIso ? (
          <p className="text-foreground/80">
            <span className="font-medium text-foreground">En erken randevu:</span>{" "}
            {formatDayLabel(earliestAvailableIso, doctor.timeZone)}
          </p>
        ) : (
          <p className="text-foreground/60">Şu an müsait randevu bulunmuyor.</p>
        )}
      </div>

      {/* Grid görevi (2026-09-14) — ui-designer turu: "Randevu Oluştur" CTA'sının görsel ağırlığı
          `buttonVariants`'ın PAYLAŞILAN `size="lg"` tabanına (h-9) göre bu KART için `h-11`/
          `text-base font-semibold` ile büyütüldü — global `button.tsx` DEĞİŞMEDİ, twMerge son
          sınıfları kazandırır. */}
      <a
        href="#randevu"
        className={cn(
          buttonVariants({ variant: "default", size: "lg" }),
          "mt-4 h-11 w-full rounded-[var(--site-radius)] text-base font-semibold",
        )}
      >
        Randevu Oluştur
      </a>

      <div className="mt-4 space-y-1.5 border-t border-border pt-4">
        {/* İkon+metin dengesi — Görev'de bu satırda İKİ ikon (Lock+ShieldCheck) art arda tek metnin
            önündeydi, alttaki satırla (TEK ikon + metin) asimetrik duruyordu; `Lock` kaldırıldı,
            `ShieldCheck` tek başına güvenlik+KVKK'yı temsil ediyor, her iki satır artık AYNI
            "1 ikon + 1 metin" ritmine sahip. */}
        <p className="flex items-center gap-1.5 text-xs text-foreground/60">
          <ShieldCheck className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          Güvenli Ödeme &amp; KVKK Korumalı
        </p>
        <p className="flex items-center gap-1.5 text-xs text-foreground/60">
          <FileText className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          Görüşme Kaydı &amp; Epikriz Desteği
        </p>
      </div>
    </div>
  );
}
