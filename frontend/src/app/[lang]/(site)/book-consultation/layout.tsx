import type { CSSProperties, ReactNode } from "react";
import { fetchTelehealthThemeServer } from "@/lib/api/server-telehealth";

/**
 * AI İş 3 — rezervasyon/yönetim sayfaları eski randevu sihirbazının takvim bileşenlerini kullanır; bu bileşenler
 * `.telehealth-scope` değişkenlerine (`--telehealth-calendar-active-bg`, `--telehealth-accent`, `--primary`) bağlıdır.
 * `specialties/layout.tsx` ile AYNI kapsam burada kurulur (modül kapısı ve acil durum şeridi OLMADAN: bu akış
 * telehealth modülünden bağımsızdır).
 */
export default async function BookConsultationLayout({ children }: { children: ReactNode }) {
  const theme = await fetchTelehealthThemeServer().catch(() => null);
  const style = theme
    ? ({
        "--telehealth-primary": theme.primaryColor,
        "--telehealth-secondary": theme.secondaryColor,
        "--telehealth-accent": theme.accentColor,
        "--telehealth-calendar-active-bg": theme.calendarActiveBg,
        "--primary": "var(--telehealth-primary)",
        "--secondary": "var(--telehealth-secondary)",
      } as unknown as CSSProperties)
    : undefined;
  return (
    <div className="telehealth-scope" style={style}>
      {children}
    </div>
  );
}
