import { SITE_HOST, SITE_ORIGIN, isDoctorHostname } from "@/lib/doctor-host";
import { LOCALE_SEGMENT_SOURCE } from "@/lib/i18n/locale-code";

/**
 * Paket AJ (AJ-5) — doktor portalı ziyaretçiye kapalı. WM Health aracı kuruluştur, sitede doktor yoktur.
 * Doktor hesapları, verileri ve portal kodu SİLİNMEZ; yalnızca ziyaretçi yüzü yönlendirilir:
 *  - `doktor.<alan adı>` host'una gelen her (proxy kapsamındaki) istek -> ana sitenin kökü (301),
 *  - ana host'ta `/doctor/**` (dil önekli de) -> `/` (301).
 * `/admin`, `/dashboard`, `/api` proxy matcher'ının dışındadır; bu yönlendirme onları görmez, yani
 * yönetici paneli doktor alt alan adı altında da kırılmaz.
 *
 * Geri açmak için ortamda `DOCTOR_PORTAL_ENABLED=true` (eski §3.1 davranışı). Varsayılan: kapalı.
 */

const PORTAL_PATH_PATTERN = new RegExp(`^/(?:${LOCALE_SEGMENT_SOURCE}/)?doctor(?:/|$)`);
const PRODUCTION_DOCTOR_HOSTNAME = "doktor.wmhealthistanbul.com";
const PRODUCTION_SITE_ORIGIN = "https://wmhealthistanbul.com";

export function isDoctorPortalEnabled(): boolean {
  return process.env.DOCTOR_PORTAL_ENABLED === "true";
}

function hostnameOf(host: string): string {
  return host.split(":")[0]?.trim().toLowerCase() ?? "";
}

/** Env'deki doktor host'u, üretim alt alan adı ya da `doktor.<site host'u>` ise `true`. */
export function isDoctorSubdomainHost(host: string): boolean {
  const hostname = hostnameOf(host);
  if (!hostname) return false;
  if (isDoctorHostname(host)) return true;
  if (hostname === PRODUCTION_DOCTOR_HOSTNAME) return true;
  return SITE_HOST !== null && hostname === `doktor.${SITE_HOST}`;
}

function siteRootUrl(host: string): URL {
  const hostname = hostnameOf(host);
  // Üretim alt alan adı geldi ama site URL'si yerel/varsayılan ise açık üretim kökü kullanılır.
  if (hostname === PRODUCTION_DOCTOR_HOSTNAME && (SITE_HOST === null || SITE_HOST === "localhost" || SITE_HOST.endsWith(".localhost"))) {
    return new URL("/", PRODUCTION_SITE_ORIGIN);
  }
  // Hedef YALNIZCA env'den türeyen SITE_ORIGIN'dir; Host başlığından değil (açık yönlendirme yok).
  return new URL("/", SITE_ORIGIN);
}

/** Yönlendirme gerekiyorsa mutlak hedef URL'yi, gerekmiyorsa `null` döner. */
export function doctorPortalRetiredRedirect(host: string, pathname: string): URL | null {
  if (isDoctorPortalEnabled()) return null;
  if (isDoctorSubdomainHost(host)) return siteRootUrl(host);
  if (PORTAL_PATH_PATTERN.test(pathname)) return new URL("/", SITE_ORIGIN);
  return null;
}
