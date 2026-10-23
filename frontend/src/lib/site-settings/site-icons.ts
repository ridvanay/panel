import type { Metadata } from "next";
import type { SiteSettings } from "@/lib/api/types";

/**
 * Ayar boşken kullanılan varsayılan simgeler — `public/favicon.ico` + `public/apple-touch-icon.png`
 * (Paket O: Next.js'in varsayılan siyah üçgeni yerine WM monogramı, `public/icon.svg`'den üretildi).
 */
export const DEFAULT_FAVICON_PATH = "/favicon.ico";
export const DEFAULT_APPLE_TOUCH_ICON_PATH = "/apple-touch-icon.png";

/**
 * Tarayıcılar favicon'u çok agresif önbelleğe alır. URL'e, adresin KENDİSİNDEN türetilen kısa bir
 * sürüm parametresi eklenir: admin simgeyi değiştirince URL de değişir, tarayıcı yenisini çeker;
 * simge aynı kaldıkça URL sabittir (gereksiz yeniden indirme yok). FNV-1a (32 bit) — kriptografik
 * değil, yalnızca değişiklik tespiti.
 */
export function withIconVersion(url: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < url.length; i++) {
    hash ^= url.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  const version = (hash >>> 0).toString(36);
  return `${url}${url.includes("?") ? "&" : "?"}v=${version}`;
}

/**
 * `SiteSettings.faviconUrl` / `appleTouchIconUrl` → Next.js `metadata.icons`. Ayar boşsa varsayılan
 * simge. Apple touch icon ayrıca seçilmemişse favicon (ikisi de PNG), o da yoksa varsayılan
 * `apple-touch-icon.png` kullanılır. Paket O: TEK kaynak kök layout'tur (admin, giriş, site, doktor portalı aynı).
 */
export function buildSiteIconsMetadata(settings: Pick<SiteSettings, "faviconUrl" | "appleTouchIconUrl">): NonNullable<Metadata["icons"]> {
  const favicon = settings.faviconUrl?.trim() || null;
  const appleTouchIcon = settings.appleTouchIconUrl?.trim() || favicon;

  return {
    icon: favicon ? [{ url: withIconVersion(favicon), type: "image/png" }] : [{ url: withIconVersion(DEFAULT_FAVICON_PATH), sizes: "any" }],
    apple: [{ url: withIconVersion(appleTouchIcon ?? DEFAULT_APPLE_TOUCH_ICON_PATH), type: "image/png" }],
  };
}
