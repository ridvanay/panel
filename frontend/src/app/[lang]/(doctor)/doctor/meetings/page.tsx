import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DoctorPortalShell } from "@/components/site/telehealth/doctor-portal-shell";
import { MeetingsManager } from "@/components/meetings/meetings-manager";
import { EXTERNAL_MEETINGS_ENABLED } from "@/lib/feature-flags";

/** Paket AG İş 3 — `/{lang}/doctor/meetings`: harici görüntülü toplantılar (doktor portalı). `noindex` (`/doctor/**` ile aynı). */
export function generateMetadata(): Metadata {
  return { robots: { index: false, follow: false } };
}

export default function DoctorMeetingsPage() {
  // AI İş 3 hızlı sürüm: genel harici toplantı özelliği kapalıyken sayfa yoktur.
  if (!EXTERNAL_MEETINGS_ENABLED) notFound();
  return (
    <DoctorPortalShell>
      <MeetingsManager variant="doctor" />
    </DoctorPortalShell>
  );
}
