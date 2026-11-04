import localFont from "next/font/local";

/**
 * `/about` sayfasının serif başlık fontu. `lib/site-settings/site-fonts.ts`'teki KAPALI `SiteFont`
 * listesine EKLENMEZ (o liste admin'in seçebildiği site geneli fontlardır, backend enum'una bağlı);
 * yalnızca bu sayfada yüklenir.
 *
 * Paket AL — Newsreader yerel dosyadan (next/font/local); latin + latin-ext ayrı yüz (unicode-range), `aboutSerifExt`
 * de AYNI sarmalayıcıya uygulanır ve CSS'te `var(--font-about-serif), var(--font-about-serif-ext)` olarak yazılır.
 *
 * `site-fonts.ts`'teki Turbopack notu burada da geçerli: `.variable` bir CSS custom property adı
 * DEĞİL, hash'li bir class döndürür — bu class `.about-page` sarmalayıcısına uygulanır, font ise
 * `globals.css`'te literal `var(--font-about-serif)` ile referans verilir.
 */
export const aboutSerif = localFont({
  src: [
    { path: "../../../fonts/newsreader/newsreader-latin-400-normal.woff2", weight: "400", style: "normal" },
  ],
  variable: "--font-about-serif",
  display: "swap",
  adjustFontFallback: false,
  declarations: [{ prop: "unicode-range", value: "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD" }],
});
export const aboutSerifExt = localFont({
  src: [
    { path: "../../../fonts/newsreader/newsreader-latin-ext-400-normal.woff2", weight: "400", style: "normal" },
  ],
  variable: "--font-about-serif-ext",
  display: "swap",
  preload: false,
  adjustFontFallback: "Times New Roman",
  declarations: [{ prop: "unicode-range", value: "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C4, U+2113, U+2C60-2C7F, U+A720-A7FF" }],
});
