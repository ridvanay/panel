import { isSafeInternalPath } from "@/lib/safe-redirect";
import { hasLocalePrefix, matchLocaleTag } from "@/lib/i18n/locale-code";

/**
 * Paket O (2026-10-23) — `[lang]` dışında kalan giriş/kayıt/şifre/doğrulama ekranlarının dili.
 *
 * Öncelik:
 *   1. `next` parametresindeki dil öneki (`/ru/doctors/x` → `ru`) — yalnızca güvenli site-içi yolsa
 *   2. sitenin dil çerezi (`wm-locale`, site sayfaları gezildikçe proxy yazar)
 *   3. `Accept-Language` başlığı (q değerlerine göre, birincil alt etiket)
 *   4. varsayılan dil
 * Yalnızca AÇIK (`enabled`) diller kabul edilir; kapalı ya da bilinmeyen kod bir sonraki adıma düşer.
 */
export const SITE_LOCALE_COOKIE = "wm-locale";
export const SITE_LOCALE_COOKIE_MAX_AGE = 365 * 24 * 60 * 60;

export interface AuthLocaleInput {
  next: string | null | undefined;
  cookie: string | null | undefined;
  acceptLanguage: string | null | undefined;
  enabledCodes: readonly string[];
  defaultCode: string;
}

export function localeFromPath(path: string | null | undefined, enabledCodes: readonly string[]): string | null {
  if (!isSafeInternalPath(path)) return null;
  const first = path.split(/[?#]/)[0]!.split("/")[1]?.toLowerCase() ?? "";
  return enabledCodes.includes(first) ? first : null;
}

export function localeFromAcceptLanguage(header: string | null | undefined, enabledCodes: readonly string[]): string | null {
  if (!header) return null;
  const ranked = header
    .split(",")
    .map((part, index) => {
      const [tag = "", ...params] = part.trim().split(";");
      const q = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
      const quality = q ? Number(q.slice(2)) : 1;
      // Paket T — tam etiket korunur (`sr-Latn-RS`); eşleme `matchLocaleTag` ile (tireli kodlar dahil).
      return { tag: tag.trim(), quality: Number.isFinite(quality) ? quality : 0, index };
    })
    .filter((entry) => entry.tag && entry.tag !== "*" && entry.quality > 0)
    .sort((a, b) => b.quality - a.quality || a.index - b.index);
  for (const entry of ranked) {
    const code = matchLocaleTag(entry.tag, enabledCodes);
    if (code) return code;
  }
  return null;
}

export function resolveAuthLocale(input: AuthLocaleInput): string {
  const cookie = input.cookie?.trim().toLowerCase();
  return (
    localeFromPath(input.next, input.enabledCodes) ??
    (cookie && input.enabledCodes.includes(cookie) ? cookie : null) ??
    localeFromAcceptLanguage(input.acceptLanguage, input.enabledCodes) ??
    input.defaultCode
  );
}

/**
 * Giriş sonrası hedef dil önekini korusun: site içi, öneksiz bir hedef (ör. hasta varsayılanı
 * `/patient/appointments`) varsayılan dil dışındaki bir dilde `/ru/patient/appointments` olur. Admin,
 * doktor portalı ve `/dashboard` tek dillidir — dokunulmaz. Zaten önekli hedef aynen kalır.
 */
export function localizeDestination(path: string, lang: string, defaultCode: string): string {
  if (!isSafeInternalPath(path) || lang === defaultCode) return path;
  if (/^\/(admin|doctor|dashboard|api)(\/|$|\?)/.test(path)) return path;
  // Zaten bir dil önekiyle başlıyorsa (`/ru/...`, `/sr-latn/...`) olduğu gibi kalır.
  if (hasLocalePrefix(path)) return path;
  return path === "/" ? `/${lang}` : `/${lang}${path}`;
}
