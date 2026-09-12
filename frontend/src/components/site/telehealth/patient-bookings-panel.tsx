"use client";

import { useCallback, useEffect, useState } from "react";
import * as telehealthApi from "@/lib/api/telehealth";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";
import type { AppointmentBooking } from "@/lib/api/types";
import { BookingListView } from "@/components/site/telehealth/booking-list-view";
import { Button } from "@/components/ui/button";

/** `.claude/design-notes-telehealth.md` §12.5 — `/patient/bookings` (oturum sahibi hasta). */
export function PatientBookingsPanel() {
  const [bookings, setBookings] = useState<AppointmentBooking[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(async () => {
    setLoadError(null);
    setBookings(null);
    try {
      const page = await telehealthApi.listPatientBookings({ limit: 20 });
      setBookings(page.items);
      setNextCursor(page.meta.nextCursor);
    } catch (err) {
      setLoadError(friendlyErrorMessage(err));
    }
  }, []);

  useEffect(() => {
    (async () => {
      await load();
    })();
  }, [load]);

  async function loadMore() {
    if (!nextCursor) return;
    setLoadingMore(true);
    try {
      const page = await telehealthApi.listPatientBookings({ limit: 20, cursor: nextCursor });
      setBookings((prev) => [...(prev ?? []), ...page.items]);
      setNextCursor(page.meta.nextCursor);
    } catch (err) {
      setLoadError(friendlyErrorMessage(err));
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Randevularım</h1>
        <p className="mt-1 text-sm text-foreground/60">Rezervasyonlarınızı, ödeme durumlarını ve ödeme belgelerinizi buradan görüntüleyin.</p>
      </div>

      <BookingListView
        bookings={bookings}
        loadError={loadError}
        onRetry={() => void load()}
        perspective="patient"
        timeZone={Intl.DateTimeFormat().resolvedOptions().timeZone}
      />

      {nextCursor && (
        <div className="flex justify-center">
          <Button type="button" variant="outline" size="sm" loading={loadingMore} onClick={() => void loadMore()}>
            Daha Fazla Yükle
          </Button>
        </div>
      )}
    </div>
  );
}
