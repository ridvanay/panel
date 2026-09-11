import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { isModuleEnabledServer } from "@/lib/api/server-modules";
import { EmergencyNoticeStrip } from "@/components/site/telehealth/emergency-notice";

/**
 * `telehealth` modülü kapalıysa TÜM `/doctors/*` rotaları 404 döner — backend'in
 * `requireModuleEnabled("telehealth")` guard'ıyla (bkz. telehealth.routes.ts) BİREBİR aynı davranış
 * (bkz. `(site)/products/layout.tsx` — AYNI patern). `.claude/design-notes-telehealth.md` §9.1 —
 * acil durum uyarı şeridi bu modülün TÜM public sayfalarında (kapatılamaz) gösterilir.
 */
export default async function DoctorsLayout({ children }: { children: ReactNode }) {
  const enabled = await isModuleEnabledServer("telehealth");
  if (!enabled) notFound();

  return (
    <>
      <EmergencyNoticeStrip />
      {children}
    </>
  );
}
