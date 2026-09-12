import type { Metadata } from "next";
import { DoctorPortalShell } from "@/components/site/telehealth/doctor-portal-shell";
import { DoctorBookingsPanel } from "@/components/site/telehealth/doctor-bookings-panel";

/**
 * `.claude/architect-scope-telehealth-template.md` §9.7.7/§9.7.10 — `/{lang}/doctor` (Randevularım).
 * `noindex, nofollow` — seo-agent kararı (§9.7.9: "`/doctor/**`, `/patient/**` ve ödeme dönüş
 * sayfaları `noindex`; sitemap'e GİRMEZ"), `/consultation/[id]` İLE AYNI desen.
 */
export function generateMetadata(): Metadata {
  return { robots: { index: false, follow: false } };
}

export default function DoctorBookingsPage() {
  return (
    <DoctorPortalShell>
      <DoctorBookingsPanel />
    </DoctorPortalShell>
  );
}
