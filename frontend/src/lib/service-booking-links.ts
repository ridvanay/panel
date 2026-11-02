/**
 * AI İş 3 — "Book a consultation" düğmelerinin hedefi. Rezervasyon açıkken `/book-consultation[?service|package]`,
 * kapalıyken mevcut talep formu (`/request[…]`). Yollar dil önekizdir (çağıran `localize` eder).
 */
export const BOOK_CONSULTATION_ROUTE = "/book-consultation";
export const BOOK_CONSULTATION_MANAGE_ROUTE = "/book-consultation/manage";

export interface ServiceLinkParams {
  service?: string | null;
  pkg?: string | null;
}

function query(params?: ServiceLinkParams): string {
  const qs = new URLSearchParams();
  if (params?.service) qs.set("service", params.service);
  if (params?.pkg) qs.set("package", params.pkg);
  const text = qs.toString();
  return text ? `?${text}` : "";
}

/** Rezervasyon sayfasının yolu. */
export function bookingPath(params?: ServiceLinkParams): string {
  return `${BOOK_CONSULTATION_ROUTE}${query(params)}`;
}

/** Talep formunun yolu (ikincil "Request a call back" seçeneği ve rezervasyon kapalıyken birincil düğme). */
export function callbackPath(params?: ServiceLinkParams): string {
  return `/request${query(params)}`;
}

/** Birincil "Book a consultation" düğmesi: `enabled` ise rezervasyon, değilse talep formu. */
export function primaryBookPath(enabled: boolean, params?: ServiceLinkParams): string {
  return enabled ? bookingPath(params) : callbackPath(params);
}
