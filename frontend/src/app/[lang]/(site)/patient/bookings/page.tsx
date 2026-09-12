import type { Metadata } from "next";
import { PatientPortalShell } from "@/components/site/telehealth/patient-portal-shell";
import { PatientBookingsPanel } from "@/components/site/telehealth/patient-bookings-panel";

/** `.claude/architect-scope-telehealth-template.md` §9.7.10 — `/{lang}/patient/bookings` (oturum GEREKİR). */
export function generateMetadata(): Metadata {
  return { robots: { index: false, follow: false } };
}

export default function PatientBookingsPage() {
  return (
    <PatientPortalShell>
      <PatientBookingsPanel />
    </PatientPortalShell>
  );
}
