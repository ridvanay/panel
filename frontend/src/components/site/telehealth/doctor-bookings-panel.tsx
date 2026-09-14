"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as telehealthApi from "@/lib/api/telehealth";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";
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

const SCOPE_TABS: { value: DoctorBookingsScope; label: string }[] = [
  { value: "all", label: "Tümü" },
  { value: "today", label: "Bugün" },
  { value: "upcoming", label: "Gelecek Randevular" },
  { value: "completed", label: "Tamamlananlar" },
];

/**
 * Sekme sayaçları — SADECE gerçek bir toplamı OLAN scope'larda gösterilir. `GET /doctor/overview`
 * `today.total` ve `completedConsultationTotal`ı zaten döner (yeni bir backend alanı İSTENMEDİ).
 * "all"/"upcoming" sayfalanmış (cursor tabanlı) bir liste üzerinden gelir; `bookings.length` o anki
 * SAYFANIN büyüklüğüdür, GERÇEK bir toplam DEĞİLDİR — yanıltıcı olmasın diye bu iki sekmede sayaç
 * GÖSTERİLMEZ. Backend'e bir `counts` alanı eklenirse (`backend/src/lib/pagination.ts`
 * `buildPageMetaWithCounts` zaten bu iş için var) kolayca tamamlanabilir.
 */
function scopeCount(scope: DoctorBookingsScope, overview: DoctorConsoleOverview | null): number | null {
  if (!overview) return null;
  if (scope === "today") return overview.today.total;
  if (scope === "completed") return overview.completedConsultationTotal;
  return null;
}

const EMPTY_STATE_COPY: Record<DoctorBookingsScope, { title: string; description: string }> = {
  all: {
    title: "Henüz bir randevunuz yok.",
    description: "Hastalarınız randevu aldığında burada listelenecek.",
  },
  today: {
    title: "Bugün için planlanmış randevunuz bulunmamaktadır.",
    description: "Hastalarınız randevu aldığında burada listelenecek.",
  },
  upcoming: {
    title: "Yaklaşan bir randevunuz yok.",
    description: "Hastalarınız randevu aldığında burada listelenecek.",
  },
  completed: {
    title: "Tamamlanmış bir randevunuz yok.",
    description: "Tamamlanan konsültasyonlarınız burada listelenecek.",
  },
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
              {SCOPE_TABS.map((tab) => {
                const count = scopeCount(tab.value, overview);
                return (
                  <TabsTrigger key={tab.value} value={tab.value} className="gap-1.5">
                    {tab.label}
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
                  Tekrar Dene
                </Button>
              </span>
            </Alert>
          )}

          {bookings && bookings.length === 0 && !loadError && (
            <EmptyState
              icon={CalendarX2}
              title={EMPTY_STATE_COPY[scope].title}
              description={EMPTY_STATE_COPY[scope].description}
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
                Daha Fazla Yükle
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
