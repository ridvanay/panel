import type { Metadata } from "next";
import { DoctorPortalShell } from "@/components/site/telehealth/doctor-portal-shell";
import { MeetingsManager } from "@/components/meetings/meetings-manager";

/** Paket AG İş 3 — `/{lang}/doctor/meetings`: harici görüntülü toplantılar (doktor portalı). `noindex` (`/doctor/**` ile aynı). */
export function generateMetadata(): Metadata {
  return { robots: { index: false, follow: false } };
}

export default function DoctorMeetingsPage() {
  return (
    <DoctorPortalShell>
      <MeetingsManager variant="doctor" />
    </DoctorPortalShell>
  );
}
