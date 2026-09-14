import type { Metadata } from "next";
import { DoctorPortalShell } from "@/components/site/telehealth/doctor-portal-shell";
import { DoctorProfilePanel } from "@/components/site/telehealth/doctor-profile-panel";

/** `.claude/architect-scope-telehealth-template.md` §9.7.7/§9.7.10 — `/{lang}/doctor/profile`. */
export function generateMetadata(): Metadata {
  return { robots: { index: false, follow: false } };
}

export default function DoctorProfilePage() {
  return (
    <DoctorPortalShell>
      <DoctorProfilePanel />
    </DoctorPortalShell>
  );
}
