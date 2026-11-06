"use client";

import { Spinner } from "@/components/ui/spinner";
import { useLocationToken } from "@/lib/use-location-token";
import { ConsultationRoom } from "@/components/site/telehealth/consultation-room";
import { PatientBookingDetailPanel } from "@/components/site/telehealth/patient-booking-detail-panel";
import { PatientBookingInvoicePanel } from "@/components/site/telehealth/patient-booking-invoice-panel";

/**
 * Paket AP — hasta rezervasyon / fatura / görüşme sayfaları booking erişim token'ını `#t=` parçasından alır
 * (eski `?t=` geçiş süresince) ve adresten siler; panel bileşenleri aynı `accessToken` prop'unu alır, kendileri
 * değişmez. Aynı rezervasyonun sayfaları (detay ↔ fatura) token'ı sekme içinde `sessionStorage` ile paylaşır.
 */
export const bookingTokenStorageKey = (bookingId: string) => `booking-access:${bookingId}`;
const consultationTokenStorageKey = (appointmentId: string) => `consultation-access:${appointmentId}`;

function Pending() {
  return (
    <div className="flex justify-center py-16">
      <Spinner className="h-6 w-6 text-primary" />
    </div>
  );
}

export function PatientBookingDetailGate(props: { bookingId: string; lang: string; paymentOutcome?: "success" | "cancelled" }) {
  const { ready, token } = useLocationToken({ hashKey: "t", legacyQueryKey: "t", storageKey: bookingTokenStorageKey(props.bookingId) });
  if (!ready) return <Pending />;
  return <PatientBookingDetailPanel bookingId={props.bookingId} accessToken={token ?? undefined} paymentOutcome={props.paymentOutcome} lang={props.lang} />;
}

export function PatientBookingInvoiceGate({ bookingId }: { bookingId: string }) {
  const { ready, token } = useLocationToken({ hashKey: "t", legacyQueryKey: "t", storageKey: bookingTokenStorageKey(bookingId) });
  if (!ready) return <Pending />;
  return <PatientBookingInvoicePanel bookingId={bookingId} accessToken={token ?? undefined} />;
}

export function ConsultationGate({ appointmentId }: { appointmentId: string }) {
  const { ready, token } = useLocationToken({ hashKey: "t", legacyQueryKey: "t", storageKey: consultationTokenStorageKey(appointmentId) });
  if (!ready) return <Pending />;
  return <ConsultationRoom appointmentId={appointmentId} accessToken={token ?? undefined} />;
}
