import type { ReactNode } from "react";
import { headers } from "next/headers";
import { fetchSiteSettingsServer } from "@/lib/api/server-settings";
import { fetchLocalesServer } from "@/lib/api/server-locales";
import { SiteBrandingProvider } from "@/context/site-branding-context";
import { LocaleAlternatesProvider } from "@/context/locale-alternates-context";

/**
 * Görev (2026-09-16) — `/login`, `/register`, `/forgot-password`, `/reset-password` ortak kabuğunda
 * (`AuthPageShell`) sabit (hardcoded) "SaaS Platform" metni kaldırıldı. Bu dört sayfa `"use client"`
 * (form state/hook kullanıyorlar) olduğundan `fetchSiteSettingsServer()`i (proje genelinde
 * site header/footer/JSON-LD/admin başlığının kullandığı AYNI kaynak, bkz. `admin/layout.tsx`)
 * doğrudan içlerinde ÇAĞIRAMAZLAR — bu SERVER Component burada TEK SEFER çağırıp sonucu
 * `SiteBrandingProvider` (bkz. `context/site-branding-context.tsx`) ile alt ağaca taşır.
 *
 * Paket O (2026-10-23) — bu ekranlar `[lang]` dışında olduğu için dil bilgisini URL'den alamaz. Dili
 * `proxy.ts` belirler (`next` öneki → dil çerezi → Accept-Language → varsayılan; bkz.
 * `lib/i18n/auth-locale.ts`) ve `x-active-locale` başlığına yazar; kök layout `<html lang/dir>`'i,
 * bu layout da metinlerin dilini (`LocaleAlternatesProvider` → `useAuthStrings`) bu değerden kurar.
 */
export default async function AuthLayout({ children }: { children: ReactNode }) {
  const [settings, locales, headerList] = await Promise.all([fetchSiteSettingsServer(), fetchLocalesServer(), headers()]);
  const defaultLocaleCode = locales.find((l) => l.isDefault)?.code ?? locales[0]?.code ?? "tr";
  const requested = headerList.get("x-active-locale");
  const activeLocaleCode = requested && locales.some((l) => l.code === requested) ? requested : defaultLocaleCode;

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
      <LocaleAlternatesProvider activeLocaleCode={activeLocaleCode} defaultLocaleCode={defaultLocaleCode}>
        {children}
      </LocaleAlternatesProvider>
    </SiteBrandingProvider>
  );
}
