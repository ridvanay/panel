import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { isModuleEnabledServer } from "@/lib/api/server-modules";
import { EmergencyNoticeStrip } from "@/components/site/telehealth/emergency-notice";

/** `telehealth` modülü kapalıysa `/consultation/*` da 404 döner — bkz. `(site)/doctors/layout.tsx`. */
export default async function ConsultationLayout({ children }: { children: ReactNode }) {
  const enabled = await isModuleEnabledServer("telehealth");
  if (!enabled) notFound();

  return (
    <>
      <EmergencyNoticeStrip />
      {children}
    </>
  );
}
