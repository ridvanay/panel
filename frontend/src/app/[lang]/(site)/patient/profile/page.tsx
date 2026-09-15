import type { Metadata } from "next";
import { PatientPortalShell } from "@/components/site/telehealth/patient-portal-shell";
import { PatientProfilePanel } from "@/components/site/telehealth/patient-profile-panel";

/** `.claude/architect-scope-telehealth-template.md` §9.8.3 KARAR N — `/{lang}/patient/profile` (oturum GEREKİR). */
export function generateMetadata(): Metadata {
  return { robots: { index: false, follow: false } };
}

export default function PatientProfilePage() {
  return (
    <PatientPortalShell>
      <PatientProfilePanel />
    </PatientPortalShell>
  );
}
