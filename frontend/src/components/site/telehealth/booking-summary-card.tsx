"use client";

import { useLocalizePath } from "@/context/locale-alternates-context";
import { usePortalStrings } from "@/lib/i18n/use-portal-strings";
import type { AppointmentBooking } from "@/lib/api/types";
import { formatDayLabel } from "@/lib/telehealth-format";
import { formatPriceFromCents } from "@/lib/format-price";
import { PaymentStatusBadge } from "@/components/site/telehealth/payment-status-badge";
import { JoinMeetingButton } from "@/components/site/telehealth/join-meeting-button";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { AddToCalendar, DualDateTimeSummary, DualSlotLabel } from "@/components/site/telehealth/dual-time";
import { fmt } from "@/lib/i18n/use-portal-strings";
import { mergeSlotRanges } from "@/lib/country-display";

/**
 * Ortak rezervasyon özet kartı — ödeme dönüş sayfaları (§9.7.1) VE hasta booking detay sayfası
 * (§9.7.10 `GET /appointments/bookings/{bookingId}`) TARAFINDAN paylaşılır. `.claude/design-notes-
 * telehealth.md` §12.4 ödeme rozetleri + §12.5.3 "Toplantıya Katıl" desenini kullanır.
 */
export function BookingSummaryCard({ booking, accessToken, timeZone }: { booking: AppointmentBooking; accessToken?: string; timeZone: string }) {
  const localize = useLocalizePath();
  const { t, intlLocale } = usePortalStrings();
  const firstSlot = booking.appointments[0];

  return (
    <div className="rounded-[var(--site-radius)] border border-border bg-surface p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-foreground/50">{t.common.bookingNumber}</p>
          <p className="text-sm font-medium text-foreground">{booking.bookingNumber}</p>
        </div>
        <PaymentStatusBadge status={booking.paymentStatus} size="lg" />
      </div>

      <div className="my-4 border-t border-border" />

      <p className="text-sm font-semibold text-foreground">
        {booking.doctor.title} {booking.doctor.fullName}
      </p>
      {firstSlot && <p className="mt-0.5 text-xs text-foreground/60">{formatDayLabel(firstSlot.startsAt, timeZone, intlLocale)}</p>}

      <div className="mt-2 flex flex-wrap gap-1.5">
        {booking.appointments.map((appointment) => (
          <span key={appointment.id} className="rounded-full border border-border bg-muted/50 px-2 py-0.5 text-xs tabular-nums text-foreground/70">
            {/* Paket P — hastanın saati + küçük Türkiye saati. */}
            <DualSlotLabel iso={appointment.startsAt} timeZone={timeZone} intlLocale={intlLocale} />
          </span>
        ))}
      </div>
      {/* Paket R — başlangıç–bitiş (ardışık slotlar tek aralık), İstanbul satırı, fark. */}
      <div className="mt-3 space-y-2">
        {mergeSlotRanges(booking.appointments).map((range) => (
          <DualDateTimeSummary key={range.startsAt} iso={range.startsAt} endIso={range.endsAt} timeZone={timeZone} intlLocale={intlLocale} />
        ))}
      </div>
      {booking.paymentStatus === "PAID" && (
        <AddToCalendar
          className="mt-3"
          events={mergeSlotRanges(booking.appointments).map((range) => ({
            uid: booking.id,
            title: fmt(t.schedule.calendarEventTitle, { doctor: `${booking.doctor.title} ${booking.doctor.fullName}`.trim() }),
            startsAt: range.startsAt,
            endsAt: range.endsAt,
            url:
              typeof window !== "undefined"
                ? `${window.location.origin}${localize(`/patient/bookings/${booking.id}${accessToken ? `?t=${encodeURIComponent(accessToken)}` : ""}`)}`
                : null,
          }))}
        />
      )}

      <div className="mt-4 flex items-baseline justify-between border-t border-border pt-4">
        <span className="text-sm font-semibold text-foreground">{t.common.total}</span>
        <span className="text-xl font-semibold text-foreground">{formatPriceFromCents(booking.totalCents, booking.currency, intlLocale)}</span>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <JoinMeetingButton booking={booking} accessToken={accessToken} />
        {booking.paymentStatus === "PAID" && (
          <a
            href={localize(`/patient/bookings/${booking.id}/invoice${accessToken ? `?t=${encodeURIComponent(accessToken)}` : ""}`)}
            className={cn(buttonVariants({ variant: "outline", size: "sm" }), "rounded-[var(--site-radius)]")}
          >
            {t.common.paymentDocument}
          </a>
        )}
      </div>
    </div>
  );
}
