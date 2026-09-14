"use client";

import { Ban, Clock } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useLocalizePath } from "@/context/locale-alternates-context";
import type { AppointmentBooking } from "@/lib/api/types";
import { formatDayLabel, formatTime } from "@/lib/telehealth-format";
import { cn } from "@/lib/utils";

/**
 * `.claude/design-notes-telehealth.md` §12.5.3 — "Toplantıya Katıl" CTA, aktif/pasif durumları.
 * `disabled` bir `<a>`/`<button>` fare/klavye odağını ALMADIĞI için Tooltip tetiklenmez; bu
 * yüzden devre dışıyken bir `<span tabIndex={0}>` sarmalayıcı kullanılır (mevcut Tooltip
 * primitifinin önerdiği desen).
 *
 * Grid görevi (2026-09-14) Görev 2 madde 3 — `mergeRemainingTime` OPSİYONEL modu eklendi: doktor
 * konsolu hasta kartında (`doctor-console-patient-card.tsx`) AYRI bir `RemainingTimeBadge` +
 * bu buton İKİ AYRI elemandı (gereksiz tekrar) — bu modda "kalan süre" mantığı (eski
 * `RemainingTimeBadge`'in BİREBİR aynı eşikleri: -15dk/-0dk/pencere içi/pencere sonrası) BU
 * bileşene taşındı. Seans vakti HENÜZ gelmediyse buton yerine GRİ/UYARI renkli, buton-OLMAYAN bir
 * bekleme etiketi gösterilir; yalnızca katılım penceresi AÇIKKEN gerçek (aktif) buton render
 * edilir. Ödeme eksik/randevu yok/pencere kapandı durumları (nadir görülür) mevcut
 * disabled-tooltip desenine DÜŞER — task'ın "bu 2 durum korunabilir" kararı.
 *
 * Varsayılan (`mergeRemainingTime` verilmezse) davranış DEĞİŞMEDİ —`booking-list-view.tsx`/
 * `booking-summary-card.tsx` mevcut disabled-tooltip desenini AYNEN KORUR (qa-agent'ın
 * `telehealth-multi-slot-booking.spec.ts` "madde 24" testi aktif "Toplantıya Katıl" link adına
 * bağımlı, KIRILMAZ).
 */
interface JoinMeetingButtonProps {
  booking: Pick<AppointmentBooking, "paymentStatus" | "joinableFrom" | "joinableUntil" | "appointments">;
  /** Hasta için magic-link token'ı — doktor/oturum bağlamında verilmez. */
  accessToken?: string;
  size?: "sm" | "lg";
  /** Doktor konsolu (2026-09-14) — eski `RemainingTimeBadge` mantığını devreye alır. */
  mergeRemainingTime?: boolean;
  /** `mergeRemainingTime` bekleme etiketinin tarih/saat biçimlendirmesi için — verilmezse tarayıcı dilimi. */
  timeZone?: string;
  /** Kalibre edilmiş "şu an" (ms) — verilmezse `Date.now()`. */
  nowMs?: number;
  /** Aktif (katılınabilir) durumdaki buton etiketi. */
  activeLabel?: string;
  /** Aktif durumda `success` (yeşil) mi yoksa varsayılan marka rengi mi kullanılacağı. */
  activeVariant?: "default" | "success";
}

export function JoinMeetingButton({
  booking,
  accessToken,
  size = "sm",
  mergeRemainingTime = false,
  timeZone,
  nowMs,
  activeLabel = "Toplantıya Katıl",
  activeVariant = "default",
}: JoinMeetingButtonProps) {
  const localize = useLocalizePath();
  const firstAppointment = booking.appointments[0];
  // eslint-disable-next-line react-hooks/purity -- `availability-calendar.tsx` İLE AYNI gerekçe: katılım penceresi durumunu "şu an" ile karşılaştırmak GEREKİR, saniyede bir tick atan bir sayaç GEREKMEZ, yalnızca render anındaki an yeterlidir
  const now = nowMs ?? Date.now();

  // §mergeRemainingTime — ödeme tamamsa VE katılım penceresi bilgisi mevcutsa AMA pencere HENÜZ
  // açılmadıysa, disabled-tooltip buton yerine eski `RemainingTimeBadge`'in ürettiği bekleme
  // etiketi gösterilir. Pencere ZATEN açıksa (veya kapandıysa) bu blok atlanır, akış normal
  // aktif/disabled buton mantığına devam eder.
  if (mergeRemainingTime && firstAppointment && booking.paymentStatus === "PAID" && booking.joinableFrom && booking.joinableUntil) {
    const fromMs = new Date(booking.joinableFrom).getTime();
    const untilMs = new Date(booking.joinableUntil).getTime();
    const resolvedTimeZone = timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;

    if (now < fromMs - 15 * 60_000) {
      return (
        <span className="text-xs text-foreground/60">
          {formatDayLabel(booking.joinableFrom, resolvedTimeZone)} · {formatTime(booking.joinableFrom, resolvedTimeZone)}
        </span>
      );
    }
    if (now < fromMs) {
      const minutesLeft = Math.max(1, Math.ceil((fromMs - now) / 60_000));
      return (
        <Badge tone="warning" solid size="sm" className="gap-1">
          <Clock className="h-3 w-3" aria-hidden="true" />
          {minutesLeft} dk içinde
        </Badge>
      );
    }
    if (now > untilMs) {
      return (
        <Badge tone="neutral" size="sm" className="gap-1">
          <Ban className="h-3 w-3" aria-hidden="true" />
          Süresi Geçti
        </Badge>
      );
    }
    // Pencere şu an AÇIK — aşağıdaki normal akışa devam edilir (aktif buton render edilir).
  }

  let disabled = true;
  let disabledReason = "Görüşme bilgisi bulunamadı.";

  if (booking.paymentStatus !== "PAID") {
    disabledReason = "Görüşmeye katılmak için önce ödeme tamamlanmalıdır.";
  } else if (!booking.joinableFrom || !booking.joinableUntil) {
    disabledReason = "Görüşme henüz açılmadı.";
  } else if (now < new Date(booking.joinableFrom).getTime()) {
    disabledReason = "Görüşme, randevu saatinize 10 dakika kalana kadar açılmaz.";
  } else if (now > new Date(booking.joinableUntil).getTime()) {
    disabledReason = "Görüşme penceresi kapandı.";
  } else {
    disabled = false;
  }

  if (!firstAppointment) disabled = true;

  const href = firstAppointment
    ? localize(`/consultation/${firstAppointment.id}${accessToken ? `?t=${encodeURIComponent(accessToken)}` : ""}`)
    : "#";

  if (!disabled) {
    return (
      <a
        href={href}
        className={cn(buttonVariants({ size, variant: activeVariant === "success" ? "success" : "default" }), "rounded-[var(--site-radius)]")}
      >
        {activeLabel}
      </a>
    );
  }

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            role="button"
            aria-disabled="true"
            tabIndex={0}
            className={cn(buttonVariants({ size }), "rounded-[var(--site-radius)] pointer-events-none")}
          />
        }
      >
        {activeLabel}
      </TooltipTrigger>
      <TooltipContent>{disabledReason}</TooltipContent>
    </Tooltip>
  );
}
