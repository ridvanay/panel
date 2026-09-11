/**
 * İÇERİK dili (`Locale.code`, `[lang]` route param'ı — ISO 639-1, ör. "tr"/"en"/"de") →
 * `Intl.*` biçimlendiricilerinin beklediği BCP-47 etiketi. `lib/i18n/intl-locale.ts`'teki
 * `ADMIN_LOCALE_TO_INTL` ile AYNI desen, ama KARIŞTIRILMAZ: o, panel arayüz dili (`AdminLocale`,
 * yalnızca "tr"/"en") içindir, bu ise ziyaretçi tarafı İÇERİK dilidir (`.claude/architect-scope-
 * i18n.md` §7.4 ayrımı) ve daha geniş bir dil kümesini (`doctor-card.tsx`'teki `languageNames`
 * ile AYNI 6 dil) kapsar.
 *
 * Haritada olmayan bir kod (ör. panelden sonradan eklenen yeni bir dil) için Intl'in kendisine
 * bırakılır — `Intl.NumberFormat`/`Intl.DateTimeFormat` salt dil alt etiketini (ör. `"pt"`) da
 * kabul eder, bölgesiz bir tag hata FIRLATMAZ.
 */
const CONTENT_LOCALE_TO_INTL: Record<string, string> = {
  tr: "tr-TR",
  en: "en-US",
  de: "de-DE",
  fr: "fr-FR",
  es: "es-ES",
  ar: "ar-SA",
};

export function contentLocaleToIntl(code: string): string {
  return CONTENT_LOCALE_TO_INTL[code] ?? code;
}
