import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { isModuleEnabledServer } from "@/lib/api/server-modules";

/**
 * `.claude/architect-scope-telehealth-template.md` §9.7.7 KARAR K madde 3 — `/{lang}/doctor/**`
 * panel DEĞİLDİR (doktor bir admin kullanıcısı değildir), `/admin/telehealth/*`'ten TAMAMEN AYRIDIR.
 * `telehealth` modülü kapalıysa 404 — `(site)/doctors/layout.tsx` İLE AYNI desen. `noindex` her
 * sayfanın kendi `generateMetadata`'sında ayrıca uygulanır (seo-agent kararı, §9.7.9).
 */
export default async function DoctorPortalLayout({ children }: { children: ReactNode }) {
  const enabled = await isModuleEnabledServer("telehealth");
  if (!enabled) notFound();
  return <>{children}</>;
}
