"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { DEFAULT_SITE_FEATURES, type SiteFeatures } from "@/lib/site-features";

/**
 * Paket AK — `(site)/layout.tsx` (sunucu, 60 sn) panel anahtarlarını istemci bileşenlerine taşır.
 * Provider yoksa (eski testler) ikisi de AÇIK → bugünkü davranış. `ServiceBookingProvider`'dan BAĞIMSIZDIR:
 * `bookConsultationCtaEnabled=false` ayrı ve öncelikli bir gizleme kapısıdır, `serviceBookingEnabled` mantığına dokunmaz.
 */
const SiteFeaturesContext = createContext<SiteFeatures>(DEFAULT_SITE_FEATURES);

export function SiteFeaturesProvider({ findTreatmentEnabled, bookConsultationCtaEnabled, children }: SiteFeatures & { children: ReactNode }) {
  const value = useMemo(() => ({ findTreatmentEnabled, bookConsultationCtaEnabled }), [findTreatmentEnabled, bookConsultationCtaEnabled]);
  return <SiteFeaturesContext.Provider value={value}>{children}</SiteFeaturesContext.Provider>;
}

export function useSiteFeatures(): SiteFeatures {
  return useContext(SiteFeaturesContext);
}

export function useFindTreatmentEnabled(): boolean {
  return useContext(SiteFeaturesContext).findTreatmentEnabled;
}

export function useBookConsultationCtaEnabled(): boolean {
  return useContext(SiteFeaturesContext).bookConsultationCtaEnabled;
}

/** Paket AK — yalnızca "Find your treatment" açıkken çocukları çizer (sunucu bileşenlerindeki kartları/kapları kapatmak için). */
export function FindTreatmentGate({ children }: { children: ReactNode }) {
  return useFindTreatmentEnabled() ? <>{children}</> : null;
}

/** Paket AK — yalnızca "Book a consultation" açıkken çocukları çizer. */
export function BookConsultationGate({ children }: { children: ReactNode }) {
  return useBookConsultationCtaEnabled() ? <>{children}</> : null;
}
