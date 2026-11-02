/**
 * Paket AG (Is 2) - randevu bildirimi alicilari (SAF: DB/IO yok).
 *
 * `SiteSettings.bookingNotificationRecipients`:
 * - `null`  -> hic ayarlanmamis -> kodda varsayilan adres.
 * - `""`    -> admin bilerek bosaltti -> bildirim GITMEZ.
 * - dolu    -> virgulle ayrilmis adresler (trim, bos atilir, kucuk harf, tekrar atilir, en cok 10).
 */
export const DEFAULT_BOOKING_NOTIFICATION_RECIPIENT = "admin@wmhealthistanbul.com";
export const MAX_BOOKING_NOTIFICATION_RECIPIENTS = 10;

// `lib/branded-mail.ts::SINGLE_EMAIL` ile AYNI kural (virgul/kose parantez/sorgu yok).
const SINGLE_EMAIL = /^[^\s@,<>"';?]+@[^\s@,<>"';?]+\.[^\s@,<>"';?]+$/;

export type ParsedRecipients = { ok: true; list: string[] } | { ok: false; message: string; invalid: string[] };

export function parseBookingNotificationRecipients(raw: string): ParsedRecipients {
  const seen = new Set<string>();
  const list: string[] = [];
  const invalid: string[] = [];
  for (const part of raw.split(",")) {
    const address = part.trim().toLowerCase();
    if (!address) continue;
    if (!SINGLE_EMAIL.test(address) || address.length > 254) {
      invalid.push(address);
      continue;
    }
    if (seen.has(address)) continue;
    seen.add(address);
    list.push(address);
  }
  if (invalid.length > 0) {
    return { ok: false, invalid, message: `Geçersiz e-posta adresi: ${invalid.join(", ")}` };
  }
  if (list.length > MAX_BOOKING_NOTIFICATION_RECIPIENTS) {
    return { ok: false, invalid: [], message: `En fazla ${MAX_BOOKING_NOTIFICATION_RECIPIENTS} adres girilebilir.` };
  }
  return { ok: true, list };
}

/** Kayitli ham deger -> etkin alici listesi (`null` varsayilan, `""` bos). Bozuk kayit sessizce gecerli adreslere indirgenir. */
export function effectiveBookingNotificationRecipients(stored: string | null | undefined): string[] {
  if (stored === null || stored === undefined) return [DEFAULT_BOOKING_NOTIFICATION_RECIPIENT];
  const parsed = parseBookingNotificationRecipients(stored);
  if (parsed.ok) return parsed.list;
  const valid: string[] = [];
  for (const part of stored.split(",")) {
    const address = part.trim().toLowerCase();
    if (SINGLE_EMAIL.test(address) && !valid.includes(address)) valid.push(address);
  }
  return valid.slice(0, MAX_BOOKING_NOTIFICATION_RECIPIENTS);
}
