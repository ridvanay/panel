import type { ReactNode } from "react";
import { fetchSiteSettingsServer } from "@/lib/api/server-settings";
import { SiteBrandingProvider } from "@/context/site-branding-context";

/**
 * `app/(auth)/layout.tsx` İLE BİREBİR AYNI desen (bkz. o dosyanın yorumu) — `AuthPageShell`
 * `useSiteBranding()`i ZORUNLU kılar (context YOKSA fırlatır) ve bu sayfa `(auth)` route
 * grubunun DIŞINDA (`[lang]/(site)/activate-account`, §8.2) olduğu için o grubun `SiteBrandingProvider`'ını
 * MİRAS ALMAZ. Bu sayfa `"use client"` olduğundan `fetchSiteSettingsServer()`i doğrudan
 * içinde ÇAĞIRAMAZ — bu SERVER Component (route-özel layout) TEK SEFER çağırıp sonucu taşır.
 */
export default async function ActivateAccountLayout({ children }: { children: ReactNode }) {
  const settings = await fetchSiteSettingsServer();

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
      {children}
    </SiteBrandingProvider>
  );
}
