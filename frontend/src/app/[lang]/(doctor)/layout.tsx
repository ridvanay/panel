import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { fetchSiteSettingsServer } from "@/lib/api/server-settings";
import { fetchSiteAppearanceServer } from "@/lib/api/server-appearance";
import { fetchLocalesServer } from "@/lib/api/server-locales";
import { LocaleAlternatesProvider } from "@/context/locale-alternates-context";
import { SiteScope } from "@/components/site/site-scope";
import { DoctorPortalProvider } from "@/components/site/telehealth/doctor-portal-provider";
import { DoctorTopBar } from "@/components/site/telehealth/doctor-top-bar";

/**
 * `.claude/architect-scope-doctor-subdomain.md` §5 — hekim portalının (`/doctor/**`, `/doctor/login`)
 * KENDİ route grubu. `(site)/layout.tsx`'in `SiteHeader`/`SiteFooter`/`CartProvider`/
 * `WishlistProvider`/`CartDrawer`/`CookieConsentBanner`/`BackToTopButton`/`LanguageSwitcher`'ından
 * HİÇBİRİNİ SAĞLAMAZ (§5.3 sözleşmesi, bilinçli) — izolasyon YAPISALDIR, koşullu render DEĞİL;
 * `headers()` OKUNMAZ (bu, `(site)` grubunun ISR'ını (`revalidate: 60`) etkilemeyen ayrı bir ağaçtır).
 *
 * `DoctorPortalRouteGuard` BURAYA EKLENMEZ — o `(site)/layout.tsx`'te kalır (§5.3): burada
 * çalıştırılsaydı ("doktor hesabı `/doctor` DIŞINDaysa `/doctor`'a it") ters yönde bir döngü
 * üretirdi (biz zaten `/doctor` altındayız).
 *
 * `customCss`/`customJs` (§10.12.6) BİLEREK enjekte EDİLMEZ — site sahibinin vitrin için yazdığı
 * kod klinik veri gösteren bir operasyon aracını bozabilir (pazarlama yüzeyi özelliği, `(site)`
 * dışında anlamsız).
 */
export default async function DoctorScopeLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;

  // Bakım modu (§3.3) doktor host'unda proxy tarafından UYGULANMAZ; bu layout onu HİÇ sorgulamaz.
  const locales = await fetchLocalesServer();
  const activeLocale = locales.find((l) => l.code === lang);
  if (!activeLocale) notFound();
  const defaultLocaleCode = locales.find((l) => l.isDefault)?.code ?? activeLocale.code;

  const [settings, appearance] = await Promise.all([fetchSiteSettingsServer(), fetchSiteAppearanceServer()]);

  return (
    <LocaleAlternatesProvider activeLocaleCode={activeLocale.code} defaultLocaleCode={defaultLocaleCode}>
      <SiteScope appearance={appearance}>
        <DoctorPortalProvider>
          <DoctorTopBar siteName={settings.siteName} logoUrl={settings.logoUrl} logoHeight={settings.headerLogoHeight} />
          <main className="flex-1">{children}</main>
        </DoctorPortalProvider>
      </SiteScope>
    </LocaleAlternatesProvider>
  );
}
