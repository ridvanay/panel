import type { Metadata } from "next";
import { PatientPortalShell } from "@/components/site/telehealth/patient-portal-shell";
import { PatientBookingsPanel } from "@/components/site/telehealth/patient-bookings-panel";

/**
 * `.claude/architect-scope-telehealth-template.md` §9.8.3 KARAR N — `/{lang}/patient/appointments`
 * (oturum GEREKİR). Bu sayfa `/{lang}/patient/bookings`in gövdesinin TAŞINDIĞI yerdir (eski rota
 * artık `patient/bookings/page.tsx`de kalıcı `permanentRedirect()` ile buraya yönlenir); `robots`
 * deseni o sayfadan AYNEN kopyalanmıştır (§9.7.10 seo-agent kuralı).
 */
export function generateMetadata(): Metadata {
  return { robots: { index: false, follow: false } };
}

export default function PatientAppointmentsPage() {
  return (
    <PatientPortalShell>
      <PatientBookingsPanel />
    </PatientPortalShell>
  );
}
