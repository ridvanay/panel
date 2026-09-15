import type { Metadata } from "next";
import { PatientPortalShell } from "@/components/site/telehealth/patient-portal-shell";
import { PatientPrescriptionsPanel } from "@/components/site/telehealth/patient-prescriptions-panel";

/** `.claude/architect-scope-telehealth-template.md` §9.8.3 KARAR N — `/{lang}/patient/prescriptions` (oturum GEREKİR). */
export function generateMetadata(): Metadata {
  return { robots: { index: false, follow: false } };
}

export default function PatientPrescriptionsPage() {
  return (
    <PatientPortalShell>
      <PatientPrescriptionsPanel />
    </PatientPortalShell>
  );
}
