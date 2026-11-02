/**
 * Paket AG İş 3 — misafir bağlantısının / davet e-postasının dili. Türkçe ziyaretçiye KAPALI (Paket AH): yalnızca 8 ziyaretçi dili.
 * Etiketler her dilin kendi adıdır (çeviri gerektirmez).
 */
export const GUEST_LOCALES: readonly { code: string; label: string }[] = [
  { code: "en", label: "English" },
  { code: "es", label: "Español" },
  { code: "de", label: "Deutsch" },
  { code: "fr", label: "Français" },
  { code: "ru", label: "Русский" },
  { code: "ro", label: "Română" },
  { code: "sr-latn", label: "Srpski" },
  { code: "ar", label: "العربية" },
];

/** Arayüz dili ziyaretçi dillerinden biriyse o, değilse (admin paneli = "tr") İngilizce. */
export function defaultGuestLocale(uiLang: string): string {
  return GUEST_LOCALES.some((l) => l.code === uiLang) ? uiLang : "en";
}
