import { Newsreader } from "next/font/google";

/**
 * `/about` sayfasının serif başlık fontu. `lib/site-settings/site-fonts.ts`'teki KAPALI `SiteFont`
 * listesine EKLENMEZ (o liste admin'in seçebildiği site geneli fontlardır, backend enum'una bağlı);
 * yalnızca bu sayfada yüklenir.
 *
 * `site-fonts.ts`'teki Turbopack notu burada da geçerli: `.variable` bir CSS custom property adı
 * DEĞİL, hash'li bir class döndürür — bu class `.about-page` sarmalayıcısına uygulanır, font ise
 * `globals.css`'te literal `var(--font-about-serif)` ile referans verilir.
 */
export const aboutSerif = Newsreader({
  subsets: ["latin", "latin-ext"],
  weight: "400",
  variable: "--font-about-serif",
  display: "swap",
});
