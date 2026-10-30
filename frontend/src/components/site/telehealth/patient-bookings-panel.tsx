"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CalendarCheck, CalendarClock, CalendarX2 } from "lucide-react";
import * as telehealthApi from "@/lib/api/telehealth";
import { useFriendlyError, usePortalStrings } from "@/lib/i18n/use-portal-strings";
import type { PortalStrings } from "@/lib/i18n/site-dictionaries/en/portal";
import type { AppointmentBooking, PatientBookingCounts, PatientBookingsScope } from "@/lib/api/types";
import { useLocalizePath } from "@/context/locale-alternates-context";
import { BookingListView } from "@/components/site/telehealth/booking-list-view";
import { usePatientDisplayTimeZone } from "@/components/site/telehealth/dual-time";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Spinner } from "@/components/ui/spinner";

/**
 * `.claude/design-notes-telehealth.md` §14.4 — `/patient/appointments` 3 sekme (Aktif/Geçmiş/İptal),
 * `doctor-bookings-panel.tsx`teki `SCOPE_TABS` deseninin BİREBİR AYNISI, yalnızca etiket/değer
 * seti hastaya özgü (`.claude/architect-scope-telehealth-template.md` §9.8.4 KARAR O). `?scope=`
 * URL query state'i olarak tutulur (sekme değişince liste ve URL BİRLİKTE değişir).
 */
type PatientBookingsStrings = PortalStrings["patientBookings"];

const SCOPE_TABS: { value: PatientBookingsScope; labelKey: keyof PatientBookingsStrings }[] = [
  { value: "upcoming", labelKey: "tabUpcoming" },
  { value: "past", labelKey: "tabPast" },
  { value: "cancelled", labelKey: "tabCancelled" },
];

const EMPTY_STATE_COPY: Record<PatientBookingsScope, { icon: typeof CalendarClock; titleKey: keyof PatientBookingsStrings; descriptionKey: keyof PatientBookingsStrings; showAction: boolean }> = {
  all: { icon: CalendarX2, titleKey: "emptyAllTitle", descriptionKey: "emptyAllDescription", showAction: true },
  upcoming: { icon: CalendarClock, titleKey: "emptyUpcomingTitle", descriptionKey: "emptyUpcomingDescription", showAction: true },
  past: { icon: CalendarCheck, titleKey: "emptyPastTitle", descriptionKey: "emptyPastDescription", showAction: false },
  cancelled: {
    icon: CalendarX2,
    titleKey: "emptyCancelledTitle",
    descriptionKey: "emptyCancelledDescription",
    showAction: false,
  },
};

function isPatientBookingsScope(value: string | null): value is PatientBookingsScope {
  return value === "all" || value === "upcoming" || value === "past" || value === "cancelled";
}

/**
 * `.claude/design-notes-telehealth.md` §14.4 — sekme değişince rozet rakamları DEĞİŞMEZ
 * (`meta.counts` `scope`'tan BAĞIMSIZDIR, §9.8.7 test 32); ayrı bir "counts" isteği İCAT EDİLMEZ,
 * booking listesi yanıtının `meta` zarfından (`GET /patient/bookings`) gelir (§9.8.4).
 */
function PatientBookingsPanelContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const localize = useLocalizePath();
  const { t } = usePortalStrings();
  const friendlyErrorMessage = useFriendlyError();
  const patientTimeZone = usePatientDisplayTimeZone();

  const scopeParam = searchParams.get("scope");
  const scope: PatientBookingsScope = isPatientBookingsScope(scopeParam) ? scopeParam : "upcoming";

  const [bookings, setBookings] = useState<AppointmentBooking[] | null>(null);
  const [counts, setCounts] = useState<PatientBookingCounts | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(async (nextScope: PatientBookingsScope) => {
    setLoadError(null);
    setBookings(null);
    try {
      const page = await telehealthApi.listPatientBookings({ scope: nextScope, limit: 20 });
      setBookings(page.items);
      setCounts(page.meta.counts);
      setNextCursor(page.meta.nextCursor);
    } catch (err) {
      setLoadError(friendlyErrorMessage(err));
    }
  }, [friendlyErrorMessage]);

  // `doctor-bookings-panel.tsx`teki AYNI StrictMode-fantom-çağrı koruması (o dosyanın başındaki
  // yoruma bkz.) — `scope` GERÇEKTEN değiştiğinde (sekme tıklaması/URL navigasyonu) yeniden fetch eder.
  const lastLoadedScopeRef = useRef<PatientBookingsScope | null>(null);
  useEffect(() => {
    if (lastLoadedScopeRef.current === scope) return;
    lastLoadedScopeRef.current = scope;
    void load(scope);
  }, [scope, load]);

  function setScope(nextScope: PatientBookingsScope) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("scope", nextScope);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  async function loadMore() {
    if (!nextCursor) return;
    setLoadingMore(true);
    try {
      const page = await telehealthApi.listPatientBookings({ scope, limit: 20, cursor: nextCursor });
      setBookings((prev) => [...(prev ?? []), ...page.items]);
      setCounts(page.meta.counts);
      setNextCursor(page.meta.nextCursor);
    } catch (err) {
      setLoadError(friendlyErrorMessage(err));
    } finally {
      setLoadingMore(false);
    }
  }

  const emptyCopy = EMPTY_STATE_COPY[scope];
  const isEmpty = bookings !== null && bookings.length === 0 && !loadError;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">{t.patientBookings.title}</h1>
        <p className="mt-1 text-sm text-foreground/60">{t.patientBookings.subtitle}</p>
      </div>

      <Tabs value={scope} onValueChange={(value) => setScope(value as PatientBookingsScope)}>
        <TabsList>
          {SCOPE_TABS.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value} className="gap-1.5">
              {t.patientBookings[tab.labelKey]}
              <Badge tone="neutral" size="sm" className="px-1.5 py-0 text-[10px] font-semibold">
                {counts ? counts[tab.value] : "–"}
              </Badge>
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {isEmpty ? (
        <EmptyState
          icon={emptyCopy.icon}
          title={t.patientBookings[emptyCopy.titleKey]}
          description={t.patientBookings[emptyCopy.descriptionKey]}
          action={
            emptyCopy.showAction ? (
              <Button type="button" size="sm" onClick={() => router.push(localize("/physicians"))}>
                {t.common.bookAppointment}
              </Button>
            ) : undefined
          }
        />
      ) : (
        <BookingListView
          bookings={bookings}
          loadError={loadError}
          onRetry={() => void load(scope)}
          perspective="patient"
          timeZone={patientTimeZone}
        />
      )}

      {nextCursor && (
        <div className="flex justify-center">
          <Button type="button" variant="outline" size="sm" loading={loadingMore} onClick={() => void loadMore()}>
            {t.common.loadMore}
          </Button>
        </div>
      )}
    </div>
  );
}

function PatientBookingsPanelFallback() {
  return (
    <div className="flex justify-center py-16">
      <Spinner className="h-6 w-6 text-[var(--site-primary)]" />
    </div>
  );
}

/**
 * NOT (Next.js 16 — bkz. `frontend/AGENTS.md`): `useSearchParams` kullanan Client Component
 * production build'de `<Suspense>` ile sarılmalı (`admin/telehealth/overview/page.tsx` İLE AYNI
 * desen), aksi halde build hata verir.
 */
export function PatientBookingsPanel() {
  return (
    <Suspense fallback={<PatientBookingsPanelFallback />}>
      <PatientBookingsPanelContent />
    </Suspense>
  );
}
