import type { Metadata } from "next";
import { PatientPortalShell } from "@/components/site/telehealth/patient-portal-shell";
import { PatientDocumentsPanel } from "@/components/site/telehealth/patient-documents-panel";

/** `.claude/architect-scope-telehealth-template.md` §9.8.3 KARAR N — `/{lang}/patient/documents` (oturum GEREKİR). */
export function generateMetadata(): Metadata {
  return { robots: { index: false, follow: false } };
}

export default function PatientDocumentsPage() {
  return (
    <PatientPortalShell>
      <PatientDocumentsPanel />
    </PatientPortalShell>
  );
}
