"use client";

import { useState } from "react";
import { CalendarCheck, Mail } from "lucide-react";
import * as telehealthApi from "@/lib/api/telehealth";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";
import type { CreateBookingResult } from "@/lib/api/types";
import { formatDayLabel, formatTime } from "@/lib/telehealth-format";
import { formatPriceFromCents } from "@/lib/format-price";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { BookingIntakeStep } from "@/components/site/telehealth/booking-intake-step";
import { BookingPaymentStep } from "@/components/site/telehealth/booking-payment-step";

/**
 * `.claude/architect-scope-telehealth-template.md` §9.7.1/§9.7.5 — rezervasyon oluşturulduktan
 * sonraki akış: (1) özet + magic-link, (2) opsiyonel "Tıbbi Belgeler ve Ön Bilgiler" adımı,
 * (3) ödeme (Stripe Checkout'a yönlendirme / dürüst "yapılandırılmamış" paneli). Booking
 * `PENDING_PAYMENT` ile `expiresAt` (30 dk) SÜRESİNCE tutulur (§9.7.3) — bu akış o pencere
 * İÇİNDE tamamlanmalıdır.
 */
export function BookingPostCreationFlow({ result, displayTimeZone }: { result: CreateBookingResult; displayTimeZone: string }) {
  const [step, setStep] = useState<"intake" | "payment">("intake");
  const [resendState, setResendState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [resendError, setResendError] = useState<string | null>(null);

  async function handleResend() {
    setResendState("sending");
    setResendError(null);
    try {
      await telehealthApi.resendBookingLink(result.bookingId);
      setResendState("sent");
    } catch (err) {
      setResendState("error");
      setResendError(friendlyErrorMessage(err));
    }
  }

  return (
    <div className="space-y-4">
      <Alert variant="success">
        <div className="space-y-2">
          <p className="flex items-center gap-1.5 font-medium">
            <CalendarCheck className="h-4 w-4 shrink-0" aria-hidden="true" />
            Rezervasyonunuz oluşturuldu ({result.bookingNumber}).
          </p>
          <div className="flex flex-wrap gap-1.5">
            {result.appointments.map((appointment) => (
              <span key={appointment.id} className="rounded-full border border-success/30 bg-success/10 px-2 py-0.5 text-xs tabular-nums">
                {formatDayLabel(appointment.startsAt, displayTimeZone)} · {formatTime(appointment.startsAt, displayTimeZone)}
              </span>
            ))}
          </div>
          <p className="text-sm">
            {result.slotCount} Slot · Toplam {formatPriceFromCents(result.totalCents, result.currency)}. Bu rezervasyon
            slotu <strong>30 dakika</strong> tutar; bu süre içinde ödemeyi tamamlamanız gerekir.
          </p>
          <p className="text-sm">
            Randevunuzu daha sonra görüntülemek için bu bağlantıyı not alın veya yer imlerine ekleyin — ödeme onaylandığında
            aynı bağlantı e-posta ile de gönderilir.
          </p>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Button type="button" variant="outline" size="sm" onClick={() => void handleResend()} loading={resendState === "sending"}>
              <Mail className="h-3.5 w-3.5" aria-hidden="true" />
              Bağlantıyı e-posta ile gönder
            </Button>
            {resendState === "sent" && <span className="text-xs text-success">Gönderildi (e-posta kayıtlıysa).</span>}
            {resendState === "error" && <span className="text-xs text-danger">{resendError}</span>}
          </div>
        </div>
      </Alert>

      {step === "intake" ? (
        <BookingIntakeStep bookingId={result.bookingId} accessToken={result.accessToken} onDone={() => setStep("payment")} />
      ) : (
        <BookingPaymentStep
          bookingId={result.bookingId}
          accessToken={result.accessToken}
          totalCents={result.totalCents}
          currency={result.currency}
        />
      )}
    </div>
  );
}
