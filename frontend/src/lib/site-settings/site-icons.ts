import type { Metadata } from "next";
import type { SiteSettings } from "@/lib/api/types";

/** Ayar boşken kullanılan varsayılan simge — `public/favicon.ico` (tüm yüzeyler, admin dahil). */
export const DEFAULT_FAVICON_PATH = "/favicon.ico";

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
 * simge. Apple touch icon ayrıca seçilmemişse favicon (ikisi de PNG) kullanılır; ikisi de yoksa
 * `apple-touch-icon` etiketi hiç üretilmez (iOS kendi ekran görüntüsünü kullanır — bugünkü davranış).
 */
export function buildSiteIconsMetadata(settings: Pick<SiteSettings, "faviconUrl" | "appleTouchIconUrl">): NonNullable<Metadata["icons"]> {
  const favicon = settings.faviconUrl?.trim() || null;
  const appleTouchIcon = settings.appleTouchIconUrl?.trim() || favicon;

  return {
    icon: favicon ? [{ url: withIconVersion(favicon), type: "image/png" }] : [{ url: DEFAULT_FAVICON_PATH, sizes: "any" }],
    ...(appleTouchIcon ? { apple: [{ url: withIconVersion(appleTouchIcon), type: "image/png" }] } : {}),
  };
}
