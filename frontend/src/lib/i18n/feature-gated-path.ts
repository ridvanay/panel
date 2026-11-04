import { LOCALE_SEGMENT_SOURCE } from "./locale-code";
import type { SiteFeatures } from "../site-features";

/**
 * Paket AK (K4) — panelden kapatılan özelliklerin adresleri proxy'de 302 ile yönlendirilir:
 *   findTreatmentEnabled=false        : `/{lang}/find-your-treatment`            → `/{lang}/specialties`
 *   bookConsultationCtaEnabled=false  : `/{lang}/book-consultation[/…]`         → `/{lang}/request`
 *     (`/book-consultation/manage` HARİÇ — mevcut randevuların yönetim bağlantısı çalışmaya devam eder; sorgu proxy'de korunur.)
 * Varsayılan dilin öneki düşer (tek atlama); kapalı/bilinmeyen dil öneki dil sayılmaz. Hedef yalnızca sabit iç yoldur
 * (istek yolundan türetilmez), yani aynı origin dışına çıkamaz.
 */
export type FeatureGatedKind = "find-treatment" | "book-consultation";

const FIND_PATTERN = new RegExp(`^(?:/(${LOCALE_SEGMENT_SOURCE}))?/find-your-treatment/?$`);
const BOOK_PATTERN = new RegExp(`^(?:/(${LOCALE_SEGMENT_SOURCE}))?/book-consultation(?:/.*)?$`);
const MANAGE_PATTERN = new RegExp(`^(?:/(?:${LOCALE_SEGMENT_SOURCE}))?/book-consultation/manage(?:/.*)?$`);

export interface FeatureGatedMatch {
  kind: FeatureGatedKind;
  /** İstekteki dil öneki (yoksa `null`). */
  locale: string | null;
}

/** Yol anahtarla kapatılabilen bir adres mi? (Ayarı yalnızca eşleşirse okumak için ucuz ön kontrol.) */
export function matchFeatureGatedPath(pathname: string, enabledLocaleCodes?: ReadonlySet<string>): FeatureGatedMatch | null {
  const find = FIND_PATTERN.exec(pathname);
  const book = find ? null : BOOK_PATTERN.exec(pathname);
  const match = find ?? book;
  if (!match) return null;
  if (book && MANAGE_PATTERN.test(pathname)) return null;
  const locale = match[1] ?? null;
  if (locale && enabledLocaleCodes && !enabledLocaleCodes.has(locale)) return null;
  return { kind: find ? "find-treatment" : "book-consultation", locale };
}

/** Özellik kapalıysa yönlendirme yolu (sorgusuz), değilse `null`. */
export function featureRedirectPath(match: FeatureGatedMatch, features: SiteFeatures, defaultLocaleCode: string): string | null {
  const enabled = match.kind === "find-treatment" ? features.findTreatmentEnabled : features.bookConsultationCtaEnabled;
  if (enabled) return null;
  const prefix = match.locale && match.locale !== defaultLocaleCode ? `/${match.locale}` : "";
  return `${prefix}${match.kind === "find-treatment" ? "/specialties" : "/request"}`;
}
