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
  // Paket T
  ro: "ro",
  "sr-latn": "rs",
};

/** Bayrak dosyasının yolu; eşlemede yoksa `null` (kod rozeti gösterilir). Bölge alt etiketi yok sayılır. */
export function localeFlagSrc(code: string): string | null {
  const lower = code.toLowerCase();
  // Paket T — önce tam kod (`sr-latn` → `rs`), sonra yalnızca dil alt etiketi.
  const country = LOCALE_FLAG_COUNTRY[lower] ?? LOCALE_FLAG_COUNTRY[lower.split("-")[0] ?? ""];
  return country ? `/flags/4x3/${country}.svg` : null;
}
