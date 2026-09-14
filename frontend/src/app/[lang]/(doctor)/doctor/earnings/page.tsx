import type { Metadata } from "next";
import { DoctorPortalShell } from "@/components/site/telehealth/doctor-portal-shell";
import { DoctorEarningsPanel } from "@/components/site/telehealth/doctor-earnings-panel";

/**
 * `.claude/architect-scope-telehealth-template.md` §9.7.7/§9.7.10 + `.claude/design-notes-
 * telehealth.md` §13.5 — `/{lang}/doctor/earnings` (Kazançlarım). `noindex, nofollow` —
 * `/doctor/**` İLE AYNI desen (`/doctor/page.tsx`), sitemap'e GİRMEZ.
 */
export function generateMetadata(): Metadata {
  return { robots: { index: false, follow: false } };
}

export default function DoctorEarningsPage() {
  return (
    <DoctorPortalShell>
      <DoctorEarningsPanel />
    </DoctorPortalShell>
  );
}
