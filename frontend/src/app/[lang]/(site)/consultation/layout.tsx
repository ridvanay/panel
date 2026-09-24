import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { isModuleEnabledServer } from "@/lib/api/server-modules";
import { EmergencyNoticeStrip } from "@/components/site/telehealth/emergency-notice";
import { resolveEmergencyNotice } from "@/lib/emergency-notice";
import { fetchTelehealthThemeServer } from "@/lib/api/server-telehealth";
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

  const [theme, dict] = await Promise.all([fetchTelehealthThemeServer(), getSiteDictionary(lang)]);
  const notice = resolveEmergencyNotice(theme, lang, dict.telehealth);

  return (
    <>
      {/* Görüşme ekranında şerit admin anahtarından BAĞIMSIZ, her zaman gösterilir (compliance
          koşulu — canlı görüşme sırasında uyarı kaldırılamaz). Metinler yine admin/sözlükten gelir. */}
      <EmergencyNoticeStrip
        summary={notice.summary}
        full={notice.full}
        showDetailsLabel={notice.showDetailsLabel}
        hideDetailsLabel={notice.hideDetailsLabel}
      />
      {children}
    </>
  );
}
