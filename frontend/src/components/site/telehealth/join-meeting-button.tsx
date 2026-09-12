"use client";

import { buttonVariants } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useLocalizePath } from "@/context/locale-alternates-context";
import type { AppointmentBooking } from "@/lib/api/types";
import { cn } from "@/lib/utils";

/**
 * `.claude/design-notes-telehealth.md` §12.5.3 — "Toplantıya Katıl" CTA, aktif/pasif durumları.
 * `disabled` bir `<a>`/`<button>` fare/klavye odağını ALMADIĞI için Tooltip tetiklenmez; bu
 * yüzden devre dışıyken bir `<span tabIndex={0}>` sarmalayıcı kullanılır (mevcut Tooltip
 * primitifinin önerdiği desen).
 */
interface JoinMeetingButtonProps {
  booking: Pick<AppointmentBooking, "paymentStatus" | "joinableFrom" | "joinableUntil" | "appointments">;
  /** Hasta için magic-link token'ı — doktor/oturum bağlamında verilmez. */
  accessToken?: string;
  size?: "sm" | "lg";
}

export function JoinMeetingButton({ booking, accessToken, size = "sm" }: JoinMeetingButtonProps) {
  const localize = useLocalizePath();
  const firstAppointment = booking.appointments[0];
  // eslint-disable-next-line react-hooks/purity -- `availability-calendar.tsx` İLE AYNI gerekçe: katılım penceresi durumunu "şu an" ile karşılaştırmak GEREKİR, saniyede bir tick atan bir sayaç GEREKMEZ, yalnızca render anındaki an yeterlidir
  const now = Date.now();

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
      <a href={href} className={cn(buttonVariants({ size }), "rounded-[var(--site-radius)]")}>
        Toplantıya Katıl
      </a>
    );
  }

  return (
    <Tooltip>
      <TooltipTrigger>
        <span tabIndex={0}>
          <button
            type="button"
            disabled
            className={cn(buttonVariants({ size }), "rounded-[var(--site-radius)] pointer-events-none")}
          >
            Toplantıya Katıl
          </button>
        </span>
      </TooltipTrigger>
      <TooltipContent>{disabledReason}</TooltipContent>
    </Tooltip>
  );
}
