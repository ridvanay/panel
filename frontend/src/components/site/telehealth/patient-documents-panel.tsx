"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Paperclip, Plus } from "lucide-react";
import * as telehealthApi from "@/lib/api/telehealth";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";
import type { AppointmentBooking } from "@/lib/api/types";
import { useLocalizePath } from "@/context/locale-alternates-context";
import { formatFullDayLabel, formatTime } from "@/lib/telehealth-format";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { AppointmentStatusBadge } from "@/components/site/telehealth/appointment-status-badge";
import { BookingDocumentsDialog } from "@/components/site/telehealth/booking-documents-dialog";

/**
 * `.claude/architect-scope-telehealth-template.md` §9.8.4 KARAR O — `/patient/documents`,
 * `GET /patient/bookings?scope=all` listesindeki TÜM booking'leri kart olarak listeler; belge
 * İÇERİĞİ yalnızca kullanıcı bir karta TIKLAYINCA `BookingDocumentsDialog` ile çekilir
 * (`listBookingDocuments`/`fetchDocumentContentBlob`). **Sayfa açılışında BİR TEK istek atılır**
 * (`listPatientBookings`) — booking'ler üzerinde fan-out YASAKTIR (§9.8.4 bağlayıcı kural).
 * `.claude/design-notes-telehealth.md` §14.5 — kart iskeleti.
 *
 * qa-agent bug fix turu (2026-09-15) — `documentCount === 0` olan booking'ler artık FİLTRELENMİYOR:
 * bu kartlar "Görüntüle" yerine "Belge Ekle" gösterir, bu buton `BookingDocumentsDialog` AÇMAZ,
 * hastayı DOKUNULMAMIŞ `patient-booking-detail-panel.tsx`teki (§9.7.5 madde 2 KVKK rıza akışı ZATEN
 * ORADA çalışıyor) booking detay sayfasına yönlendirir — belge yükleme MANTIĞININ tek kopyası
 * `/patient/bookings/{id}`de kalır, burada TEKRAR EDİLMEZ.
 */
function DocumentCardsSkeleton() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-24 w-full rounded-[var(--site-radius)]" />
      <Skeleton className="h-24 w-full rounded-[var(--site-radius)]" />
      <Skeleton className="h-24 w-full rounded-[var(--site-radius)]" />
    </div>
  );
}

export function PatientDocumentsPanel() {
  const localize = useLocalizePath();
  const router = useRouter();
  const [bookings, setBookings] = useState<AppointmentBooking[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [documentsBookingId, setDocumentsBookingId] = useState<string | null>(null);

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

  const documentsBooking = (bookings ?? []).find((b) => b.id === documentsBookingId) ?? null;
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Belgelerim</h1>
        <p className="mt-1 text-sm text-foreground/60">Randevularınıza yüklediğiniz tıbbi belgeleri buradan görüntüleyin.</p>
      </div>

      {bookings === null && !loadError && <DocumentCardsSkeleton />}

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

      {bookings !== null && !loadError && bookings.length === 0 && (
        <EmptyState
          icon={Paperclip}
          title="Henüz belgeniz yok"
          description="Randevularınıza yüklediğiniz tıbbi belgeler burada listelenir."
          action={
            <Button type="button" variant="outline" size="sm" onClick={() => router.push(localize("/patient/appointments"))}>
              Randevularım
            </Button>
          }
        />
      )}

      {bookings !== null && bookings.length > 0 && (
        <div className="space-y-3">
          {bookings.map((booking) => {
            const firstAppointment = booking.appointments[0];
            const hasDocuments = booking.documentCount > 0;
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
                  {hasDocuments ? (
                    <>
                      <Badge tone="primary" solid size="sm" className="gap-1">
                        <Paperclip className="h-3 w-3" aria-hidden="true" />
                        Tıbbi Belgeler ({booking.documentCount})
                      </Badge>
                      <Button type="button" variant="outline" size="sm" onClick={() => setDocumentsBookingId(booking.id)}>
                        Görüntüle
                      </Button>
                    </>
                  ) : (
                    <>
                      <Badge tone="neutral" size="sm" className="gap-1">
                        <Paperclip className="h-3 w-3" aria-hidden="true" />
                        Henüz belge yok
                      </Badge>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="gap-1"
                        aria-label={`${booking.doctor.title} ${booking.doctor.fullName} randevusuna belge ekle`}
                        onClick={() => router.push(localize(`/patient/bookings/${booking.id}`))}
                      >
                        <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                        Belge Ekle
                      </Button>
                    </>
                  )}
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

      {documentsBooking && (
        <BookingDocumentsDialog
          bookingId={documentsBooking.id}
          hasIntakeNote={documentsBooking.hasIntakeNote}
          appointmentIds={documentsBooking.appointments.map((a) => a.id)}
          canDeleteRecordings
          open={documentsBookingId !== null}
          onOpenChange={(open) => !open && setDocumentsBookingId(null)}
        />
      )}
    </div>
  );
}
