import { LOCALE_SEGMENT_SOURCE } from "./locale-code";

/**
 * Paket V (2026-10-30) — hekim listesi ve profilleri `/doctors` yerine `/physicians` altında.
 *
 * - `legacyPhysiciansPath`: eski adres (`/doctors`, `/doctors/<slug>`, dil önekli hâlleri) için yeni
 *   yol; proxy bununla 301 verir. Varsayılan dilin öneki (`/tr/doctors`) doğrudan öneksiz yola gider
 *   (tek atlama). Yalnızca tek segmentli slug kabul edilir; yol her zaman `/physicians` ile başlar ve
 *   istek URL'sinin kopyasına yazılır, yani yönlendirme aynı origin dışına çıkamaz.
 * - `canonicalSitePath`: yönetici panelinden girilmiş eski site içi bağlantıları (menü, CTA, blok
 *   bağlantısı) render anında yeni yola çevirir; böylece sayfa kaynağında `/doctors` kalmaz.
 */
const LEGACY_PATTERN = new RegExp(`^(?:/(${LOCALE_SEGMENT_SOURCE}))?/doctors(?:/([^/]+))?/?$`);

export function legacyPhysiciansPath(pathname: string, defaultLocaleCode: string, enabledLocaleCodes?: ReadonlySet<string>): string | null {
  const match = LEGACY_PATTERN.exec(pathname);
  if (!match) return null;
  const [, locale, slug] = match;
  // Kapalı/bilinmeyen dil öneki dil sayılmaz (proxy'nin genel kuralı) — yönlendirme yapılmaz.
  if (locale && enabledLocaleCodes && !enabledLocaleCodes.has(locale)) return null;
  const prefix = locale && locale !== defaultLocaleCode ? `/${locale}` : "";
  return `${prefix}/physicians${slug ? `/${slug}` : ""}`;
}

const LEGACY_LINK_PATTERN = /^\/doctors(?=$|[/?#])/;

export function canonicalSitePath(path: string): string {
  return path.replace(LEGACY_LINK_PATTERN, "/physicians");
}

/**
 * Menü/footer öğesi hekim listesine mi gidiyor (`/physicians`, eski `/doctors`; sorgu dizesi yok)?
 * Öyleyse etiketi sözlükteki `nav.consultPhysicians` olur — 9 dilde tutarlı "Consult Physicians".
 */
export function isPhysiciansListHref(href: string): boolean {
  return /^\/physicians\/?$/.test(canonicalSitePath(href.trim()));
}
