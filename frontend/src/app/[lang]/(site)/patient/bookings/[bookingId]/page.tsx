import type { Metadata } from "next";
import { PatientBookingDetailPanel } from "@/components/site/telehealth/patient-booking-detail-panel";

/**
 * `.claude/architect-scope-telehealth-template.md` §9.7.7 madde 4 — hasta magic-link'i
 * (`?t=<accessToken>`) VEYA oturum sahibi hasta erişir; misafir erişimi burada oturum
 * GEREKTİRMEZ (bu yüzden `PatientPortalShell`'in auth-guard'ı KULLANILMAZ).
 *
 * **Stripe Checkout ödeme dönüş sayfası da BURASIDIR** — integration-agent
 * (`telehealth.checkout.routes.ts::buildPatientReturnUrl`) `success_url`/`cancel_url`'i
 * doğrudan bu sayfaya `?payment=success|cancelled` sorgu parametresiyle kurar; AYRI bir
 * `/appointments/bookings/{id}/payment-success` rotası YOKTUR (§9.7.1).
 */
interface PatientBookingDetailPageProps {
  params: Promise<{ lang: string; bookingId: string }>;
  searchParams: Promise<{ t?: string; payment?: string }>;
}

export function generateMetadata(): Metadata {
  return { robots: { index: false, follow: false } };
}

export default async function PatientBookingDetailPage({ params, searchParams }: PatientBookingDetailPageProps) {
  const { bookingId } = await params;
  const { t, payment } = await searchParams;
  const paymentOutcome = payment === "success" || payment === "cancelled" ? payment : undefined;

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <h1 className="mb-6 text-2xl font-semibold text-foreground">Rezervasyon Detayı</h1>
      <PatientBookingDetailPanel bookingId={bookingId} accessToken={t} paymentOutcome={paymentOutcome} />
    </div>
  );
}
