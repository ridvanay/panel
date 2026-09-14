import type { CSSProperties, ReactNode } from "react";
import { notFound } from "next/navigation";
import { isModuleEnabledServer } from "@/lib/api/server-modules";
import { fetchTelehealthThemeServer } from "@/lib/api/server-telehealth";
import { EmergencyNoticeStrip } from "@/components/site/telehealth/emergency-notice";

/**
 * `telehealth` modülü kapalıysa TÜM `/doctors/*` rotaları 404 döner — backend'in
 * `requireModuleEnabled("telehealth")` guard'ıyla (bkz. telehealth.routes.ts) BİREBİR aynı davranış
 * (bkz. `(site)/products/layout.tsx` — AYNI patern). `.claude/design-notes-telehealth.md` §9.1 —
 * acil durum uyarı şeridi bu modülün TÜM public sayfalarında (kapatılamaz) gösterilir.
 *
 * Görev (2026-09-14) Görev 2 — `.telehealth-scope` sarmalayıcısı, `(site)/layout.tsx`'teki
 * `.site-scope` cascade TEKNİĞİNİN AYNISI (satır-içi `style` ile CSS custom property enjeksiyonu),
 * ama DAHA DAR bir alt-ağaçta (`.site-scope`'un İÇİNDE, yalnızca `/doctors/*`). `--primary`/
 * `--secondary`'yi burada YENİDEN TANIMLAMAK, `bg-primary`/`text-primary`/`border-primary` gibi
 * TÜM mevcut Tailwind sınıflarının (stepper "tamamlandı" durumu, "Devam Et" butonu vb.) OTOMATİK
 * olarak randevu sihirbazının tema rengini almasını sağlar — o bileşenlere AYRICA dokunulmaz.
 */
export default async function DoctorsLayout({ children }: { children: ReactNode }) {
  const enabled = await isModuleEnabledServer("telehealth");
  if (!enabled) notFound();

  const theme = await fetchTelehealthThemeServer();

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
      <EmergencyNoticeStrip />
      {children}
    </div>
  );
}
