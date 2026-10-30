import { LEADING_LOCALE_SEGMENT } from "@/lib/i18n/locale-code";
/**
 * Paket N — ASLA takip edilmeyen yollar (dil öneki çıkarıldıktan sonra, segment bazlı). Backend
 * `modules/crm/crm.privacy.ts::CRM_ALWAYS_EXCLUDED_PATHS` ile AYNI liste (test metin olarak karşılaştırır);
 * sunucu da aynı kuralı ayrıca uygular (derinlemesine savunma).
 */
export const CRM_ALWAYS_EXCLUDED_PATHS = [
  "/admin",
  "/portal",
  "/hesabim",
  "/siparislerim",
  "/doctor",
  "/patient",
  // Paket AA — tercüman paneli/görüşme ekranı (backend `crm.privacy.ts` ile aynı).
  "/interpreter",
  "/consultation",
  "/checkout",
  "/cart",
  "/login",
  "/register",
  "/forgot-password",
  "/reset-password",
  "/verify-email",
  "/activate-account",
  "/2fa",
  "/invitations",
  "/dashboard",
] as const;

function stripLocale(path: string): string {
  const clean = path.split(/[?#]/)[0] || "/";
  const stripped = clean.replace(LEADING_LOCALE_SEGMENT, "");
  return stripped === "" ? "/" : stripped;
}

function matchesPrefix(path: string, prefix: string): boolean {
  const p = prefix.length > 1 ? prefix.replace(/\/+$/, "") : prefix;
  return path === p || path.startsWith(`${p}/`);
}

export function isCrmExcludedPath(path: string, extra: readonly string[] = []): boolean {
  const bare = stripLocale(path);
  const full = path.split(/[?#]/)[0] || "/";
  return [...CRM_ALWAYS_EXCLUDED_PATHS, ...extra].some((prefix) => matchesPrefix(bare, prefix) || matchesPrefix(full, prefix));
}
