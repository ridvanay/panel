import type { Metadata } from "next";
import { PatientBookingInvoicePanel } from "@/components/site/telehealth/patient-booking-invoice-panel";

/** `.claude/architect-scope-telehealth-template.md` §9.7.0 madde 11 — "Ödeme Belgesi (bilgi amaçlıdır)". */
interface InvoicePageProps {
  params: Promise<{ lang: string; bookingId: string }>;
  searchParams: Promise<{ t?: string }>;
}

export function generateMetadata(): Metadata {
  return { robots: { index: false, follow: false } };
}

export default async function PatientBookingInvoicePage({ params, searchParams }: InvoicePageProps) {
  const { bookingId } = await params;
  const { t } = await searchParams;

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <PatientBookingInvoicePanel bookingId={bookingId} accessToken={t} />
    </div>
  );
}
