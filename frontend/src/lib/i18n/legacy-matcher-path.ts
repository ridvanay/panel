import { LOCALE_SEGMENT_SOURCE } from "./locale-code";

/**
 * Paket AI (FE2) — "Find my physician" sihirbazı `/find-a-physician` adresinden `/find-your-treatment` adresine taşındı.
 * Proxy eski adres (ve dil önekli hâlleri) için 301 verir; sorgu dizesi proxy'de korunur. Varsayılan dilin öneki
 * düşer (tek atlama); kapalı/bilinmeyen dil öneki dil sayılmaz (yönlendirme yapılmaz). Hedef her zaman
 * `/find-your-treatment` ile başlar ve istek URL'sinin kopyasına yazılır, yani aynı origin dışına çıkamaz.
 */
const LEGACY_PATTERN = new RegExp(`^(?:/(${LOCALE_SEGMENT_SOURCE}))?/find-a-physician/?$`);

export function legacyFindTreatmentPath(pathname: string, defaultLocaleCode: string, enabledLocaleCodes?: ReadonlySet<string>): string | null {
  const match = LEGACY_PATTERN.exec(pathname);
  if (!match) return null;
  const [, locale] = match;
  if (locale && enabledLocaleCodes && !enabledLocaleCodes.has(locale)) return null;
  const prefix = locale && locale !== defaultLocaleCode ? `/${locale}` : "";
  return `${prefix}/find-your-treatment`;
}
