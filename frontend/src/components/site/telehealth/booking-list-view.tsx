"use client";

import { useState } from "react";
import { AlertTriangle, CalendarX2, CheckCircle2, Paperclip, StickyNote } from "lucide-react";
import type { AppointmentBooking, AppointmentStatus } from "@/lib/api/types";
import { formatDayLabel, formatTime } from "@/lib/telehealth-format";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";
import * as telehealthApi from "@/lib/api/telehealth";
import { PaymentStatusBadge } from "@/components/site/telehealth/payment-status-badge";
import { AppointmentStatusBadge } from "@/components/site/telehealth/appointment-status-badge";
import { JoinMeetingButton } from "@/components/site/telehealth/join-meeting-button";
import { BookingDocumentsDialog } from "@/components/site/telehealth/booking-documents-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert } from "@/components/ui/alert";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ConsultationNoteEditor } from "@/components/site/telehealth/consultation-note-editor";

/**
 * `.claude/design-notes-telehealth.md` §12.5 (Booking Turu 1) + §13 (Booking Turu 3) — randevu
 * yönetim ekranı. Responsive TEK bileşen: mobilde kart listesi, `md:` ve üzerinde tablo — AYNI
 * veri, iki AYRI veri-çekme mantığı İCAT EDİLMEZ, yalnızca iki Tailwind düzeninde render edilir.
 * Doktor (`/doctor/bookings`) VE hasta (`/patient/bookings`) portalında ORTAK kullanılır
 * (`perspective` prop'u). §13.1/§13.2/§13.4 bu bileşene TADİLAT ekler (seans durumu rozeti,
 * vurgulu belge rozeti + hasta notu göstergesi, "Seansı Tamamla" aksiyonu).
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

/**
 * §13.4.1 — "Seansı Tamamla" `IN_PROGRESS`'te HER ZAMAN, `SCHEDULED`'ta YALNIZCA katılım
 * penceresi KAPANDIYSA (`now > joinableUntil`) gösterilir; pencere hiç AÇILMADIYSA
 * (`joinableUntil === null`, ör. ödeme bekliyor) "henüz açılmadı" sayılır, buton GÖSTERİLMEZ.
 */
function isSessionCompletable(status: AppointmentStatus, joinableUntil: string | null, now: number): boolean {
  if (status === "IN_PROGRESS") return true;
  if (status === "SCHEDULED" && joinableUntil && now > new Date(joinableUntil).getTime()) return true;
  return false;
}

/** §13.1/§13.4.1 — Aksiyon alanı, `firstAppointment.status`'e göre rozet/buton kombinasyonu. */
function BookingActions({
  booking,
  perspective,
  accessToken,
  now,
  onComplete,
}: {
  booking: AppointmentBooking;
  perspective: "doctor" | "patient";
  accessToken?: string;
  now: number;
  onComplete: () => void;
}) {
  const status = booking.appointments[0]?.status;

  if (!status) {
    return <JoinMeetingButton booking={booking} accessToken={accessToken} size="sm" />;
  }

  const showBadge = status !== "SCHEDULED";
  const showJoin = status === "SCHEDULED" || status === "IN_PROGRESS";
  const showComplete = perspective === "doctor" && isSessionCompletable(status, booking.joinableUntil, now);

  return (
    <>
      {showBadge && <AppointmentStatusBadge status={status} size="sm" />}
      {showJoin && <JoinMeetingButton booking={booking} accessToken={accessToken} size="sm" />}
      {showComplete && (
        <Button type="button" variant="success" size="sm" className="gap-1" onClick={onComplete}>
          <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
          Seansı Tamamla
        </Button>
      )}
    </>
  );
}

/** §13.2 — "Tıbbi Belgeler (N)" vurgulu rozet + hasta notu göstergesi, koşul `documentCount > 0 || hasIntakeNote`. */
function BookingDocumentsIndicator({
  booking,
  perspective,
  onOpen,
}: {
  booking: AppointmentBooking;
  perspective: "doctor" | "patient";
  onOpen: () => void;
}) {
  if (!(booking.documentCount > 0 || booking.hasIntakeNote)) return null;

  const content = (
    <>
      {booking.documentCount > 0 && (
        <Badge tone="primary" solid size="sm" className="gap-1">
          <Paperclip className="h-3 w-3" aria-hidden="true" />
          Tıbbi Belgeler ({booking.documentCount})
        </Badge>
      )}
      {booking.hasIntakeNote && (
        <Tooltip>
          <TooltipTrigger render={<span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/10 text-primary" />}>
            <StickyNote className="h-3 w-3" aria-hidden="true" />
          </TooltipTrigger>
          <TooltipContent>Hasta notu da mevcut</TooltipContent>
        </Tooltip>
      )}
    </>
  );

  if (perspective !== "doctor") {
    return <span className="inline-flex items-center gap-1.5">{content}</span>;
  }

  return (
    <button
      type="button"
      onClick={onOpen}
      className="inline-flex items-center gap-1.5 rounded-[var(--site-radius)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
    >
      {content}
    </button>
  );
}

export function BookingListView({ bookings, loadError, onRetry, perspective, timeZone, accessToken }: BookingListViewProps) {
  const [documentsBookingId, setDocumentsBookingId] = useState<string | null>(null);
  const [completingId, setCompletingId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [completeError, setCompleteError] = useState<string | null>(null);

  // eslint-disable-next-line react-hooks/purity -- `join-meeting-button.tsx` İLE AYNI gerekçe: katılım penceresi durumunu "şu an" ile karşılaştırmak GEREKİR, saniyede bir tick atan bir sayaç GEREKMEZ, yalnızca render anındaki an yeterlidir
  const now = Date.now();

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

  const completingBooking = bookings.find((b) => b.id === completingId) ?? null;
  const completingFirstAppointment = completingBooking?.appointments[0] ?? null;

  function openComplete(bookingId: string) {
    setCompletingId(bookingId);
    setNote("");
    setCompleteError(null);
  }

  async function handleComplete() {
    if (!completingFirstAppointment) return;
    setSubmitting(true);
    setCompleteError(null);
    try {
      await telehealthApi.completeAppointment(completingFirstAppointment.id, accessToken, note);
      setCompletingId(null);
      onRetry();
    } catch (err) {
      setCompleteError(friendlyErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
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

              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-3">
                <BookingDocumentsIndicator booking={booking} perspective={perspective} onOpen={() => setDocumentsBookingId(booking.id)} />
                <div className="flex flex-1 flex-wrap items-center gap-2">
                  <BookingActions
                    booking={booking}
                    perspective={perspective}
                    accessToken={accessToken}
                    now={now}
                    onComplete={() => openComplete(booking.id)}
                  />
                </div>
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
                  <BookingDocumentsIndicator booking={booking} perspective={perspective} onOpen={() => setDocumentsBookingId(booking.id)} />
                </td>
                <td className="py-3 pr-4 text-right">
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    <BookingActions
                      booking={booking}
                      perspective={perspective}
                      accessToken={accessToken}
                      now={now}
                      onComplete={() => openComplete(booking.id)}
                    />
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {perspective === "doctor" && documentsBookingId && (
        <BookingDocumentsDialog
          bookingId={documentsBookingId}
          hasIntakeNote={bookings.find((b) => b.id === documentsBookingId)?.hasIntakeNote ?? false}
          open={documentsBookingId !== null}
          onOpenChange={(open) => !open && setDocumentsBookingId(null)}
        />
      )}

      {/* §13.4.2 — "Seansı Tamamla" mini-modalı, YALNIZCA doktor perspektifi. */}
      {perspective === "doctor" && completingBooking && completingFirstAppointment && (
        <Dialog open={completingId !== null} onOpenChange={(open) => !open && setCompletingId(null)}>
          <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Seansı Tamamla</DialogTitle>
              <DialogDescription>
                {completingBooking.patientName} ile {formatDayLabel(completingFirstAppointment.startsAt, timeZone)} ·{" "}
                {formatTime(completingFirstAppointment.startsAt, timeZone)} seansını tamamlandı olarak işaretleyeceksiniz.
              </DialogDescription>
            </DialogHeader>

            {completeError && <Alert variant="error">{completeError}</Alert>}

            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Epikriz / Konsültasyon Notu (opsiyonel)</label>
              <ConsultationNoteEditor content={note} onChange={setNote} />
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCompletingId(null)}>
                Vazgeç
              </Button>
              <Button type="button" variant="success" loading={submitting} onClick={() => void handleComplete()}>
                Seansı Tamamla
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
