import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { isModuleEnabledServer } from "@/lib/api/server-modules";

/**
 * `.claude/architect-scope-telehealth-template.md` §9.7.7 KARAR K madde 3 — `/{lang}/patient/**`
 * panel DEĞİLDİR. `telehealth` modülü kapalıysa 404 — `(site)/doctors/layout.tsx` İLE AYNI desen.
 */
export default async function PatientPortalLayout({ children }: { children: ReactNode }) {
  const enabled = await isModuleEnabledServer("telehealth");
  if (!enabled) notFound();
  return <>{children}</>;
}
