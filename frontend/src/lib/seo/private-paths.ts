/**
 * Paket S — giriş gerektiren / kişiye özel alanlar (TEK liste). Hem `robots.txt` (`Disallow`) hem
 * `next.config.ts` (`X-Robots-Tag: noindex, nofollow`) bundan üretilir. robots.txt bir güvenlik
 * önlemi DEĞİLDİR — bu sayfaların indekslenmemesini asıl sağlayan `noindex`tir.
 *
 * `/doctor/` SONDAKİ eğik çizgiyle yazılır: robots.txt eşleşmesi ön ek karşılaştırmasıdır;
 * `/doctor` (eğik çizgisiz) herkese açık `/doctors/...` profillerini de engellerdi. Sonu eğik
 * çizgisiz yollar robots.txt'de `yol$` (tam) + `yol/` (alt yollar) olarak yazılır ki `/cart`
 * kuralı `/cartilage-...` gibi herkese açık bir CMS sayfasını engellemesin (inceleme bulgusu).
 */

/** robots.txt satırları: `/x/` olduğu gibi; `/x` → `/x$` (tam), `/x/` (alt yollar), `/x?` (sorgu dizeli, ör. `/reset-password?token=`). */
export function robotsPatterns(path: string): string[] {
  return path.endsWith("/") ? [path] : [`${path}$`, `${path}/`, `${path}?`];
}

/** Dil öneki almayan özel yollar (kök seviyesinde). */
export const ROOT_PRIVATE_PATHS = [
  "/admin",
  "/dashboard",
  "/api/",
  "/invitations",
  "/login",
  "/register",
  "/forgot-password",
  "/reset-password",
  "/verify-email",
] as const;

/** Dil öneki alabilen özel yollar (`/patient/` ve `/tr/patient/` gibi). */
export const LOCALIZED_PRIVATE_PATHS = [
  "/patient/",
  "/doctor/",
  "/consultation/",
  "/checkout",
  "/cart",
  "/hesabim",
  "/siparislerim",
  "/activate-account",
] as const;

/** `next.config.ts::headers()` kaynakları — dil önekli ve öneksiz hâller. */
export function noindexHeaderSources(): string[] {
  const sources: string[] = [];
  const toSource = (path: string) => {
    const base = path.replace(/\/$/, "");
    return [base, `${base}/:path*`];
  };
  for (const path of ROOT_PRIVATE_PATHS) {
    if (path === "/api/") continue; // frontend'in kendi /api rotaları (health/revalidate) sayfa değil
    sources.push(...toSource(path));
  }
  for (const path of LOCALIZED_PRIVATE_PATHS) {
    for (const source of toSource(path)) {
      sources.push(source, `/:lang([a-z]{2})${source}`);
    }
  }
  return sources;
}
