"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { SiteSettings } from "@/lib/api/types";

export type SiteBrandingValue = Pick<
  SiteSettings,
  "siteName" | "logoUrl" | "tagline" | "headerLogoHeight" | "headerLogoMaxWidth"
>;

const SiteBrandingContext = createContext<SiteBrandingValue | null>(null);

/**
 * `app/(auth)/layout.tsx` (server) → `fetchSiteSettingsServer()` sonucunu BURADAN
 * `/login`, `/register`, `/forgot-password`, `/reset-password` sayfalarına (hepsi `"use client"`,
 * kendi form state'lerini taşıdığı için server component'e ÇEVRİLEMEZ) taşır. Next.js layout'lar
 * `children`e prop enjekte EDEMEZ (bkz. `node_modules/next/dist/docs`) — bu yüzden `accent-context.tsx`
 * ile AYNI basit context deseni kullanılıyor. Sadece marka alanlarını (site adı/logo/slogan) taşır,
 * admin'in `AccentProvider`/`I18nProvider`'ı gibi genel bir "site ayarları" context'i DEĞİLDİR.
 */
export function SiteBrandingProvider({ value, children }: { value: SiteBrandingValue; children: ReactNode }) {
  return <SiteBrandingContext value={value}>{children}</SiteBrandingContext>;
}

export function useSiteBranding(): SiteBrandingValue {
  const ctx = useContext(SiteBrandingContext);
  if (!ctx) throw new Error("useSiteBranding, <SiteBrandingProvider> içinde kullanılmalıdır.");
  return ctx;
}
