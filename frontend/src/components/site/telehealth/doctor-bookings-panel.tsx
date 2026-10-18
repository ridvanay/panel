"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as telehealthApi from "@/lib/api/telehealth";
import { useFriendlyError, usePortalStrings } from "@/lib/i18n/use-portal-strings";
import type { PortalStrings } from "@/lib/i18n/site-dictionaries/en/portal";
import type { AppointmentBooking, DoctorBookingsScope, DoctorConsoleOverview } from "@/lib/api/types";
import { useDoctorPortalProfile } from "@/components/site/telehealth/doctor-portal-context";
import { DoctorPortalFeedCard } from "@/components/site/telehealth/doctor-portal-feed-card";
import { DoctorPortalQuickLinksCard } from "@/components/site/telehealth/doctor-portal-quick-links-card";
import { DoctorConsoleOverviewCards } from "@/components/site/telehealth/doctor-console-overview-cards";
import { DoctorConsolePatientCard } from "@/components/site/telehealth/doctor-console-patient-card";
import { BookingDocumentsDialog } from "@/components/site/telehealth/booking-documents-dialog";
import { DoctorConsultationNoteDialog } from "@/components/site/telehealth/doctor-consultation-note-dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { CalendarX2, AlertTriangle } from "lucide-react";
import { useNow } from "@/hooks/use-now";

/**
 * `.claude/architect-scope-doctor-portfolio-identity-console.md` (**[DPI]**) §3 +
 * `.claude/design-notes-doctor-portfolio-console.md` §3 — doktor konsolu: `GET /doctor/overview`
 * kaynaklı 4 metrik kartı + `scope` filtre sekmeleri (`GET /doctor/bookings?scope=...`) + hasta
 * kartları (kimlik rozeti, yaklaşık yaş, kalan süre rozeti, belge/not/katıl aksiyonları).
 *
 * Grid görevi (2026-09-14) — sayfa artık `lg:grid-cols-12` 2 kolonlu bir dashboard: ana alan
 * (`lg:col-span-8` — başlık, metrik kartları, sekmeler, randevu akışı) + sağ sidebar
 * (`lg:col-span-4` — "Portal Akışı & Duyurular" + "Hızlı Kısayollar"). DOM sırası BİLİNÇLİ: ana
 * alan ÖNCE, sidebar SONRA — `lg:` altında (mobil/tablet) tek kolona düşünce hekim önce
 * randevuları görür, duyurular altta kalır (ekstra `order-*` sınıfı GEREKMEZ).
 */

type DoctorConsoleStrings = PortalStrings["doctorConsole"];

const SCOPE_TABS: { value: DoctorBookingsScope; labelKey: keyof DoctorConsoleStrings }[] = [
  { value: "all", labelKey: "tabAll" },
  { value: "today", labelKey: "tabToday" },
  { value: "upcoming", labelKey: "tabUpcoming" },
  { value: "completed", labelKey: "tabCompleted" },
];

/**
 * Sekme sayaçları — `GET /doctor/overview`'ın DÖRT alanından gelir, tamamı GERÇEK toplamlardır.
 * `.claude/architect-scope-demo-payment-doctor-counters.md` İstek 2 (bağlayıcı) öncesinde "all"/
 * "upcoming" sayfalanmış (cursor tabanlı) bir liste üzerinden geliyordu; `bookings.length` o anki
 * SAYFANIN büyüklüğüydü, GERÇEK bir toplam DEĞİLDİ — bu yüzden o iki sekmede sayaç GÖSTERİLMİYORDU.
 * Backend artık `upcomingBookingTotal`/`allBookingTotal`'ı (booking SAYISI, `GET /doctor/bookings`
 * ile AYNI filtre) doğrudan döndüğü için bu kısıtlama ORTADAN KALKTI.
 */
export function scopeCount(scope: DoctorBookingsScope, overview: DoctorConsoleOverview | null): number | null {
  if (!overview) return null;
  if (scope === "today") return overview.today.total;
  if (scope === "completed") return overview.completedConsultationTotal;
  if (scope === "upcoming") return overview.upcomingBookingTotal;
  return overview.allBookingTotal;
}

const EMPTY_STATE_COPY: Record<DoctorBookingsScope, { titleKey: keyof DoctorConsoleStrings; descriptionKey: keyof DoctorConsoleStrings }> = {
  all: { titleKey: "emptyAllTitle", descriptionKey: "emptyDescription" },
  today: { titleKey: "emptyTodayTitle", descriptionKey: "emptyDescription" },
  upcoming: { titleKey: "emptyUpcomingTitle", descriptionKey: "emptyDescription" },
  completed: { titleKey: "emptyCompletedTitle", descriptionKey: "emptyCompletedDescription" },
};

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
  const { t } = usePortalStrings();
  const friendlyErrorMessage = useFriendlyError();

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
  }, [friendlyErrorMessage]);

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
  }, [friendlyErrorMessage]);

  // frontend-agent bug fix (`.claude/architect-scope-doctor-subdomain.md` §5.4 invariant 4 —
  // qa-agent'ın bulduğu bug, bkz. `doctor-portal-feed-card.tsx`'teki AYNI kök neden açıklaması):
  // `DoctorBookingsPanel` de `DoctorPortalShell` `status === "ready"` OLANA KADAR mount edilmez —
  // bu geç mount, React dev-modu StrictMode'un "mount → effect → cleanup → effect" ikiye katlama
  // simülasyonunu TAM O ANDA tetikler, `loadOverview`/`loadBookings` efektleri iki kez çalışıp
  // GERÇEK ikinci `GET /doctor/overview` + `GET /doctor/bookings` istekleri atıyordu. `hasLoadedRef`
  // (overview) ve `lastLoadedScopeRef` (bookings, scope'a göre anahtarlanır) StrictMode'un HEMEN
  // ardından gelen ikinci (fantom) çağrısını atlar; `scope` GERÇEKTEN değiştiğinde (tab tıklaması —
  // bu bir REMOUNT değil sıradan bir yeniden render'dır, StrictMode ETKİLEMEZ) `lastLoadedScopeRef`
  // güncel değerle eşleşmediği için normal şekilde yeniden fetch eder ("Tekrar Dene" butonları zaten
  // `loadOverview()`/`loadBookings(scope)`'u DOĞRUDAN çağırır, bu guard'ların DIŞINDADIR).
  const hasLoadedOverviewRef = useRef(false);
  useEffect(() => {
    if (hasLoadedOverviewRef.current) return;
    hasLoadedOverviewRef.current = true;
    void loadOverview();
  }, [loadOverview]);

  const lastLoadedScopeRef = useRef<DoctorBookingsScope | null>(null);
  useEffect(() => {
    if (lastLoadedScopeRef.current === scope) return;
    lastLoadedScopeRef.current = scope;
    void loadBookings(scope);
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

  // Dakikada bir yeniden hesaplanır (Paket A2) — "kalan süre" rozetleri ve "Katıl" pencere kapanınca güncellenir.
  const clientNowMs = useNow();
  const calibratedNowMs = useMemo(() => {
    if (!overview || fetchedAtMs === null) return clientNowMs;
    return new Date(overview.generatedAt).getTime() + (clientNowMs - fetchedAtMs);
  }, [overview, fetchedAtMs, clientNowMs]);

  const documentsBooking = bookings?.find((b) => b.id === documentsBookingId) ?? null;
  const noteEditorBooking = bookings?.find((b) => b.id === noteEditorBookingId) ?? null;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">{t.doctorConsole.title}</h1>
        <p className="mt-1 text-sm text-foreground/60">{t.doctorConsole.subtitle}</p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 lg:items-start">
        {/* Ana alan (~%70-75) — metrik kartları, filtre sekmeleri, randevu akışı. */}
        <div className="space-y-6 lg:col-span-8">
          {overviewError ? (
            <Alert variant="error">
              <span className="flex flex-wrap items-center justify-between gap-3">
                <span className="flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
                  {overviewError}
                </span>
                <Button type="button" variant="outline" size="sm" onClick={() => void loadOverview()}>
                  {t.common.retry}
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
              {SCOPE_TABS.map((tab) => {
                const count = scopeCount(tab.value, overview);
                return (
                  <TabsTrigger key={tab.value} value={tab.value} className="gap-1.5">
                    {t.doctorConsole[tab.labelKey]}
                    {count !== null && (
                      <Badge tone="neutral" size="sm" className="px-1.5 py-0 text-[10px] font-semibold">
                        {count}
                      </Badge>
                    )}
                  </TabsTrigger>
                );
              })}
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
                  {t.common.retry}
                </Button>
              </span>
            </Alert>
          )}

          {bookings && bookings.length === 0 && !loadError && (
            <EmptyState
              icon={CalendarX2}
              title={t.doctorConsole[EMPTY_STATE_COPY[scope].titleKey]}
              description={t.doctorConsole[EMPTY_STATE_COPY[scope].descriptionKey]}
            />
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
                {t.common.loadMore}
              </Button>
            </div>
          )}
        </div>

        {/* Sağ sidebar (~%25-30) — "Portal Akışı & Duyurular" + "Hızlı Kısayollar". */}
        <div className="space-y-6 lg:col-span-4">
          <DoctorPortalFeedCard />
          <DoctorPortalQuickLinksCard />
        </div>
      </div>

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
