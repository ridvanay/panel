import type { Metadata } from "next";
import { PatientPortalShell } from "@/components/site/telehealth/patient-portal-shell";
import { PatientHeroPanel } from "@/components/site/telehealth/patient-hero-panel";

/**
 * `.claude/architect-scope-telehealth-template.md` §9.8.3 KARAR N — `/{lang}/patient` (Genel
 * Bakış, oturum GEREKİR). `.claude/design-notes-telehealth.md` §14.2 — bu sayfanın TEK içeriği
 * hero karttır (bu turda ek widget/liste TANIMLANMAZ).
 */
export function generateMetadata(): Metadata {
  return { robots: { index: false, follow: false } };
}

export default function PatientOverviewPage() {
  return (
    <PatientPortalShell>
      <PatientHeroPanel />
    </PatientPortalShell>
  );
}
