/**
 * §10.16.7 İletişim formu — TEK (singleton) form, `SiteSettings`/`SiteAppearance` ile AYNI
 * `id = "singleton"` + lazy-upsert deseni.
 */
export const CONTACT_FORM_ID = "singleton";

/** `POST /contact/submissions` gövdesindeki `values` alanının serileştirilmiş üst boyutu (§10.16.9). */
export const CONTACT_SUBMISSION_VALUES_MAX_BYTES = 32 * 1024;

/** Üç sistem alanı — SİLİNEMEZ, `key`/`type` DEĞİŞTİRİLEMEZ (§10.16.7). */
export const CONTACT_SYSTEM_FIELD_KEYS = ["name", "email", "message"] as const;
