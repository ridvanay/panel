"use client";

import { useCallback, useEffect, useState } from "react";
import * as telehealthApi from "@/lib/api/telehealth";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";
import type { AppointmentBooking } from "@/lib/api/types";
import { useDoctorPortalProfile } from "@/components/site/telehealth/doctor-portal-shell";
import { BookingListView } from "@/components/site/telehealth/booking-list-view";
import { Button } from "@/components/ui/button";

/** `.claude/design-notes-telehealth.md` §12.5 — `/doctor` (randevularım) ana ekranı. */
export function DoctorBookingsPanel() {
  const profile = useDoctorPortalProfile();
  const [bookings, setBookings] = useState<AppointmentBooking[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(async () => {
    setLoadError(null);
    setBookings(null);
    try {
      const page = await telehealthApi.listDoctorBookings({ limit: 20 });
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
      const page = await telehealthApi.listDoctorBookings({ limit: 20, cursor: nextCursor });
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
        <p className="mt-1 text-sm text-foreground/60">Hastalarınızın rezervasyonlarını, ödeme durumlarını ve belgelerini buradan yönetin.</p>
      </div>

      <BookingListView
        bookings={bookings}
        loadError={loadError}
        onRetry={() => void load()}
        perspective="doctor"
        timeZone={profile.doctorProfile.timeZone}
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
