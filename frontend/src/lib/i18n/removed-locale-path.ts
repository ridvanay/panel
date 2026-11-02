/**
 * Paket AH — Türkçe ziyaretçiye kapatıldı (`enabled=false`). Eski `/tr` ve `/tr/*` adresleri 404 yerine
 * kalıcı olarak (301) varsayılan dildeki karşılığına yönlenir. Varsayılan dil önek almaz (`/tr/about` → `/about`).
 * Yalnızca Türkçe slug'ı olan içerik için proxy slug'ı bilmez: hedef sayfada `redirectToCanonicalSlug` ile
 * EN slug'ına çözülür (iki adım, ikisi de kalıcı).
 *
 * Yalnızca KAPALI dil öneki yönlendirilir (Türkçe yeniden açılırsa kural kendiliğinden devre dışı kalır);
 * dönen yol her zaman tek `/` ile başlar ve istek URL'sinin kopyasına yazılır, yani aynı origin dışına çıkamaz.
 */
export const REMOVED_VISITOR_LOCALE = "tr";

const REMOVED_PATTERN = new RegExp(`^/${REMOVED_VISITOR_LOCALE}(?=/|$)`);

export function removedLocaleRedirectPath(pathname: string, enabledLocaleCodes: ReadonlySet<string>): string | null {
  if (enabledLocaleCodes.has(REMOVED_VISITOR_LOCALE)) return null;
  if (!REMOVED_PATTERN.test(pathname)) return null;
  const rest = pathname.slice(REMOVED_VISITOR_LOCALE.length + 1);
  // `/tr//evil.example` gibi protokol-göreli çözümlemeye açılan yollar tek `/`'a indirgenir.
  return `/${rest.replace(/^\/+/, "")}`;
}
