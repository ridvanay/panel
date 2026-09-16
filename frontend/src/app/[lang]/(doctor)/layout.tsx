import type { Metadata } from "next";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { fetchSiteSettingsServer } from "@/lib/api/server-settings";
import { fetchSiteAppearanceServer } from "@/lib/api/server-appearance";
import { fetchLocalesServer } from "@/lib/api/server-locales";
import { LocaleAlternatesProvider } from "@/context/locale-alternates-context";
import { SiteScope } from "@/components/site/site-scope";
import { SiteBrandingProvider } from "@/context/site-branding-context";
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
 *
 * Görev (2026-09-16) — `doctor/login/page.tsx` (`AuthPageShell` üzerinden `useSiteBranding()`i
 * ZORUNLU kullanır) bu ağacın altında ama `(auth)/layout.tsx`'in DIŞINDA olduğu için
 * `SiteBrandingProvider` hiç sağlanmıyordu → "Çıkış Yap" sonrası `/doctor/login`e dönüşte hook
 * throw edip sayfa çöküyordu. Bu layout zaten `fetchSiteSettingsServer()`i çağırdığından
 * (`DoctorTopBar` için, satır ~47) YENİ BİR FETCH GEREKMEDİ — aynı `settings` `SiteBrandingProvider`e
 * de aktarıldı. En dışa sarmalandı ki hem `DoctorTopBar` hem `children` (dolayısıyla `doctor/login`
 * dahil ALT AĞAÇTAKİ HER SAYFA) context'e erişebilsin.
 */
export async function generateMetadata(): Promise<Metadata> {
  const settings = await fetchSiteSettingsServer();
  return { title: { absolute: `Doktor Paneli | ${settings.siteName}` } };
}

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
    <SiteBrandingProvider
      value={{
        siteName: settings.siteName,
        logoUrl: settings.logoUrl,
        tagline: settings.tagline,
        headerLogoHeight: settings.headerLogoHeight,
        headerLogoMaxWidth: settings.headerLogoMaxWidth,
      }}
    >
      <LocaleAlternatesProvider activeLocaleCode={activeLocale.code} defaultLocaleCode={defaultLocaleCode}>
        <SiteScope appearance={appearance}>
          <DoctorPortalProvider>
            <DoctorTopBar siteName={settings.siteName} logoUrl={settings.logoUrl} logoHeight={settings.headerLogoHeight} />
            <main className="flex-1">{children}</main>
          </DoctorPortalProvider>
        </SiteScope>
      </LocaleAlternatesProvider>
    </SiteBrandingProvider>
  );
}
