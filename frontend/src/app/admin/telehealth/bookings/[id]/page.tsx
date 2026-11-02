"use client";

import { use, useCallback, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { AlertCircle, ArrowLeft, CreditCard } from "lucide-react";
import * as telehealthApi from "@/lib/api/telehealth";
import type { AdminBookingDetail, AppointmentStatus, BookingPaymentStatus } from "@/lib/api/types";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeading } from "@/components/admin/page-heading";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";
import { formatPriceFromCents } from "@/lib/format-price";
import { TURKEY_TIME_ZONE, cityLabel, gmtLabel, isSameClockAsTurkey } from "@/lib/dual-time";

/**
 * Paket AG (İş 2) — salt-okunur rezervasyon detayı. Yönetici randevu bildirim e-postasındaki "Open appointment"
 * bağlantısının hedefi (`/admin/telehealth/bookings/<id>`). Oturum yoksa `admin-shell` `/login?next=<bu yol>`'a yönlendirir
 * ve girişten sonra buraya döner. Veri `GET /admin/telehealth/bookings/{id}` (ADMIN/MANAGER) — hasta bilgisi YALNIZCA burada görünür.
 */
const PAYMENT_LABELS: Record<BookingPaymentStatus, string> = {
  PENDING: "Ödeme Bekliyor",
  PAID: "Ödendi",
  FAILED: "Başarısız",
  EXPIRED: "Süresi Doldu",
  REFUNDED: "İade Edildi",
};
const PAYMENT_TONES: Record<BookingPaymentStatus, "neutral" | "success" | "danger" | "warning"> = {
  PENDING: "warning",
  PAID: "success",
  FAILED: "danger",
  EXPIRED: "neutral",
  REFUNDED: "neutral",
};
const APPOINTMENT_LABELS: Record<AppointmentStatus, string> = {
  PENDING_PAYMENT: "Ödeme bekliyor",
  SCHEDULED: "Planlandı",
  IN_PROGRESS: "Devam ediyor",
  COMPLETED: "Tamamlandı",
  CANCELLED: "İptal edildi",
  NO_SHOW: "Gelmedi",
};
const PAID_BY_LABELS: Record<string, string> = { stripe: "Kart (Stripe)", manual: "Manuel", free: "Ücretsiz seans", demo: "Demo" };

const dateFormatter = new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short", timeZone: TURKEY_TIME_ZONE });

function languageName(code: string): string {
  try {
    const name = new Intl.DisplayNames(["tr"], { type: "language" }).of(code === "sr-latn" ? "sr-Latn" : code);
    return name && name !== code ? `${name} (${code})` : code;
  } catch {
    return code;
  }
}

function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border/50 py-2 last:border-b-0">
      <dt className="text-sm text-foreground/60">{label}</dt>
      <dd className="text-sm font-medium text-foreground">{children}</dd>
    </div>
  );
}

export default function AdminBookingDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [booking, setBooking] = useState<AdminBookingDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setBooking(await telehealthApi.getAdminBooking(id));
    } catch (err) {
      setError(friendlyErrorMessage(err));
    }
  }, [id]);

  useEffect(() => {
    (async () => {
      await load();
    })();
  }, [load]);

  const back = (
    <Link href="/admin/telehealth/bookings" className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline">
      <ArrowLeft className="h-4 w-4" />
      Rezervasyonlara dön
    </Link>
  );

  if (error) {
    return (
      <div className="space-y-6">
        {back}
        <Alert variant="error">
          <span className="flex flex-wrap items-center justify-between gap-3">
            <span className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {error}
            </span>
            <Button type="button" variant="outline" size="sm" onClick={() => void load()}>
              Tekrar Dene
            </Button>
          </span>
        </Alert>
      </div>
    );
  }

  if (!booking) {
    return (
      <div className="flex justify-center py-12">
        <Spinner className="h-6 w-6 text-primary" />
      </div>
    );
  }

  const patientTz = booking.patientTimeZone ?? null;
  const duration = booking.appointments.reduce((sum, a) => sum + Math.round((new Date(a.endsAt).getTime() - new Date(a.startsAt).getTime()) / 60_000), 0);

  return (
    <div className="space-y-6">
      {back}
      <PageHeading
        icon={CreditCard}
        title={`Rezervasyon ${booking.bookingNumber}`}
        description="Rezervasyonun salt okunur ayrıntıları — hasta bilgisi içerir."
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="space-y-1">
          <h2 className="admin-h2 mb-2">Rezervasyon</h2>
          <dl>
            <DetailRow label="Rezervasyon no">{booking.bookingNumber}</DetailRow>
            <DetailRow label="Hekim">
              {booking.doctor.title} {booking.doctor.fullName}
            </DetailRow>
            <DetailRow label="Ödeme durumu">
              <Badge tone={PAYMENT_TONES[booking.paymentStatus]} size="sm">
                {PAYMENT_LABELS[booking.paymentStatus]}
              </Badge>
              {booking.paidBy && <span className="ml-2 text-xs font-normal text-foreground/60">{PAID_BY_LABELS[booking.paidBy] ?? booking.paidBy}</span>}
            </DetailRow>
            <DetailRow label="Tutar">{formatPriceFromCents(booking.totalCents, booking.currency)}</DetailRow>
            <DetailRow label="Toplam süre">{duration} dk</DetailRow>
            <DetailRow label="Tercüman">{booking.interpreterLanguage ? `Var (${languageName(booking.interpreterLanguage)})` : "Yok"}</DetailRow>
            {booking.locale && <DetailRow label="Hastanın site dili">{languageName(booking.locale)}</DetailRow>}
            {booking.archivedAt && <DetailRow label="Arşiv">Test olarak arşivlendi</DetailRow>}
          </dl>
        </Card>

        <Card className="space-y-1">
          <h2 className="admin-h2 mb-2">Hasta</h2>
          <dl>
            <DetailRow label="Ad soyad">{booking.patientName}</DetailRow>
            <DetailRow label="E-posta">{booking.patientEmail}</DetailRow>
            <DetailRow label="Saat dilimi">{patientTz ? `${cityLabel(patientTz)} (${patientTz})` : "Bilinmiyor"}</DetailRow>
          </dl>
        </Card>
      </div>

      <Card className="space-y-3">
        <h2 className="admin-h2">Randevular</h2>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Tarih / saat (TSİ)</TableHead>
              <TableHead>Hastanın saati</TableHead>
              <TableHead>Durum</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {booking.appointments.map((appointment) => (
              <TableRow key={appointment.id}>
                <TableCell className="text-sm">
                  {dateFormatter.format(new Date(appointment.startsAt))} TSİ
                  <span className="ml-1 text-xs text-foreground/50">({gmtLabel(appointment.startsAt, TURKEY_TIME_ZONE)})</span>
                </TableCell>
                <TableCell className="text-sm text-foreground/70">
                  {patientTz && !isSameClockAsTurkey(appointment.startsAt, patientTz)
                    ? `${cityLabel(patientTz)} ${new Intl.DateTimeFormat("tr-TR", { dateStyle: "short", timeStyle: "short", timeZone: patientTz }).format(new Date(appointment.startsAt))} (${gmtLabel(appointment.startsAt, patientTz)})`
                    : "—"}
                </TableCell>
                <TableCell>
                  <Badge tone={appointment.status === "CANCELLED" ? "danger" : appointment.status === "SCHEDULED" ? "success" : "neutral"} size="sm">
                    {APPOINTMENT_LABELS[appointment.status]}
                  </Badge>
                  {appointment.cancelReason && <p className="mt-1 text-xs text-foreground/50">{appointment.cancelReason}</p>}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
