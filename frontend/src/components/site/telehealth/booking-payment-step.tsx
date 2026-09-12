"use client";

import { useState } from "react";
import { CreditCard, Loader2, Settings2 } from "lucide-react";
import * as telehealthApi from "@/lib/api/telehealth";
import { ApiClientError } from "@/lib/api/error";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";
import { formatPriceFromCents } from "@/lib/format-price";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";

/**
 * `.claude/architect-scope-telehealth-template.md` §9.7.1 (bağlayıcı) — Stripe Checkout'a
 * yönlendirme. `STRIPE_SECRET_KEY` tanımsızsa `503 PAYMENTS_NOT_CONFIGURED` — bu durumda
 * `consultation-room.tsx::LiveKitNotConfiguredPanel` İLE BİREBİR AYNI dürüst durum paneli deseni
 * (§4.4 madde 3) kullanılır: sahte/mock bir ödeme veya "escrow" ekranı KESİNLİKLE YAZILMAZ.
 * Randevu bu durumda otomatik `PAID`'e ÇEVRİLMEZ.
 */
interface BookingPaymentStepProps {
  bookingId: string;
  /** Misafir hasta magic-link'i — oturum-tabanlı erişimde (booking'in kendi sahibi) verilmez. */
  accessToken?: string;
  totalCents: number;
  currency: string;
}

function PaymentsNotConfiguredPanel({ onRetry, retrying }: { onRetry: () => void; retrying: boolean }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-[var(--site-radius)] border border-warning/30 bg-warning/5 p-8 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-warning/15">
        <Settings2 className="h-5 w-5 text-warning" aria-hidden="true" />
      </span>
      <h3 className="font-semibold text-foreground">Ödeme Altyapısı Yapılandırılmamış</h3>
      <p className="max-w-sm text-sm text-foreground/60">
        Bu kurulumda Stripe ödeme altyapısı henüz yapılandırılmamış. Rezervasyonunuz oluşturuldu ve slotunuz süresi
        dolana kadar tutuluyor; ödeme yapılabilmesi için lütfen yönetici ile iletişime geçin.
      </p>
      <Button type="button" variant="outline" size="sm" onClick={onRetry} loading={retrying}>
        Tekrar Dene
      </Button>
    </div>
  );
}

export function BookingPaymentStep({ bookingId, accessToken, totalCents, currency }: BookingPaymentStepProps) {
  const [requesting, setRequesting] = useState(false);
  const [notConfigured, setNotConfigured] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handlePay() {
    setRequesting(true);
    setError(null);
    setNotConfigured(false);
    try {
      const session = await telehealthApi.createBookingCheckoutSession(bookingId, accessToken);
      window.location.href = session.checkoutUrl;
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 503) {
        setNotConfigured(true);
      } else {
        setError(friendlyErrorMessage(err));
      }
      setRequesting(false);
    }
  }

  if (notConfigured) {
    return <PaymentsNotConfiguredPanel onRetry={() => void handlePay()} retrying={requesting} />;
  }

  return (
    <div className="space-y-4 rounded-[var(--site-radius)] border border-border bg-surface p-5">
      <div className="flex items-baseline justify-between">
        <span className="text-sm font-semibold text-foreground">Ödenecek Tutar</span>
        <span className="text-2xl font-semibold text-foreground">{formatPriceFromCents(totalCents, currency)}</span>
      </div>

      {error && <Alert variant="error">{error}</Alert>}

      <Button type="button" onClick={() => void handlePay()} loading={requesting} className="w-full rounded-[var(--site-radius)]">
        {requesting ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" aria-hidden="true" />}
        Ödemeye Geç
      </Button>
      <p className="text-center text-xs text-foreground/50">Güvenli ödeme sayfasına (Stripe Checkout) yönlendirileceksiniz.</p>
    </div>
  );
}
