"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CreditCard, FlaskConical, Loader2, Settings2 } from "lucide-react";
import * as telehealthApi from "@/lib/api/telehealth";
import * as settingsApi from "@/lib/api/settings";
import { ApiClientError } from "@/lib/api/error";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";
import { formatPriceFromCents } from "@/lib/format-price";
import { DEMO_PAYMENTS_ENABLED } from "@/lib/env";
import type { AppointmentBooking } from "@/lib/api/types";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";

/**
 * `.claude/architect-scope-telehealth-template.md` §9.7.1 (bağlayıcı) — Stripe Checkout'a
 * yönlendirme. `STRIPE_SECRET_KEY` tanımsızsa `503 PAYMENTS_NOT_CONFIGURED` — bu durumda
 * `consultation-room.tsx::LiveKitNotConfiguredPanel` İLE BİREBİR AYNI dürüst durum paneli deseni
 * (§4.4 madde 3) kullanılır: sahte/mock bir ödeme veya "escrow" ekranı KESİNLİKLE YAZILMAZ.
 * Randevu bu durumda otomatik `PAID`'e ÇEVRİLMEZ.
 *
 * `.claude/architect-scope-demo-payment-doctor-counters.md` İstek 1 §1.5 (bağlayıcı) —
 * `DEMO_PAYMENTS_ENABLED` AÇIKKEN, Stripe akışının (yukarıdaki dürüst-yapılandırılmamışlık
 * sözleşmesi DAHİL) YANINA, `paymentsConfigured`'dan BAĞIMSIZ bir "Demo Ödemeyi Tamamla (Test)"
 * butonu eklenir — geliştirici Stripe webhook tüneli KURMADAN uçtan uca e2e test edebilsin diye.
 * Prod build'de `DEMO_PAYMENTS_ENABLED` statik olarak `false`'a sabitlendiği için bu blok dead-code
 * elimination ile bundle'dan TAMAMEN düşer (bkz. `lib/env.ts`).
 *
 * `.claude/security-review-demo-payment-toggle.md` Madde 4 (bağlayıcı, 2026-09-15) — build-time
 * `DEMO_PAYMENTS_ENABLED` katmanı KORUNUR, YERİNE değil YANINA ikinci bir runtime kapı eklenir:
 * admin panelden `SiteSettings.demoPaymentsEnabled` (DB) kapatılmışsa buton, env AÇIK olsa bile
 * GİZLENİR. Bu bileşen kendi küçük `useEffect`'iyle herkese açık `GET /settings`i çeker (yeni bir
 * global context İCAT EDİLMEDİ — en dar kapsamlı çözüm). Nihai görünürlük koşulu:
 * `DEMO_PAYMENTS_ENABLED (build-time) && demoPaymentsRuntimeEnabled (runtime, sunucudan)`.
 */
interface BookingPaymentStepProps {
  bookingId: string;
  /** Misafir hasta magic-link'i — oturum-tabanlı erişimde (booking'in kendi sahibi) verilmez. */
  accessToken?: string;
  totalCents: number;
  currency: string;
  /**
   * Demo ödeme başarısından sonra hasta rezervasyon detay sayfasına dönmek için — Stripe
   * `checkout.routes.ts::buildPatientReturnUrl`'in `success_url`'i İLE AYNI rota/dil segmenti.
   * **DİKKAT:** backend bu rotayı HER ZAMAN `localeSet.default.code` ile kurar (aktif/görüntülenen
   * `lang` DEĞİL, bkz. `notifications.ts::buildMagicLink` İLE AYNI desen) — çağıran taraf burada
   * sayfanın kendi `lang`'ini DEĞİL, `defaultLocaleCode`'u geçmelidir (randevu sihirbazı,
   * `booking-wizard.tsx`, bunu ZATEN böyle yapar). `onDemoPaid` verilmezse KULLANILIR (bkz.
   * aşağıdaki `onDemoPaid` yorumu).
   */
  lang: string;
  /**
   * Opsiyonel — çağıran zaten `/{lang}/patient/bookings/{bookingId}` sayfasındaysa (ör.
   * `patient-booking-detail-panel.tsx`, hasta ödemeyi ERTELEYİP bu sayfaya sonradan geri
   * döndüğünde) kendi kendine yönlendirmek yerine güncel `AppointmentBooking`'i doğrudan üst
   * bileşenin state'ine yazar (aynı rotaya `router.push` sadece query değiştirdiği için App
   * Router'ın CLIENT bileşen state'ini otomatik tazelemeyeceği bilinen kısıtı — bkz. görev
   * notu). Verilmezse (ör. randevu sihirbazı — bu sayfada HENÜZ değil) varsayılan davranış
   * devreye girer: §1.5 "yeni bir yönlendirme mekanizması icat edilmez" ile TUTARLI TEK hedef
   * rotaya (`?payment=success`) `router.push` edilir — Stripe'ın `success_url`'i İLE AYNI sonuç.
   */
  onDemoPaid?: (booking: AppointmentBooking) => void;
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

/**
 * `.claude/architect-scope-demo-payment-doctor-counters.md` §1.5 — buton "Demo Ödemeyi Tamamla
 * (Test)", mevcut `Button variant="outline"` + `Alert`in `warning` tonuyla AYNI `--warning`
 * token'ı (bkz. `alert.tsx`/`PaymentsNotConfiguredPanel`'in `border-warning/30 bg-warning/5`
 * kalıbı) — yeni bir görsel patern İCAT EDİLMEDİ, gerçek ödeme butonuyla (yukarıdaki `default`
 * varyant) KARIŞTIRILMASIN diye çerçeveli, açık "Geliştirici Aracı" etiketli bir kutuda izole
 * edilir.
 */
function DemoPaymentPanel({ onDemoPay, loading }: { onDemoPay: () => void; loading: boolean }) {
  return (
    <div className="space-y-2 rounded-[var(--site-radius)] border border-warning/30 bg-warning/5 p-3">
      <p className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-warning uppercase">
        <FlaskConical className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        Geliştirici Aracı
      </p>
      <Button type="button" variant="outline" size="sm" onClick={onDemoPay} loading={loading} className="w-full rounded-[var(--site-radius)]">
        Demo Ödemeyi Tamamla (Test)
      </Button>
      <p className="text-xs text-warning/80">Yalnızca geliştirme ortamı — gerçek tahsilat yapılmaz.</p>
    </div>
  );
}

export function BookingPaymentStep({ bookingId, accessToken, totalCents, currency, lang, onDemoPaid }: BookingPaymentStepProps) {
  const router = useRouter();
  const [requesting, setRequesting] = useState(false);
  const [notConfigured, setNotConfigured] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [demoRequesting, setDemoRequesting] = useState(false);
  const [demoError, setDemoError] = useState<string | null>(null);
  // Fail-closed varsayılan: sunucudan doğrulanana kadar `false` (env AÇIK olsa da buton gizli kalır).
  const [demoPaymentsRuntimeEnabled, setDemoPaymentsRuntimeEnabled] = useState(false);

  useEffect(() => {
    if (!DEMO_PAYMENTS_ENABLED) return;
    let cancelled = false;
    (async () => {
      try {
        const settings = await settingsApi.getPublicSettings();
        if (!cancelled) setDemoPaymentsRuntimeEnabled(settings.demoPaymentsEnabled);
      } catch {
        // Sessizce yok sayılır — arıza durumunda güvenli (fail-closed) varsayılan `false` korunur,
        // gerçek ödeme akışı (yukarıdaki `handlePay`) bu hatadan ETKİLENMEZ.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const showDemoPanel = DEMO_PAYMENTS_ENABLED && demoPaymentsRuntimeEnabled;

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

  /**
   * §1.5 — "sihirbaz mevcut başarı akışına girer (`?payment=success` dönüşüyle AYNI sonuç
   * durumu)". Yeni bir yönlendirme mekanizması İCAT EDİLMEZ: hedef, Stripe'ın
   * `buildPatientReturnUrl`'ünün ürettiği AYNI rota (`/{lang}/patient/bookings/{bookingId}
   * ?payment=success&t=...`) — misafir `?t=` varsa AYNEN taşınır (demo-pay ucu token'ı rotate
   * ETMEZ, bkz. backend handler yorumu).
   */
  async function handleDemoPay() {
    setDemoRequesting(true);
    setDemoError(null);
    try {
      const paidBooking = await telehealthApi.demoPayBooking(bookingId, accessToken);
      if (onDemoPaid) {
        onDemoPaid(paidBooking);
      } else {
        const tokenSuffix = accessToken ? `&t=${encodeURIComponent(accessToken)}` : "";
        router.push(`/${lang}/patient/bookings/${bookingId}?payment=success${tokenSuffix}`);
      }
    } catch (err) {
      // `.claude/security-review-demo-payment-toggle.md` Madde 5 — env-gate AÇIK olduğu halde
      // admin DB'den kapatmışsa backend bu SPESİFİK kodla `403` döner; genel `FORBIDDEN`/
      // `friendlyErrorMessage` mesajından AYRI, açık bir mesajla gösterilir.
      if (err instanceof ApiClientError && err.code === "DEMO_PAYMENTS_DISABLED") {
        setDemoError("Demo ödeme şu anda yönetici tarafından devre dışı bırakılmış.");
      } else {
        setDemoError(friendlyErrorMessage(err));
      }
      setDemoRequesting(false);
    }
  }

  if (notConfigured) {
    return (
      <div className="space-y-4">
        <PaymentsNotConfiguredPanel onRetry={() => void handlePay()} retrying={requesting} />
        {showDemoPanel && (
          <>
            <DemoPaymentPanel onDemoPay={() => void handleDemoPay()} loading={demoRequesting} />
            {demoError && <Alert variant="error">{demoError}</Alert>}
          </>
        )}
      </div>
    );
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

      {showDemoPanel && (
        <>
          <DemoPaymentPanel onDemoPay={() => void handleDemoPay()} loading={demoRequesting} />
          {demoError && <Alert variant="error">{demoError}</Alert>}
        </>
      )}
    </div>
  );
}
