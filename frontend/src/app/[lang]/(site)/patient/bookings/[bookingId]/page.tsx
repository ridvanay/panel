import type { Metadata } from "next";
import { PatientBookingDetailGate } from "@/components/site/telehealth/access-token-gates";
import { getSiteDictionary } from "@/lib/i18n/site-dictionaries";

/**
 * `.claude/architect-scope-telehealth-template.md` §9.7.7 madde 4 — hasta magic-link'i
 * (`#t=<accessToken>`; Paket AP — eski `?t=` geçiş süresince) VEYA oturum sahibi hasta erişir; misafir erişimi burada oturum
 * GEREKTİRMEZ (bu yüzden `PatientPortalShell`'in auth-guard'ı KULLANILMAZ).
 *
 * **Stripe Checkout ödeme dönüş sayfası da BURASIDIR** — integration-agent
 * (`telehealth.checkout.routes.ts::buildPatientReturnUrl`) `success_url`/`cancel_url`'i
 * doğrudan bu sayfaya `?payment=success|cancelled` sorgu parametresiyle kurar; AYRI bir
 * `/appointments/bookings/{id}/payment-success` rotası YOKTUR (§9.7.1).
 */
interface PatientBookingDetailPageProps {
  params: Promise<{ lang: string; bookingId: string }>;
  searchParams: Promise<{ payment?: string }>;
}

export function generateMetadata(): Metadata {
  return { robots: { index: false, follow: false } };
}

export default async function PatientBookingDetailPage({ params, searchParams }: PatientBookingDetailPageProps) {
  const { lang, bookingId } = await params;
  const { payment } = await searchParams;
  const paymentOutcome = payment === "success" || payment === "cancelled" ? payment : undefined;
  const dict = await getSiteDictionary(lang);

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <h1 className="mb-6 text-2xl font-semibold text-foreground">{dict.portal.bookingDetail.pageTitle}</h1>
      <PatientBookingDetailGate bookingId={bookingId} paymentOutcome={paymentOutcome} lang={lang} />
    </div>
  );
}
