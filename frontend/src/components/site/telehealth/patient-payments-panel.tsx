"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CreditCard, FileText } from "lucide-react";
import * as telehealthApi from "@/lib/api/telehealth";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";
import type { AppointmentBooking } from "@/lib/api/types";
import { useLocalizePath } from "@/context/locale-alternates-context";
import { formatPriceFromCents } from "@/lib/format-price";
import { computeAppointmentBlock, formatDayLabel, formatTime } from "@/lib/telehealth-format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";

/**
 * `.claude/architect-scope-telehealth-template.md` §9.8.3 + Grid görevi (2026-09-15, frontend-agent)
 * Görev 4 — `/patient/payments` ("Ödemelerim"). YENİ bir aggregate uç YOK: `GET /patient/bookings?scope=all`
 * zaten TÜM gereken alanları taşır (`patient-documents-panel.tsx`teki desenle AYNI — sayfa
 * açılışında BİR TEK istek atılır, fan-out YASAK). `paymentStatus === "PAID"` OLMAYAN booking'ler
 * client-side FİLTRELENİR — bu sayfa yalnızca TAMAMLANMIŞ ödemeleri listeler.
 *
 * Mobilde (`<md`) kart listesi, `md:` ve üzerinde tablo — `booking-list-view.tsx`teki responsive
 * desenle AYNI (İKİNCİ bir responsive desen İCAT EDİLMEZ).
 */
function PaymentsSkeleton() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-20 w-full rounded-[var(--site-radius)]" />
      <Skeleton className="h-20 w-full rounded-[var(--site-radius)]" />
      <Skeleton className="h-20 w-full rounded-[var(--site-radius)]" />
    </div>
  );
}

export function PatientPaymentsPanel() {
  const localize = useLocalizePath();
  const router = useRouter();
  const [bookings, setBookings] = useState<AppointmentBooking[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

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

  // `patient-documents-panel.tsx` İLE AYNI StrictMode-fantom-çağrı koruması.
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

  const paidBookings = (bookings ?? []).filter((b) => b.paymentStatus === "PAID");

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Ödemelerim</h1>
        <p className="mt-1 text-sm text-foreground/60">Tamamlanmış ödemelerinizi ve makbuzlarını buradan görüntüleyin.</p>
      </div>

      {bookings === null && !loadError && <PaymentsSkeleton />}

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

      {bookings !== null && !loadError && paidBookings.length === 0 && (
        <EmptyState icon={CreditCard} title="Henüz ödemeniz yok" description="Tamamladığınız ödemeler burada listelenir." />
      )}

      {bookings !== null && paidBookings.length > 0 && (
        <>
          {/* Mobil kart listesi (<md) — `booking-list-view.tsx`teki desenle AYNI */}
          <div className="space-y-3 md:hidden">
            {paidBookings.map((booking) => {
              const block = computeAppointmentBlock(booking.appointments);
              const dateIso = booking.paidAt ?? booking.createdAt;
              return (
                <div key={booking.id} className="rounded-[var(--site-radius)] border border-border bg-surface p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-foreground">
                        {booking.doctor.title} {booking.doctor.fullName}
                      </p>
                      <p className="text-xs text-foreground/60">
                        {formatDayLabel(dateIso, timeZone)} · {formatTime(dateIso, timeZone)}
                      </p>
                      <p className="mt-0.5 text-xs text-foreground/50">{booking.bookingNumber}</p>
                    </div>
                    <Badge tone="success" size="sm">
                      Ödendi
                    </Badge>
                  </div>

                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-foreground/60">
                    <span>
                      {booking.slotCount} Slot ({block.totalMinutes} Dk)
                    </span>
                    <span aria-hidden="true">·</span>
                    <span className="font-medium text-foreground">{formatPriceFromCents(booking.totalCents, booking.currency)}</span>
                  </div>

                  <div className="mt-3 flex justify-end border-t border-border/60 pt-3">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="gap-1.5"
                      onClick={() => router.push(localize(`/patient/bookings/${booking.id}/invoice`))}
                    >
                      <FileText className="h-3.5 w-3.5" aria-hidden="true" />
                      Makbuzu Görüntüle
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Masaüstü tablo (md: ve üzeri) */}
          <table className="hidden w-full text-sm md:table">
            <thead>
              <tr className="border-b border-border text-left text-xs font-semibold uppercase tracking-wider text-foreground/50">
                <th className="py-2 pr-4">Tarih</th>
                <th className="py-2 pr-4">Rezervasyon No</th>
                <th className="py-2 pr-4">Doktor</th>
                <th className="py-2 pr-4">Süre / Slot</th>
                <th className="py-2 pr-4">Tutar</th>
                <th className="py-2 pr-4">Durum</th>
                <th className="py-2 pr-4 text-right">İşlem</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {paidBookings.map((booking) => {
                const block = computeAppointmentBlock(booking.appointments);
                const dateIso = booking.paidAt ?? booking.createdAt;
                return (
                  <tr key={booking.id}>
                    <td className="py-3 pr-4 text-foreground/70">
                      {formatDayLabel(dateIso, timeZone)} · {formatTime(dateIso, timeZone)}
                    </td>
                    <td className="py-3 pr-4 font-medium text-foreground">{booking.bookingNumber}</td>
                    <td className="py-3 pr-4 text-foreground">
                      {booking.doctor.title} {booking.doctor.fullName}
                    </td>
                    <td className="py-3 pr-4 text-foreground/70">
                      {booking.slotCount} Slot ({block.totalMinutes} Dk)
                    </td>
                    <td className="py-3 pr-4 font-medium text-foreground">{formatPriceFromCents(booking.totalCents, booking.currency)}</td>
                    <td className="py-3 pr-4">
                      <Badge tone="success" size="sm">
                        Ödendi
                      </Badge>
                    </td>
                    <td className="py-3 pr-4 text-right">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="gap-1.5"
                        onClick={() => router.push(localize(`/patient/bookings/${booking.id}/invoice`))}
                      >
                        <FileText className="h-3.5 w-3.5" aria-hidden="true" />
                        Makbuzu Görüntüle
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}

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
