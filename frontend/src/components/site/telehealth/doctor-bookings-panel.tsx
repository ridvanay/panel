"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import * as telehealthApi from "@/lib/api/telehealth";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";
import type { AppointmentBooking, DoctorBookingsScope, DoctorConsoleOverview } from "@/lib/api/types";
import { useDoctorPortalProfile } from "@/components/site/telehealth/doctor-portal-shell";
import { DoctorPortalFeedCard } from "@/components/site/telehealth/doctor-portal-feed-card";
import { DoctorConsoleOverviewCards } from "@/components/site/telehealth/doctor-console-overview-cards";
import { DoctorConsolePatientCard } from "@/components/site/telehealth/doctor-console-patient-card";
import { BookingDocumentsDialog } from "@/components/site/telehealth/booking-documents-dialog";
import { DoctorConsultationNoteDialog } from "@/components/site/telehealth/doctor-consultation-note-dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { CalendarX2, AlertTriangle } from "lucide-react";

/**
 * `.claude/architect-scope-doctor-portfolio-identity-console.md` (**[DPI]**) §3 +
 * `.claude/design-notes-doctor-portfolio-console.md` §3 — doktor konsolu: `GET /doctor/overview`
 * kaynaklı 4 metrik kartı + `scope` filtre sekmeleri (`GET /doctor/bookings?scope=...`) + hasta
 * kartları (kimlik rozeti, yaklaşık yaş, kalan süre rozeti, belge/not/katıl aksiyonları).
 */

const SCOPE_TABS: { value: DoctorBookingsScope; label: string }[] = [
  { value: "all", label: "Tümü" },
  { value: "today", label: "Bugün" },
  { value: "upcoming", label: "Gelecek Randevular" },
  { value: "completed", label: "Tamamlananlar" },
];

function OverviewSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <Skeleton className="h-24 w-full rounded-[var(--site-radius)]" />
      <Skeleton className="h-24 w-full rounded-[var(--site-radius)]" />
      <Skeleton className="h-24 w-full rounded-[var(--site-radius)]" />
      <Skeleton className="h-24 w-full rounded-[var(--site-radius)]" />
    </div>
  );
}

function BookingCardsSkeleton() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-28 w-full rounded-[var(--site-radius)]" />
      <Skeleton className="h-28 w-full rounded-[var(--site-radius)]" />
      <Skeleton className="h-28 w-full rounded-[var(--site-radius)]" />
    </div>
  );
}

export function DoctorBookingsPanel() {
  const profile = useDoctorPortalProfile();
  const timeZone = profile.doctorProfile.timeZone;

  const [overview, setOverview] = useState<DoctorConsoleOverview | null>(null);
  const [overviewError, setOverviewError] = useState<string | null>(null);
  // [DPI] §3.1 — "kalan süre" rozeti istemci saatine DEĞİL, `generatedAt`e göre kalibre edilir.
  // `fetchedAtMs` o anki istemci saatini yakalar; render anında ikisinin farkı istemci saat
  // sapmasını (clock skew) telafi eder.
  const [fetchedAtMs, setFetchedAtMs] = useState<number | null>(null);

  const [scope, setScope] = useState<DoctorBookingsScope>("all");
  const [bookings, setBookings] = useState<AppointmentBooking[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const [documentsBookingId, setDocumentsBookingId] = useState<string | null>(null);
  const [noteEditorBookingId, setNoteEditorBookingId] = useState<string | null>(null);

  const loadOverview = useCallback(async () => {
    setOverviewError(null);
    try {
      const result = await telehealthApi.getDoctorConsoleOverview();
      setOverview(result);
      setFetchedAtMs(Date.now());
    } catch (err) {
      setOverviewError(friendlyErrorMessage(err));
    }
  }, []);

  const loadBookings = useCallback(async (nextScope: DoctorBookingsScope) => {
    setLoadError(null);
    setBookings(null);
    try {
      const page = await telehealthApi.listDoctorBookings({ scope: nextScope, limit: 20 });
      setBookings(page.items);
      setNextCursor(page.meta.nextCursor);
    } catch (err) {
      setLoadError(friendlyErrorMessage(err));
    }
  }, []);

  useEffect(() => {
    (async () => {
      await loadOverview();
    })();
  }, [loadOverview]);

  useEffect(() => {
    (async () => {
      await loadBookings(scope);
    })();
  }, [scope, loadBookings]);

  async function loadMore() {
    if (!nextCursor) return;
    setLoadingMore(true);
    try {
      const page = await telehealthApi.listDoctorBookings({ scope, limit: 20, cursor: nextCursor });
      setBookings((prev) => [...(prev ?? []), ...page.items]);
      setNextCursor(page.meta.nextCursor);
    } catch (err) {
      setLoadError(friendlyErrorMessage(err));
    } finally {
      setLoadingMore(false);
    }
  }

  // eslint-disable-next-line react-hooks/purity -- "kalan süre" rozetleri render anındaki "şu an" ile hesaplanır; saniyede bir tick atan bir sayaç GEREKMEZ
  const clientNowMs = Date.now();
  const calibratedNowMs = useMemo(() => {
    if (!overview || fetchedAtMs === null) return clientNowMs;
    return new Date(overview.generatedAt).getTime() + (clientNowMs - fetchedAtMs);
  }, [overview, fetchedAtMs, clientNowMs]);

  const documentsBooking = bookings?.find((b) => b.id === documentsBookingId) ?? null;
  const noteEditorBooking = bookings?.find((b) => b.id === noteEditorBookingId) ?? null;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Doktor Konsolu</h1>
        <p className="mt-1 text-sm text-foreground/60">Hastalarınızın rezervasyonlarını, belgelerini ve konsültasyon notlarını buradan yönetin.</p>
      </div>

      {/* Görev 3 — "Portal Akışı & Duyurular" kartı, metrik kartlarının HEMEN ÜSTÜNDE. */}
      <DoctorPortalFeedCard />

      {overviewError ? (
        <Alert variant="error">
          <span className="flex flex-wrap items-center justify-between gap-3">
            <span className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
              {overviewError}
            </span>
            <Button type="button" variant="outline" size="sm" onClick={() => void loadOverview()}>
              Tekrar Dene
            </Button>
          </span>
        </Alert>
      ) : overview ? (
        <DoctorConsoleOverviewCards overview={overview} />
      ) : (
        <OverviewSkeleton />
      )}

      <Tabs value={scope} onValueChange={(value) => setScope(value as DoctorBookingsScope)}>
        <TabsList>
          {SCOPE_TABS.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value}>
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {bookings === null && !loadError && <BookingCardsSkeleton />}

      {loadError && (
        <Alert variant="error">
          <span className="flex flex-wrap items-center justify-between gap-3">
            <span className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
              {loadError}
            </span>
            <Button type="button" variant="outline" size="sm" onClick={() => void loadBookings(scope)}>
              Tekrar Dene
            </Button>
          </span>
        </Alert>
      )}

      {bookings && bookings.length === 0 && !loadError && (
        <div className="flex flex-col items-center gap-2 rounded-[var(--site-radius)] border border-border bg-surface p-10 text-center">
          <CalendarX2 className="h-8 w-8 text-foreground/30" aria-hidden="true" />
          <p className="text-sm font-medium text-foreground">Bu filtrede bir randevu yok.</p>
          <p className="text-xs text-foreground/50">Hastalarınız randevu aldığında burada listelenecek.</p>
        </div>
      )}

      {bookings && bookings.length > 0 && (
        <div className="space-y-3">
          {bookings.map((booking) => (
            <DoctorConsolePatientCard
              key={booking.id}
              booking={booking}
              calibratedNowMs={calibratedNowMs}
              timeZone={timeZone}
              onOpenDocuments={() => setDocumentsBookingId(booking.id)}
              onOpenNoteEditor={() => setNoteEditorBookingId(booking.id)}
            />
          ))}
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
          open={documentsBookingId !== null}
          onOpenChange={(open) => !open && setDocumentsBookingId(null)}
        />
      )}

      {noteEditorBooking && (
        <DoctorConsultationNoteDialog
          booking={noteEditorBooking}
          open={noteEditorBookingId !== null}
          onOpenChange={(open) => !open && setNoteEditorBookingId(null)}
          onSaved={() => {
            void loadBookings(scope);
            void loadOverview();
          }}
        />
      )}
    </div>
  );
}
