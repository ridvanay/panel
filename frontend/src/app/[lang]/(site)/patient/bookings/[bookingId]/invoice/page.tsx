import type { Metadata } from "next";
import { PatientBookingInvoiceGate } from "@/components/site/telehealth/access-token-gates";

/** `.claude/architect-scope-telehealth-template.md` §9.7.0 madde 11 — "Ödeme Belgesi (bilgi amaçlıdır)". */
interface InvoicePageProps {
  params: Promise<{ lang: string; bookingId: string }>;
}

export function generateMetadata(): Metadata {
  return { robots: { index: false, follow: false } };
}

export default async function PatientBookingInvoicePage({ params }: InvoicePageProps) {
  const { bookingId } = await params;

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <PatientBookingInvoiceGate bookingId={bookingId} />
    </div>
  );
}
