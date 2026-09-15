"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, ClipboardList } from "lucide-react";
import * as telehealthApi from "@/lib/api/telehealth";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";
import type { AppointmentBooking } from "@/lib/api/types";
import { formatFullDayLabel, formatTime } from "@/lib/telehealth-format";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { AppointmentStatusBadge } from "@/components/site/telehealth/appointment-status-badge";
import { PatientConsultationNoteDialog } from "@/components/site/telehealth/patient-consultation-note-dialog";

/**
 * `.claude/architect-scope-telehealth-template.md` §9.8.4 KARAR O — `/patient/prescriptions`,
 * `GET /patient/bookings?scope=all` listesinden `hasConsultationNote === true` olan booking'leri
 * kart olarak listeler; epikriz İÇERİĞİ yalnızca "Görüntüle"ye basılınca `getConsultationNote` ile
 * çekilir (`patient-booking-detail-panel.tsx`teki AYNI mantık, `PatientConsultationNoteDialog`).
 * **Sayfa açılışında BİR TEK istek atılır** — fan-out YASAKTIR (§9.8.4 bağlayıcı kural).
 * `.claude/design-notes-telehealth.md` §14.5 — kart iskeleti.
 */
function PrescriptionCardsSkeleton() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-24 w-full rounded-[var(--site-radius)]" />
      <Skeleton className="h-24 w-full rounded-[var(--site-radius)]" />
      <Skeleton className="h-24 w-full rounded-[var(--site-radius)]" />
    </div>
  );
}

export function PatientPrescriptionsPanel() {
  const [bookings, setBookings] = useState<AppointmentBooking[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [noteBookingId, setNoteBookingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    setBookings(null);
    try {
      const page = await telehealthApi.listPatientBookings({ scope: "all", limit: 20 });
      setBookings(page.items);
      setNextCursor(page.meta.nextCursor);
    } catch (err) {
      setLoadError(friendlyErrorMessage(err));
    }
  }, []);

  // `doctor-bookings-panel.tsx`teki `hasLoadedOverviewRef` ile AYNI StrictMode-fantom-çağrı
  // koruması (o dosyanın başındaki yoruma bkz.) — bu panelde `scope` sabittir ("all"), bu yüzden
  // yalnızca "daha önce yüklendi mi" bayrağı yeterlidir.
  const hasLoadedRef = useRef(false);
  useEffect(() => {
    if (hasLoadedRef.current) return;
    hasLoadedRef.current = true;
    void load();
  }, [load]);

  async function loadMore() {
    if (!nextCursor) return;
    setLoadingMore(true);
    try {
      const page = await telehealthApi.listPatientBookings({ scope: "all", limit: 20, cursor: nextCursor });
      setBookings((prev) => [...(prev ?? []), ...page.items]);
      setNextCursor(page.meta.nextCursor);
    } catch (err) {
      setLoadError(friendlyErrorMessage(err));
    } finally {
      setLoadingMore(false);
    }
  }

  const prescribedBookings = (bookings ?? []).filter((b) => b.hasConsultationNote);
  const noteBooking = prescribedBookings.find((b) => b.id === noteBookingId) ?? null;
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Reçetelerim</h1>
        <p className="mt-1 text-sm text-foreground/60">Doktorunuzun oluşturduğu konsültasyon notlarını/reçeteleri buradan görüntüleyin.</p>
      </div>

      {bookings === null && !loadError && <PrescriptionCardsSkeleton />}

      {loadError && (
        <Alert variant="error">
          <span className="flex flex-wrap items-center justify-between gap-3">
            <span className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
              {loadError}
            </span>
            <Button type="button" variant="outline" size="sm" onClick={() => void load()}>
              Tekrar Dene
            </Button>
          </span>
        </Alert>
      )}

      {bookings !== null && !loadError && prescribedBookings.length === 0 && (
        <EmptyState
          icon={ClipboardList}
          title="Henüz epikriz kaydınız yok"
          description="Doktorunuzun oluşturduğu konsültasyon notları tamamlandıktan sonra burada görünür."
        />
      )}

      {prescribedBookings.length > 0 && (
        <div className="space-y-3">
          {prescribedBookings.map((booking) => {
            const firstAppointment = booking.appointments[0];
            return (
              <div
                key={booking.id}
                className="rounded-[var(--site-radius)] border border-border bg-surface p-4 transition-colors hover:border-primary/30"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <Avatar name={`${booking.doctor.title} ${booking.doctor.fullName}`} size={40} />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-foreground">
                        {booking.doctor.title} {booking.doctor.fullName}
                      </p>
                      <p className="text-xs text-foreground/60">
                        {firstAppointment ? `${formatFullDayLabel(firstAppointment.startsAt, timeZone)} · ${formatTime(firstAppointment.startsAt, timeZone)}` : booking.bookingNumber}
                      </p>
                      {firstAppointment && (
                        <div className="mt-1">
                          <AppointmentStatusBadge status={firstAppointment.status} />
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-3">
                  <Badge tone="primary" solid size="sm" className="gap-1">
                    <ClipboardList className="h-3 w-3" aria-hidden="true" />
                    Epikriz Mevcut
                  </Badge>
                  <Button type="button" variant="outline" size="sm" onClick={() => setNoteBookingId(booking.id)}>
                    Görüntüle
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {nextCursor && (
        <div className="flex justify-center">
          <Button type="button" variant="outline" size="sm" loading={loadingMore} onClick={() => void loadMore()}>
            Daha Fazla Yükle
          </Button>
        </div>
      )}

      {noteBooking && (
        <PatientConsultationNoteDialog booking={noteBooking} open={noteBookingId !== null} onOpenChange={(open) => !open && setNoteBookingId(null)} />
      )}
    </div>
  );
}
