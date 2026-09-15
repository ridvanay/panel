import type { Metadata } from "next";
import { PatientPortalShell } from "@/components/site/telehealth/patient-portal-shell";
import { PatientPaymentsPanel } from "@/components/site/telehealth/patient-payments-panel";

/** `.claude/architect-scope-telehealth-template.md` §9.8.3 — `/{lang}/patient/payments` (oturum GEREKİR). */
export function generateMetadata(): Metadata {
  return { robots: { index: false, follow: false } };
}

export default function PatientPaymentsPage() {
  return (
    <PatientPortalShell>
      <PatientPaymentsPanel />
    </PatientPortalShell>
  );
}
