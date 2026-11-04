import type { ContactConsentLocale } from "@/lib/api/types";

/** Paket U (B1) — onay metinleri 9 dilde sunucudan; sayfa içeriği en/tr dışında sunucuda EN'e düşer. */
export const CONTACT_CONSENT_LOCALES: readonly ContactConsentLocale[] = ["en", "tr", "es", "de", "ar", "ru", "ro", "fr", "sr-latn"];

export function contactLocale(lang: string): ContactConsentLocale {
  return (CONTACT_CONSENT_LOCALES as readonly string[]).includes(lang) ? (lang as ContactConsentLocale) : "en";
}
