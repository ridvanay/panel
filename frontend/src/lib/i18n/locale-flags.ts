/**
 * Paket M (2026-10-23) — dil kodu → bayrak eşlemesi (TEK yer). Bayrak dosyaları `public/flags/4x3/`
 * altında, `lipis/flag-icons` v7.5.0'dan (MIT) değiştirilmeden kopyalanmıştır (bkz.
 * `public/flags/README.md`). Eşlemede olmayan dil için bayrak yerine dil kodu rozeti gösterilir.
 */
export const LOCALE_FLAG_COUNTRY: Readonly<Record<string, string>> = {
  tr: "tr",
  en: "gb",
  ar: "sa",
  ru: "ru",
  es: "es",
  de: "de",
  fr: "fr",
};

/** Bayrak dosyasının yolu; eşlemede yoksa `null` (kod rozeti gösterilir). Bölge alt etiketi yok sayılır. */
export function localeFlagSrc(code: string): string | null {
  const base = code.toLowerCase().split("-")[0] ?? "";
  const country = LOCALE_FLAG_COUNTRY[base];
  return country ? `/flags/4x3/${country}.svg` : null;
}
