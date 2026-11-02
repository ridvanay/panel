/**
 * Paket AG - "Randevu bildirimi alıcıları" alanı için istemci doğrulaması. Sunucu (backend
 * `lib/booking-notification-recipients.ts`) AYNI kuralı uygular ve nihai karar verir; bu yalnızca anında geri bildirimdir.
 */
export const DEFAULT_BOOKING_NOTIFICATION_RECIPIENT = "admin@wmhealthistanbul.com";
export const MAX_BOOKING_NOTIFICATION_RECIPIENTS = 10;

// Sıkılaştırılmış dot-atom (küçük harfe çevrilmiş adres): yerel kısım yalnız harf/rakam/_+- (nokta ayrımlı); : ( \ | % ! vb. reddedilir.
const SINGLE_EMAIL = /^[a-z0-9_+-]+(?:\.[a-z0-9_+-]+)*@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

export type RecipientsValidation = { ok: true; list: string[] } | { ok: false; message: string };

export function validateBookingRecipients(raw: string): RecipientsValidation {
  const seen = new Set<string>();
  const list: string[] = [];
  const invalid: string[] = [];
  for (const part of raw.split(",")) {
    const address = part.trim().toLowerCase();
    if (!address) continue;
    if (!SINGLE_EMAIL.test(address)) {
      invalid.push(address);
      continue;
    }
    if (!seen.has(address)) {
      seen.add(address);
      list.push(address);
    }
  }
  if (invalid.length > 0) return { ok: false, message: `Geçersiz e-posta adresi: ${invalid.join(", ")}` };
  if (list.length > MAX_BOOKING_NOTIFICATION_RECIPIENTS) {
    return { ok: false, message: `En fazla ${MAX_BOOKING_NOTIFICATION_RECIPIENTS} adres girilebilir.` };
  }
  return { ok: true, list };
}
