"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Archive } from "lucide-react";
import * as telehealthApi from "@/lib/api/telehealth";
import type { AppointmentBooking } from "@/lib/api/types";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";
import { formatPriceFromCents } from "@/lib/format-price";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { Alert } from "@/components/ui/alert";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/** Yalnızca arayüz uyarısı için ipucu — otorite backend `lib/demo-doctor-purge.ts::isRealPayment`. */
const REAL_PAYMENT_PROVIDERS = new Set(["stripe", "manual"]);

interface ArchiveBookingDialogProps {
  booking: AppointmentBooking | null;
  onOpenChange: (open: boolean) => void;
  onArchived?: (booking: AppointmentBooking) => void;
}

/**
 * 2026-10-18 (Paket B4) — "Test olarak arşivle". Yalnızca ADMIN (backend zorlar), gerekçe zorunlu.
 * Booking ve randevuları doktor kazancı, analitik ve listelerden çıkar; ödeme/fatura/kayıt verisi
 * SİLİNMEZ. Gerçek tahsilat izi (stripe/manuel) olan booking için gelir raporu uyarısı gösterilir.
 */
export function ArchiveBookingDialog({ booking, onOpenChange, onArchived }: ArchiveBookingDialogProps) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (booking) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- `support/templates` İLE AYNI desen: dialog her açılışta formu sıfırlar
      setReason("");
      setError(null);
    }
  }, [booking]);

  function handleOpenChange(next: boolean) {
    if (!submitting) onOpenChange(next);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!booking) return;
    if (reason.trim().length < 3) {
      setError("Gerekçe en az 3 karakter olmalı.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const archived = await telehealthApi.archiveBooking(booking.id, reason.trim());
      toast.success(`${archived.bookingNumber} test olarak arşivlendi.`);
      onOpenChange(false);
      onArchived?.(archived);
    } catch (err) {
      setError(friendlyErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  const realPayment = booking ? booking.paidBy !== null && REAL_PAYMENT_PROVIDERS.has(booking.paidBy) : false;

  return (
    <Dialog open={booking !== null} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-warning/10 text-warning">
              <Archive className="h-4 w-4" />
            </span>
            <div>
              <DialogTitle>Test olarak arşivle</DialogTitle>
              <DialogDescription className="mt-1">
                {booking
                  ? `${booking.bookingNumber} · ${booking.patientName} · ${formatPriceFromCents(booking.totalCents, booking.currency)}`
                  : undefined}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <form className="space-y-4" onSubmit={handleSubmit} noValidate>
          <p className="text-sm text-foreground/70">
            Rezervasyon ve randevuları doktor kazancından, analitikten, randevu listelerinden, hasta panelinden ve doktor konsolundan çıkarılır.
            Hiçbir veri silinmez; ödeme, fatura ve kayıt bilgileri olduğu gibi kalır. İşlem denetim kaydına yazılır ve geri alınabilir.
          </p>
          {realPayment && (
            <Alert variant="warning">
              Bu rezervasyonda gerçek tahsilat izi var ({booking?.paidBy}). Arşivlenirse gelir raporlarından düşer; yalnızca gerçekten test
              ödemesiyse arşivleyin.
            </Alert>
          )}
          {error && <Alert variant="error">{error}</Alert>}
          <Field id="archive-booking-reason" label="Gerekçe" required>
            {(inputProps) => (
              <Textarea
                {...inputProps}
                rows={3}
                maxLength={500}
                placeholder="Örn. Canlı ortamda uçtan uca test ödemesi"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            )}
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)} disabled={submitting}>
              Vazgeç
            </Button>
            <Button type="submit" variant="warning" loading={submitting}>
              Arşivle
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
