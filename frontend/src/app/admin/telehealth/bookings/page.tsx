"use client";

import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { AlertCircle, CreditCard, Search } from "lucide-react";
import * as telehealthApi from "@/lib/api/telehealth";
import type { AppointmentBooking, BookingPaymentStatus } from "@/lib/api/types";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import { EmptyState } from "@/components/ui/empty-state";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/select";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeading } from "@/components/admin/page-heading";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";
import { formatPriceFromCents } from "@/lib/format-price";

/**
 * `.claude/architect-scope-telehealth-template.md` §5.1/§8.4/§9.7.1 madde 7 — rezervasyon
 * listesi, hasta PII'si + para hareketi içerir. Backend `GET` için `requireSiteRole(ADMIN,
 * MANAGER)`, `POST .../mark-paid` için YALNIZCA `ADMIN` ister (`appointments/page.tsx`'teki
 * reschedule İLE AYNI eşik disiplini — frontend rolü KISITLAMAZ, MANAGER butona tıklarsa
 * sunucudan temiz bir 403 alır, `friendlyErrorMessage` ile forma yansır — `Reschedule
 * AppointmentDialog` İLE AYNI KASITLI desen).
 *
 * 2026-09-19 (kullanıcı talebi) — canlı ortamda `ENABLE_DEMO_PAYMENTS=true` KESİNLİKLE
 * AÇILAMAZ (bkz. `lib/api/telehealth.ts::markBookingPaid` yorumu — `NODE_ENV=production`
 * iken backend BOOT ANINDA çöker, bilinçli/belgelenmiş fail-closed koruma). Bu sayfa, canlıda
 * randevu + WebRTC akışını uçtan uca test edebilmek için ZATEN VAR OLAN (`ADMIN`-only)
 * `mark-paid` ucuna tek tıkla erişim sağlar — yeni bir ödeme simülatörü İCAT ETMEZ, mevcut
 * "manuel ödeme al" iş akışının (§9.7.1 madde 7) arayüzüdür.
 */
const STATUS_LABELS: Record<BookingPaymentStatus, string> = {
  PENDING: "Ödeme Bekliyor",
  PAID: "Ödendi",
  FAILED: "Başarısız",
  EXPIRED: "Süresi Doldu",
  REFUNDED: "İade Edildi",
};

const STATUS_TONES: Record<BookingPaymentStatus, "neutral" | "primary" | "success" | "danger" | "warning"> = {
  PENDING: "warning",
  PAID: "success",
  FAILED: "danger",
  EXPIRED: "neutral",
  REFUNDED: "neutral",
};

const dateFormatter = new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short" });

/** Manuel test ödemesi için sabit, açıklayıcı denetim (audit) nedeni — `reason` backend'de
 * ZORUNLUDUR (§9.7.1 madde 7), her seferinde elle yazdırmak "tek tıkla test" hedefiyle ÇELİŞİR. */
const TEST_MARK_PAID_REASON = "Admin panelinden manuel test ödemesi (canlı randevu/WebRTC uçtan uca testi).";

export default function AdminTelehealthBookingsPage() {
  const [bookings, setBookings] = useState<AppointmentBooking[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [paymentStatus, setPaymentStatus] = useState<BookingPaymentStatus | "">("");
  const [search, setSearch] = useState("");
  const [pendingMarkPaid, setPendingMarkPaid] = useState<AppointmentBooking | null>(null);
  const [markingPaid, setMarkingPaid] = useState(false);

  const load = useCallback(async (paymentStatus?: BookingPaymentStatus, search?: string) => {
    try {
      const page = await telehealthApi.listAdminBookings({ paymentStatus: paymentStatus || undefined, search: search || undefined, limit: 100 });
      setBookings(page.items);
      setError(null);
    } catch (err) {
      setError(friendlyErrorMessage(err));
    }
  }, []);

  useEffect(() => {
    const handle = setTimeout(() => void load(paymentStatus || undefined, search), 250);
    return () => clearTimeout(handle);
  }, [load, paymentStatus, search]);

  async function handleMarkPaid() {
    if (!pendingMarkPaid) return;
    setMarkingPaid(true);
    try {
      await telehealthApi.markBookingPaid(pendingMarkPaid.id, TEST_MARK_PAID_REASON);
      toast.success("Rezervasyon ödendi olarak işaretlendi — onay e-postası ve görüşme odası hazırlığı tetiklendi.");
      setPendingMarkPaid(null);
      await load(paymentStatus || undefined, search);
    } catch (err) {
      toast.error(friendlyErrorMessage(err));
    } finally {
      setMarkingPaid(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeading
        icon={CreditCard}
        title="Rezervasyonlar"
        description={
          'Tüm doktorların rezervasyonları — hasta PII\'si içerir. "Ödendi İşaretle (Test)" YALNIZCA ADMIN tarafından kullanılabilir; canlı ortamda uçtan uca test için demo ödeme modu yerine bu manuel işlem kullanılır.'
        }
      />

      {error && (
        <Alert variant="error">
          <span className="flex flex-wrap items-center justify-between gap-3">
            <span className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {error}
            </span>
            <Button type="button" variant="outline" size="sm" onClick={() => void load(paymentStatus || undefined, search)}>
              Tekrar Dene
            </Button>
          </span>
        </Alert>
      )}

      {bookings === null ? (
        <div className="flex justify-center py-12">
          <Spinner className="h-6 w-6 text-primary" />
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <InputGroup className="w-full sm:max-w-xs border-2 border-border bg-muted">
              <InputGroupAddon>
                <Search />
              </InputGroupAddon>
              <InputGroupInput
                placeholder="Hasta adına, e-postasına veya rezervasyon no'suna göre ara..."
                aria-label="Rezervasyon ara"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </InputGroup>
            <Select
              aria-label="Ödeme durumu filtresi"
              value={paymentStatus}
              onChange={(e) => setPaymentStatus(e.target.value as BookingPaymentStatus | "")}
              className="w-auto"
            >
              <option value="">Tüm durumlar</option>
              {(Object.keys(STATUS_LABELS) as BookingPaymentStatus[]).map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABELS[s]}
                </option>
              ))}
            </Select>
          </div>

          {bookings.length === 0 ? (
            <EmptyState
              icon={CreditCard}
              title="Henüz rezervasyon yok"
              description="İlk gerçek rezervasyon, hasta randevu akışını tamamladığında burada görünecek."
            />
          ) : (
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Rezervasyon No</TableHead>
                    <TableHead>Hasta</TableHead>
                    <TableHead>Doktor</TableHead>
                    <TableHead>Tarih</TableHead>
                    <TableHead>Tutar</TableHead>
                    <TableHead>Durum</TableHead>
                    <TableHead className="text-right">İşlemler</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {bookings.map((booking) => (
                    <TableRow key={booking.id}>
                      <TableCell className="font-mono text-xs text-foreground/70">{booking.bookingNumber}</TableCell>
                      <TableCell>
                        <span className="font-medium text-foreground">{booking.patientName}</span>
                        <p className="text-xs text-foreground/50">{booking.patientEmail}</p>
                      </TableCell>
                      <TableCell className="text-sm text-foreground/70">
                        {booking.doctor.title} {booking.doctor.fullName}
                      </TableCell>
                      <TableCell className="text-sm text-foreground/70">
                        {booking.appointments[0] ? dateFormatter.format(new Date(booking.appointments[0].startsAt)) : "—"}
                        {booking.slotCount > 1 && <span className="ml-1 text-xs text-foreground/50">(+{booking.slotCount - 1} slot)</span>}
                      </TableCell>
                      <TableCell className="text-sm text-foreground/70">{formatPriceFromCents(booking.totalCents, booking.currency)}</TableCell>
                      <TableCell>
                        <Badge tone={STATUS_TONES[booking.paymentStatus]} size="sm">
                          {STATUS_LABELS[booking.paymentStatus]}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        {booking.paymentStatus === "PENDING" && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setPendingMarkPaid(booking)}
                            aria-label={`"${booking.patientName}" için rezervasyonu ödendi olarak işaretle`}
                          >
                            <CreditCard className="h-3.5 w-3.5" />
                            Ödendi İşaretle (Test)
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </motion.div>
          )}
        </>
      )}

      <ConfirmDialog
        open={pendingMarkPaid !== null}
        onOpenChange={(open) => {
          if (!open) setPendingMarkPaid(null);
        }}
        title="Rezervasyonu ödendi olarak işaretle"
        description={
          pendingMarkPaid
            ? `"${pendingMarkPaid.patientName}" için ${pendingMarkPaid.bookingNumber} numaralı rezervasyon GERÇEKTEN ödenmiş sayılacak: randevu(lar) planlanacak, onay e-postası gönderilecek ve görüşme odası hazırlanacak. Gerçek bir tahsilat YAPILMAZ — yalnızca canlı ortamda test amacıyla kullanın.`
            : undefined
        }
        confirmText="Ödendi İşaretle"
        tone="warning"
        loading={markingPaid}
        onConfirm={handleMarkPaid}
      />
    </div>
  );
}
