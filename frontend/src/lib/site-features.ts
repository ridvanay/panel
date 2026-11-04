/**
 * Paket AK (K3/K4) — panelden açılıp kapanan site özellikleri. Varsayılan AÇIK: alan yoksa (eski backend,
 * ayar okunamadı, test literali) mevcut davranış korunur.
 */
export interface SiteFeatures {
  /** "Find your treatment" sihirbazı ve tüm giriş noktaları. */
  findTreatmentEnabled: boolean;
  /** "Book a consultation" giriş noktaları (rezervasyon sayfası dahil). */
  bookConsultationCtaEnabled: boolean;
}

export const DEFAULT_SITE_FEATURES: SiteFeatures = { findTreatmentEnabled: true, bookConsultationCtaEnabled: true };

export function resolveSiteFeatures(
  settings: { findTreatmentEnabled?: boolean | null; bookConsultationCtaEnabled?: boolean | null } | null | undefined,
): SiteFeatures {
  return {
    // Yalnızca açıkça `false` kapatır.
    findTreatmentEnabled: settings?.findTreatmentEnabled !== false,
    bookConsultationCtaEnabled: settings?.bookConsultationCtaEnabled !== false,
  };
}
