import type { AdminLocale } from "./dictionaries";

/**
 * `AdminLocale` ("tr"/"en") → `Intl.*` biçimlendiricilerinin beklediği BCP-47 etiketi.
 * Panel arayüz dili (`adminLocale`) değiştiğinde tarih/sayı biçimlendirmesi de değişmelidir
 * (bkz. `.claude/architect-scope-i18n.md` §7.3 — `notification-center.tsx`'teki sabit `"tr-TR"`
 * örneği). Bu, İÇERİK dili (`Locale.code`, `?locale=`) ile KARIŞTIRILMAZ — bkz. §7.4.
 */
export const ADMIN_LOCALE_TO_INTL: Record<AdminLocale, string> = {
  tr: "tr-TR",
  en: "en-US",
};

export function toIntlLocale(adminLocale: AdminLocale): string {
  return ADMIN_LOCALE_TO_INTL[adminLocale];
}
