import type { CSSProperties, ReactNode } from "react";
import { notFound } from "next/navigation";
import { isModuleEnabledServer } from "@/lib/api/server-modules";
import { fetchTelehealthThemeServer } from "@/lib/api/server-telehealth";
import { EmergencyNoticeStrip } from "@/components/site/telehealth/emergency-notice";
import { getSiteDictionary } from "@/lib/i18n/site-dictionaries";

/**
 * Görev (2026-09-16) — `doctors/layout.tsx` İLE BİREBİR AYNI desen: `/specialties*` de
 * `telehealth` modülünün bir parçasıdır (`GET /specialties*` backend'de AYNI
 * `requireModuleEnabled("telehealth")` guard'ının arkasında, bkz. openapi.yaml). Modül kapalıyken
 * TÜM `/specialties/*` rotaları 404 döner, `.telehealth-scope` (`--primary`/`--secondary`
 * enjeksiyonu) İLE AYNI kapsam ve acil durum uyarı şeridi burada da render edilir — iki ayrı
 * tema/guard mantığı İCAT EDİLMEZ, `doctors/layout.tsx`'in AYNISI kopyalanır.
 */
export default async function SpecialtiesLayout({
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

  const telehealthScopeStyle = {
    "--telehealth-primary": theme.primaryColor,
    "--telehealth-secondary": theme.secondaryColor,
    "--telehealth-accent": theme.accentColor,
    "--telehealth-calendar-active-bg": theme.calendarActiveBg,
    "--primary": "var(--telehealth-primary)",
    "--secondary": "var(--telehealth-secondary)",
  } as unknown as CSSProperties;

  return (
    <div className="telehealth-scope" style={telehealthScopeStyle}>
      <EmergencyNoticeStrip text={dict.telehealth.emergencyNotice} />
      {children}
    </div>
  );
}
