"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import * as telehealthApi from "@/lib/api/telehealth";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";
import type { AppointmentBooking } from "@/lib/api/types";
import { useAuth } from "@/context/auth-context";
import { useLocalizePath } from "@/context/locale-alternates-context";
import { formatFullDayLabel, formatTime } from "@/lib/telehealth-format";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { AppointmentStatusBadge } from "@/components/site/telehealth/appointment-status-badge";
import { JoinMeetingButton } from "@/components/site/telehealth/join-meeting-button";
import { cn } from "@/lib/utils";

/**
 * `.claude/design-notes-telehealth.md` §14.2 — `/patient` sayfasının TEK içeriği. `GET /patient/bookings?scope=upcoming`
 * (§9.8.4) TEK istekten beslenir. "En yakın/ödenmemiş randevu" seçimi bir İŞ MANTIĞI kararıdır
 * (architect'in `.claude/architect-scope-telehealth-template.md` §9.8 devrettiği, frontend-agent'ın
 * karar vermesi gereken kısım): ödenmemiş (`paymentStatus === "PENDING"`) booking'ler HER ZAMAN
 * önceliklidir (ödeme penceresi/slot tutması süre sınırlı ve eylem GEREKTİRİR — `expiresAt`'i en
 * yakın olan seçilir); aksi halde en yakın gelecekteki randevunun (appointments[].startsAt) sahibi
 * booking seçilir.
 */

function pickNearestBooking(bookings: AppointmentBooking[], nowMs: number): AppointmentBooking | null {
  const unpaid = bookings.filter((b) => b.paymentStatus === "PENDING");
  if (unpaid.length > 0) {
    return unpaid.reduce((soonest, candidate) => (new Date(candidate.expiresAt).getTime() < new Date(soonest.expiresAt).getTime() ? candidate : soonest));
  }

  function earliestFutureStart(booking: AppointmentBooking): number {
    // Randevunun kendisi (henüz bitmemiş — gelecekte VEYA şu an `IN_PROGRESS`) "yakın" sayılır;
    // tamamen geçmişte kalmış appointment'lar (scope=upcoming zaten dışarıda bırakır, ama
    // savunmacı davranıyoruz) hesaba katılmaz.
    const relevantStarts = booking.appointments
      .filter((a) => new Date(a.startsAt).getTime() >= nowMs || a.status === "IN_PROGRESS")
      .map((a) => new Date(a.startsAt).getTime());
    return relevantStarts.length > 0 ? Math.min(...relevantStarts) : Number.POSITIVE_INFINITY;
  }

  const withAppointments = bookings.filter((b) => b.appointments.length > 0);
  if (withAppointments.length === 0) return null;
  return withAppointments.reduce((soonest, candidate) => (earliestFutureStart(candidate) < earliestFutureStart(soonest) ? candidate : soonest));
}

function HeroSkeleton() {
  return (
    <div className="rounded-[var(--site-radius)] border border-border bg-surface p-6 sm:p-8">
      <Skeleton className="h-7 w-56" />
      <Skeleton className="mt-2 h-4 w-72" />
      <Skeleton className="mt-4 h-24 w-full rounded-[var(--site-radius)]" />
    </div>
  );
}

export function PatientHeroPanel() {
  const { user } = useAuth();
  const localize = useLocalizePath();
  const [bookings, setBookings] = useState<AppointmentBooking[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    setBookings(null);
    try {
      const page = await telehealthApi.listPatientBookings({ scope: "upcoming", limit: 20 });
      setBookings(page.items);
    } catch (err) {
      setLoadError(friendlyErrorMessage(err));
    }
  }, []);

  useEffect(() => {
    (async () => {
      await load();
    })();
  }, [load]);

  if (bookings === null && !loadError) {
    return <HeroSkeleton />;
  }

  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  // eslint-disable-next-line react-hooks/purity -- `join-meeting-button.tsx` İLE AYNI gerekçe: render anındaki "şu an" yeterli, tick atan bir sayaç GEREKMEZ
  const nowMs = Date.now();
  const nearest = bookings ? pickNearestBooking(bookings, nowMs) : null;
  const firstAppointment = nearest?.appointments[0] ?? null;

  const joinWindowOpen =
    !!nearest &&
    nearest.paymentStatus === "PAID" &&
    !!nearest.joinableFrom &&
    !!nearest.joinableUntil &&
    nowMs >= new Date(nearest.joinableFrom).getTime() &&
    nowMs <= new Date(nearest.joinableUntil).getTime();
  const isUnpaid = !!nearest && nearest.paymentStatus === "PENDING";

  return (
    <div className="rounded-[var(--site-radius)] border border-border bg-surface p-6 sm:p-8">
      <h1 className="text-2xl font-semibold text-foreground">Merhaba, {user?.name ?? ""}</h1>
      <p className="mt-1 text-sm text-foreground/60">İşte hasta portalınızın genel görünümü.</p>

      {loadError && (
        <div className="mt-4">
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
        </div>
      )}

      {!loadError && nearest && firstAppointment && (
        <div
          className={cn(
            "mt-4 flex flex-col gap-3 rounded-[var(--site-radius)] border p-4 sm:flex-row sm:items-center sm:justify-between",
            isUnpaid ? "border-warning/30 bg-warning/5" : "border-primary/30 bg-primary/5"
          )}
        >
          <div className="flex min-w-0 items-center gap-3">
            <Avatar name={`${nearest.doctor.title} ${nearest.doctor.fullName}`} size={40} />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-foreground">
                {nearest.doctor.title} {nearest.doctor.fullName}
              </p>
              <p className="flex flex-wrap items-center gap-1.5 text-xs text-foreground/60">
                <span>
                  {formatFullDayLabel(firstAppointment.startsAt, timeZone)} · {formatTime(firstAppointment.startsAt, timeZone)}
                </span>
                <AppointmentStatusBadge status={firstAppointment.status} />
              </p>
            </div>
          </div>

          <div className="shrink-0">
            {isUnpaid ? (
              <Link href={localize(`/patient/bookings/${nearest.id}`)}>
                <Button type="button" size="sm">
                  Ödemeyi Tamamla
                </Button>
              </Link>
            ) : joinWindowOpen ? (
              <JoinMeetingButton booking={nearest} size="sm" />
            ) : (
              <Link href={localize(`/patient/bookings/${nearest.id}`)}>
                <Button type="button" variant="outline" size="sm">
                  Randevu Detayını Gör
                </Button>
              </Link>
            )}
          </div>
        </div>
      )}

      {!loadError && !nearest && (
        <div className="mt-4 flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-foreground/60">Henüz bir randevunuz bulunmuyor.</p>
          <Link href={localize("/doctors")}>
            <Button type="button" size="sm">
              Randevu Al
            </Button>
          </Link>
        </div>
      )}
    </div>
  );
}
