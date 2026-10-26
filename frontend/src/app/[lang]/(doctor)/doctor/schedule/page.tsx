import type { Metadata } from "next";
import { DoctorPortalShell } from "@/components/site/telehealth/doctor-portal-shell";
import { DoctorSchedulePanel } from "@/components/site/telehealth/doctor-schedule-panel";

/** Paket P (İş 2) — `/{lang}/doctor/schedule`: haftalık çalışma saatleri + izinler (tek ekran). */
export function generateMetadata(): Metadata {
  return { robots: { index: false, follow: false } };
}

export default function DoctorSchedulePage() {
  return (
    <DoctorPortalShell>
      <DoctorSchedulePanel />
    </DoctorPortalShell>
  );
}
