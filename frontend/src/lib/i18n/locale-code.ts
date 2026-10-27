/**
 * Paket T (2026-10-27) — site dil kodları artık yalnızca iki harfli değil: `sr-latn` (Sırpça, Latin
 * alfabesi) gibi dil + yazı sistemi alt etiketli kodlar da var. URL önekini tanıyan bütün desenler
 * bu kaynaktan türetilir (proxy, portal yönlendirme korumaları, CRM yol temizleme, noindex başlıkları).
 *
 * Biçim: `xx` ya da `xx-yyyy` (küçük harf; ISO 639-1 + isteğe bağlı ISO 15924 yazı sistemi).
 */
export const LOCALE_SEGMENT_SOURCE = "[a-z]{2}(?:-[a-z]{4})?";

/** Yolun başındaki dil öneki (`/tr`, `/sr-latn`) — `(?=\/|$)` ile segment sınırında. */
export const LEADING_LOCALE_SEGMENT = new RegExp(`^/${LOCALE_SEGMENT_SOURCE}(?=/|$)`);

/** Yol `/xx/...` ya da `/xx-yyyy/...` dil önekiyle başlıyor mu? */
export function hasLocalePrefix(path: string): boolean {
  return new RegExp(`^/${LOCALE_SEGMENT_SOURCE}(/|$|\\?|#)`).test(path);
}

/**
 * `Accept-Language` etiketini açık site dillerinden birine eşler: tam etiket (`sr-latn-rs` → `sr-latn`
 * değil, önce tamamı), dil + yazı sistemi (`sr-latn`), yalnızca dil (`sr`). Sırpça için sitede yalnızca
 * Latin sürümü olduğundan `sr`/`sr-rs`/`sr-cyrl` istekleri de `sr-latn`'e düşer (Kiril sürüm yok).
 */
export function matchLocaleTag(tag: string, enabledCodes: readonly string[]): string | null {
  const parts = tag.trim().toLowerCase().split(/[-_]/).filter(Boolean);
  if (parts.length === 0) return null;
  const candidates = [parts.join("-"), parts.slice(0, 2).join("-"), parts[0]!];
  if (parts[0] === "sr") candidates.push("sr-latn");
  return candidates.find((c) => enabledCodes.includes(c)) ?? null;
}
