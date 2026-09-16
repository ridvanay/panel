import type { ReactNode } from "react";
import { fetchSiteSettingsServer } from "@/lib/api/server-settings";
import { SiteBrandingProvider } from "@/context/site-branding-context";

/**
 * Görev (2026-09-16) — `/login`, `/register`, `/forgot-password`, `/reset-password` ortak kabuğunda
 * (`AuthPageShell`) sabit (hardcoded) "SaaS Platform" metni kaldırıldı. Bu dört sayfa `"use client"`
 * (form state/hook kullanıyorlar) olduğundan `fetchSiteSettingsServer()`i (proje genelinde
 * site header/footer/JSON-LD/admin başlığının kullandığı AYNI kaynak, bkz. `admin/layout.tsx`)
 * doğrudan içlerinde ÇAĞIRAMAZLAR — bu SERVER Component burada TEK SEFER çağırıp sonucu
 * `SiteBrandingProvider` (bkz. `context/site-branding-context.tsx`) ile alt ağaca taşır.
 */
export default async function AuthLayout({ children }: { children: ReactNode }) {
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
