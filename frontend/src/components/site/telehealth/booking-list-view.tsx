"use client";

import { useState } from "react";
import { AlertTriangle, CalendarX2, Paperclip } from "lucide-react";
import type { AppointmentBooking } from "@/lib/api/types";
import { formatDayLabel, formatTime } from "@/lib/telehealth-format";
import { PaymentStatusBadge } from "@/components/site/telehealth/payment-status-badge";
import { JoinMeetingButton } from "@/components/site/telehealth/join-meeting-button";
import { BookingDocumentsDialog } from "@/components/site/telehealth/booking-documents-dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert } from "@/components/ui/alert";

/**
 * `.claude/design-notes-telehealth.md` §12.5 — randevu yönetim ekranı. Responsive TEK bileşen:
 * mobilde kart listesi, `md:` ve üzerinde tablo — AYNI veri, iki AYRI veri-çekme mantığı İCAT
 * EDİLMEZ, yalnızca iki Tailwind düzeninde render edilir. Doktor (`/doctor/bookings`) VE hasta
 * (`/patient/bookings`) portalında ORTAK kullanılır (`perspective` prop'u).
 */

interface BookingListViewProps {
  bookings: AppointmentBooking[] | null;
  loadError: string | null;
  onRetry: () => void;
  perspective: "doctor" | "patient";
  timeZone: string;
  /** Hasta magic-link akışında (`/patient/bookings/{id}?t=`) — yoksa oturum-tabanlı erişim varsayılır. */
  accessToken?: string;
}

function BookingListSkeleton() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-24 w-full rounded-[var(--site-radius)]" />
      <Skeleton className="h-24 w-full rounded-[var(--site-radius)]" />
      <Skeleton className="h-24 w-full rounded-[var(--site-radius)]" />
    </div>
  );
}

export function BookingListView({ bookings, loadError, onRetry, perspective, timeZone, accessToken }: BookingListViewProps) {
  const [documentsBookingId, setDocumentsBookingId] = useState<string | null>(null);

  if (bookings === null && !loadError) {
    return <BookingListSkeleton />;
  }

  if (loadError) {
    return (
      <Alert variant="error">
        <span className="flex flex-wrap items-center justify-between gap-3">
          <span className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
            {loadError}
          </span>
          <Button type="button" variant="outline" size="sm" onClick={onRetry}>
            Tekrar Dene
          </Button>
        </span>
      </Alert>
    );
  }

  if (!bookings || bookings.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-[var(--site-radius)] border border-border bg-surface p-10 text-center">
        <CalendarX2 className="h-8 w-8 text-foreground/30" aria-hidden="true" />
        <p className="text-sm font-medium text-foreground">Henüz bir randevunuz yok.</p>
        <p className="text-xs text-foreground/50">
          {perspective === "doctor" ? "Hastalarınız randevu aldığında burada listelenecek." : "Bir doktordan randevu aldığınızda burada listelenecek."}
        </p>
      </div>
    );
  }

  return (
    <>
      {/* §12.5.1 — mobil kart listesi (<md) */}
      <div className="space-y-3 md:hidden">
        {bookings.map((booking) => {
          const counterpartName = perspective === "doctor" ? booking.patientName : `${booking.doctor.title} ${booking.doctor.fullName}`;
          return (
            <div key={booking.id} className="rounded-[var(--site-radius)] border border-border bg-surface p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-foreground">{counterpartName}</p>
                  <p className="text-xs text-foreground/60">
                    {booking.appointments[0] ? formatDayLabel(booking.appointments[0].startsAt, timeZone) : booking.bookingNumber}
                  </p>
                </div>
                <PaymentStatusBadge status={booking.paymentStatus} />
              </div>

              <div className="mt-2 flex flex-wrap gap-1.5">
                {booking.appointments.map((appointment) => (
                  <span
                    key={appointment.id}
                    className="rounded-full border border-border bg-muted/50 px-2 py-0.5 text-xs tabular-nums text-foreground/70"
                  >
                    {formatTime(appointment.startsAt, timeZone)}
                  </span>
                ))}
              </div>

              <div className="mt-3 flex items-center justify-between gap-2 border-t border-border/60 pt-3">
                {booking.documentCount > 0 &&
                  (perspective === "doctor" ? (
                    <button
                      type="button"
                      onClick={() => setDocumentsBookingId(booking.id)}
                      className="flex items-center gap-1 text-xs text-foreground/60 hover:text-primary"
                    >
                      <Paperclip className="h-3.5 w-3.5" aria-hidden="true" />
                      {booking.documentCount} belge
                    </button>
                  ) : (
                    <span className="flex items-center gap-1 text-xs text-foreground/60">
                      <Paperclip className="h-3.5 w-3.5" aria-hidden="true" />
                      {booking.documentCount} belge
                    </span>
                  ))}
                <div className="flex-1" />
                <JoinMeetingButton booking={booking} accessToken={accessToken} size="sm" />
              </div>
            </div>
          );
        })}
      </div>

      {/* §12.5.2 — masaüstü tablo (md: ve üzeri) */}
      <table className="hidden w-full text-sm md:table">
        <thead>
          <tr className="border-b border-border text-left text-xs font-semibold uppercase tracking-wider text-foreground/50">
            <th className="py-2 pr-4">{perspective === "doctor" ? "Hasta" : "Doktor"}</th>
            <th className="py-2 pr-4">Slotlar</th>
            <th className="py-2 pr-4">Ödeme</th>
            <th className="py-2 pr-4">Belgeler</th>
            <th className="py-2 pr-4 text-right">Aksiyon</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/60">
          {bookings.map((booking) => {
            const counterpartName = perspective === "doctor" ? booking.patientName : `${booking.doctor.title} ${booking.doctor.fullName}`;
            return (
              <tr key={booking.id}>
                <td className="py-3 pr-4 font-medium text-foreground">{counterpartName}</td>
                <td className="py-3 pr-4">
                  <div className="flex flex-wrap gap-1.5">
                    {booking.appointments.map((appointment) => (
                      <span
                        key={appointment.id}
                        className="rounded-full border border-border bg-muted/50 px-2 py-0.5 text-xs tabular-nums text-foreground/70"
                      >
                        {formatTime(appointment.startsAt, timeZone)}
                      </span>
                    ))}
                  </div>
                </td>
                <td className="py-3 pr-4">
                  <PaymentStatusBadge status={booking.paymentStatus} />
                </td>
                <td className="py-3 pr-4">
                  {booking.documentCount > 0 ? (
                    perspective === "doctor" ? (
                      <button
                        type="button"
                        onClick={() => setDocumentsBookingId(booking.id)}
                        className="flex items-center gap-1 text-foreground/60 hover:text-primary"
                      >
                        <Paperclip className="h-3.5 w-3.5" aria-hidden="true" />
                        {booking.documentCount}
                      </button>
                    ) : (
                      <span className="flex items-center gap-1 text-foreground/60">
                        <Paperclip className="h-3.5 w-3.5" aria-hidden="true" />
                        {booking.documentCount}
                      </span>
                    )
                  ) : (
                    <span className="text-foreground/30">—</span>
                  )}
                </td>
                <td className="py-3 pr-4 text-right">
                  <JoinMeetingButton booking={booking} accessToken={accessToken} size="sm" />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {perspective === "doctor" && documentsBookingId && (
        <BookingDocumentsDialog
          bookingId={documentsBookingId}
          open={documentsBookingId !== null}
          onOpenChange={(open) => !open && setDocumentsBookingId(null)}
        />
      )}
    </>
  );
}
