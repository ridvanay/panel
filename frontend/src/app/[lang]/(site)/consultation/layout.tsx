import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { isModuleEnabledServer } from "@/lib/api/server-modules";
import { EmergencyNoticeStrip } from "@/components/site/telehealth/emergency-notice";
import { getSiteDictionary } from "@/lib/i18n/site-dictionaries";

/**
 * `telehealth` modülü kapalıysa `/consultation/*` da 404 döner — bkz. `(site)/doctors/layout.tsx`.
 * `.claude/architect-scope-i18n.md` §14.5 Faz 2 kapsamındadır (booking/consultation akışı) — bu
 * dosyanın GERİ KALANI BİLİNÇLİ OLARAK dokunulmadı; `lang`/`dict` eklentisi SADECE
 * `EmergencyNoticeStrip`'in Faz 1'de zorunlu hale gelen `text` prop'unu karşılamak içindir.
 */
export default async function ConsultationLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  const enabled = await isModuleEnabledServer("telehealth");
  if (!enabled) notFound();

  const dict = await getSiteDictionary(lang);

  return (
    <>
      <EmergencyNoticeStrip text={dict.telehealth.emergencyNotice} />
      {children}
    </>
  );
}
