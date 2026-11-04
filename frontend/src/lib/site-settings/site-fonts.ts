import localFont from "next/font/local";
import type { SiteFont } from "@/lib/api/types";

/**
 * Paket AL — Fontlar artık `next/font/local` ile `src/fonts/` altındaki woff2 dosyalarından yüklenir (build'de Google Fonts
 * indirmesi YOK; OFL lisansları `public/fonts/LICENSES/`). Google'ın alt küme bölünmesi korunur: her aile için `latin` yüzü
 * (`--font-site-xxx`) + `latin-ext` yüzü (`--font-site-xxx-ext`, `preload: false`) ayrı `@font-face` + `unicode-range` ile
 * tanımlanır; `SITE_FONT_FAMILY` ikisini `font-family` listesinde sırayla verir. `latin` yüzünde `adjustFontFallback: false`
 * (aksi halde fallback yüzü listede ilk sırada tüm karakterleri yutar ve `-ext` yüzüne hiç geçilmezdi); boyut-ayarlı fallback
 * `-ext` yüzünden gelir ve listenin sonunda durur.
 *
 * §10.12.3 — `SiteFont` KAPALI bir enum'dur (teknik zorunluluk: `next/font/local` font adının
 * DERLEME ZAMANINDA bilinmesini gerektirir). Bu modül TEK bir kaynak: hem `(site)/layout.tsx`
 * (gerçek ziyaretçi sitesi) hem de `/admin/appearance` sayfasının canlı önizlemesi AYNI font
 * setini/değişken adlarını kullanır — design-notes-appearance-panel.md §7'nin "gerçek font
 * yalnızca canlı önizleme panelinde next/font/local çıktısına bağlanır" kararı gereği admin
 * önizlemesi de GERÇEK fontu yükler (kart seçicideki mini-önizleme ise `cssFallback` ile
 * yaklaşık gösterim yapar, bkz. lib/site-settings/appearance.ts — o AYRI bir kaygıdır).
 *
 * `next/font/local` çağrıları modül kapsamında (top-level, sabit obje literalleriyle) olmak
 * ZORUNDADIR — bu yüzden hepsi burada, koşulsuz ve tek tek tanımlanır.
 *
 * ÖNEMLİ (qa-agent tarafından bulunan kritik hatanın düzeltmesi — bkz. e2e rapor): Bu projenin
 * Next.js/Turbopack sürümünde `fontLoader(...).variable`, KLASİK next/font davranışındaki gibi
 * `variable` seçeneğine verilen `"--font-xxx"` DEĞERİNİ döndürmez — derleme zamanında üretilen,
 * hash'li bir CSS-module CLASS token'ı döndürür (örn. `playfair_display_ef51b57b-module__ZA5ysa__variable`,
 * başında `--` YOK). Bu class, JSX'te bir elemana class olarak uygulandığında o eleman üzerinde
 * GERÇEK `--font-site-xxx` custom property'sini tanımlar (bkz. derlenmiş çıktı:
 * `.next/.../playfair_display_*.module.css` içindeki `.xxx__variable { --font-site-playfair-display: ...; }`
 * kuralı) — yani `variable:` seçeneğine verdiğimiz LİTERAL string, `var()` içinde referans
 * vermemiz gereken GERÇEK custom-property adının ta kendisidir; `fontLoader(...).variable`'ı
 * `var(...)` içine SARMAK asla doğru olmamıştır (bu, `var()`'ın ilk argümanının `--` ile
 * başlaması zorunluluğunu ihlal eder ve tarayıcı bildirimi sessizce atar). DÜZELTME: `SITE_FONT_FAMILY`
 * artık her `SiteFont` değeri için `variable:` seçeneğine aşağıda verdiğimiz AYNI literal string'i
 * `var(...)` içinde doğrudan kullanır (bkz. dosyanın sonu) — TEK doğru kaynak, elle senkron tutulur.
 * NOT: `variable:` değeri BURADA (font loader çağrısının kendi argümanında) sabit bir tanımlayıcı
 * (const) İLE VERİLEMEZ — bu projenin font loader derleyici makrosu "Font loader values must be
 * explicitly written literals" hatasıyla reddeder (yalnızca AST'te DOĞRUDAN literal kabul eder,
 * bir `const`'a yapılan referansı bile ÇÖZÜMLEMEZ) — bu yüzden string'ler burada VE
 * `SITE_FONT_FAMILY`'de AYRI AYRI literal olarak yazılmıştır (kasıtlı tekrar).
 * `.variable` (hash'li class) SADECE `SITE_FONT_VARIABLES` üzerinden `.site-scope`'a class olarak
 * uygulanmaya devam eder (bu kısım zaten doğruydu, custom property'nin TANIMLANMASI için gerekli).
 */
export const siteInter = localFont({
  src: [
    { path: "../../fonts/inter/inter-latin-100-900-normal.woff2", weight: "100 900", style: "normal" },
  ],
  variable: "--font-site-inter",
  display: "swap",
  adjustFontFallback: false,
  declarations: [{ prop: "unicode-range", value: "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD" }],
});
export const siteInterExt = localFont({
  src: [
    { path: "../../fonts/inter/inter-latin-ext-100-900-normal.woff2", weight: "100 900", style: "normal" },
  ],
  variable: "--font-site-inter-ext",
  display: "swap",
  preload: false,
  declarations: [{ prop: "unicode-range", value: "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C4, U+2113, U+2C60-2C7F, U+A720-A7FF" }],
});
export const siteRoboto = localFont({
  src: [
    { path: "../../fonts/roboto/roboto-latin-400-700-normal.woff2", weight: "400", style: "normal" },
    { path: "../../fonts/roboto/roboto-latin-400-700-normal.woff2", weight: "500", style: "normal" },
    { path: "../../fonts/roboto/roboto-latin-400-700-normal.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-site-roboto",
  display: "swap",
  adjustFontFallback: false,
  declarations: [{ prop: "unicode-range", value: "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD" }],
});
export const siteRobotoExt = localFont({
  src: [
    { path: "../../fonts/roboto/roboto-latin-ext-400-700-normal.woff2", weight: "400", style: "normal" },
    { path: "../../fonts/roboto/roboto-latin-ext-400-700-normal.woff2", weight: "500", style: "normal" },
    { path: "../../fonts/roboto/roboto-latin-ext-400-700-normal.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-site-roboto-ext",
  display: "swap",
  preload: false,
  declarations: [{ prop: "unicode-range", value: "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C4, U+2113, U+2C60-2C7F, U+A720-A7FF" }],
});
export const siteOpenSans = localFont({
  src: [
    { path: "../../fonts/open-sans/open-sans-latin-300-800-normal.woff2", weight: "300 800", style: "normal" },
  ],
  variable: "--font-site-open-sans",
  display: "swap",
  adjustFontFallback: false,
  declarations: [{ prop: "unicode-range", value: "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD" }],
});
export const siteOpenSansExt = localFont({
  src: [
    { path: "../../fonts/open-sans/open-sans-latin-ext-300-800-normal.woff2", weight: "300 800", style: "normal" },
  ],
  variable: "--font-site-open-sans-ext",
  display: "swap",
  preload: false,
  declarations: [{ prop: "unicode-range", value: "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C4, U+2113, U+2C60-2C7F, U+A720-A7FF" }],
});
export const siteMontserrat = localFont({
  src: [
    { path: "../../fonts/montserrat/montserrat-latin-100-900-normal.woff2", weight: "100 900", style: "normal" },
  ],
  variable: "--font-site-montserrat",
  display: "swap",
  adjustFontFallback: false,
  declarations: [{ prop: "unicode-range", value: "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD" }],
});
export const siteMontserratExt = localFont({
  src: [
    { path: "../../fonts/montserrat/montserrat-latin-ext-100-900-normal.woff2", weight: "100 900", style: "normal" },
  ],
  variable: "--font-site-montserrat-ext",
  display: "swap",
  preload: false,
  declarations: [{ prop: "unicode-range", value: "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C4, U+2113, U+2C60-2C7F, U+A720-A7FF" }],
});
export const sitePoppins = localFont({
  src: [
    { path: "../../fonts/poppins/poppins-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "../../fonts/poppins/poppins-latin-500-normal.woff2", weight: "500", style: "normal" },
    { path: "../../fonts/poppins/poppins-latin-600-normal.woff2", weight: "600", style: "normal" },
    { path: "../../fonts/poppins/poppins-latin-700-normal.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-site-poppins",
  display: "swap",
  adjustFontFallback: false,
  declarations: [{ prop: "unicode-range", value: "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD" }],
});
export const sitePoppinsExt = localFont({
  src: [
    { path: "../../fonts/poppins/poppins-latin-ext-400-normal.woff2", weight: "400", style: "normal" },
    { path: "../../fonts/poppins/poppins-latin-ext-500-normal.woff2", weight: "500", style: "normal" },
    { path: "../../fonts/poppins/poppins-latin-ext-600-normal.woff2", weight: "600", style: "normal" },
    { path: "../../fonts/poppins/poppins-latin-ext-700-normal.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-site-poppins-ext",
  display: "swap",
  preload: false,
  declarations: [{ prop: "unicode-range", value: "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C4, U+2113, U+2C60-2C7F, U+A720-A7FF" }],
});
export const siteLora = localFont({
  src: [
    { path: "../../fonts/lora/lora-latin-400-700-normal.woff2", weight: "400 700", style: "normal" },
  ],
  variable: "--font-site-lora",
  display: "swap",
  adjustFontFallback: false,
  declarations: [{ prop: "unicode-range", value: "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD" }],
});
export const siteLoraExt = localFont({
  src: [
    { path: "../../fonts/lora/lora-latin-ext-400-700-normal.woff2", weight: "400 700", style: "normal" },
  ],
  variable: "--font-site-lora-ext",
  display: "swap",
  preload: false,
  adjustFontFallback: "Times New Roman",
  declarations: [{ prop: "unicode-range", value: "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C4, U+2113, U+2C60-2C7F, U+A720-A7FF" }],
});
export const sitePlayfairDisplay = localFont({
  src: [
    { path: "../../fonts/playfair-display/playfair-display-latin-400-900-normal.woff2", weight: "400 900", style: "normal" },
  ],
  variable: "--font-site-playfair-display",
  display: "swap",
  adjustFontFallback: false,
  declarations: [{ prop: "unicode-range", value: "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD" }],
});
export const sitePlayfairDisplayExt = localFont({
  src: [
    { path: "../../fonts/playfair-display/playfair-display-latin-ext-400-900-normal.woff2", weight: "400 900", style: "normal" },
  ],
  variable: "--font-site-playfair-display-ext",
  display: "swap",
  preload: false,
  adjustFontFallback: "Times New Roman",
  declarations: [{ prop: "unicode-range", value: "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C4, U+2113, U+2C60-2C7F, U+A720-A7FF" }],
});
export const siteSourceSerif4 = localFont({
  src: [
    { path: "../../fonts/source-serif-4/source-serif-4-latin-200-900-normal.woff2", weight: "200 900", style: "normal" },
  ],
  variable: "--font-site-source-serif-4",
  display: "swap",
  adjustFontFallback: false,
  declarations: [{ prop: "unicode-range", value: "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD" }],
});
export const siteSourceSerif4Ext = localFont({
  src: [
    { path: "../../fonts/source-serif-4/source-serif-4-latin-ext-200-900-normal.woff2", weight: "200 900", style: "normal" },
  ],
  variable: "--font-site-source-serif-4-ext",
  display: "swap",
  preload: false,
  adjustFontFallback: "Times New Roman",
  declarations: [{ prop: "unicode-range", value: "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C4, U+2113, U+2C60-2C7F, U+A720-A7FF" }],
});
export const sitePlusJakartaSans = localFont({
  src: [
    { path: "../../fonts/plus-jakarta-sans/plus-jakarta-sans-latin-200-800-normal.woff2", weight: "200 800", style: "normal" },
  ],
  variable: "--font-site-plus-jakarta-sans",
  display: "swap",
  adjustFontFallback: false,
  declarations: [{ prop: "unicode-range", value: "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD" }],
});
export const sitePlusJakartaSansExt = localFont({
  src: [
    { path: "../../fonts/plus-jakarta-sans/plus-jakarta-sans-latin-ext-200-800-normal.woff2", weight: "200 800", style: "normal" },
  ],
  variable: "--font-site-plus-jakarta-sans-ext",
  display: "swap",
  preload: false,
  declarations: [{ prop: "unicode-range", value: "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C4, U+2113, U+2C60-2C7F, U+A720-A7FF" }],
});
export const siteOutfit = localFont({
  src: [
    { path: "../../fonts/outfit/outfit-latin-100-900-normal.woff2", weight: "100 900", style: "normal" },
  ],
  variable: "--font-site-outfit",
  display: "swap",
  adjustFontFallback: false,
  declarations: [{ prop: "unicode-range", value: "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD" }],
});
export const siteOutfitExt = localFont({
  src: [
    { path: "../../fonts/outfit/outfit-latin-ext-100-900-normal.woff2", weight: "100 900", style: "normal" },
  ],
  variable: "--font-site-outfit-ext",
  display: "swap",
  preload: false,
  declarations: [{ prop: "unicode-range", value: "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C4, U+2113, U+2C60-2C7F, U+A720-A7FF" }],
});

/**
 * Tüm fontların `variable` çıktısını AYNI sarmalayıcıya (`.site-scope`) uygulamak gerekir —
 * next/font'un derleme-zamanı optimizasyonu (preload/`@font-face`) bu class'ların JSX'te
 * GERÇEKTEN kullanılmasını gerektirir. Kullanıldığı yerde `--site-heading-font`/`--site-body-font`
 * bu değişkenlerden birine `var(...)` ile atıfta bulunur (aynı elemanda tanımlı olduğu için
 * güvenle çözümlenir, bkz. `(site)/layout.tsx`).
 */
export const SITE_FONT_VARIABLES = [
  siteInter.variable,
  siteInterExt.variable,
  siteRoboto.variable,
  siteRobotoExt.variable,
  siteOpenSans.variable,
  siteOpenSansExt.variable,
  siteMontserrat.variable,
  siteMontserratExt.variable,
  sitePoppins.variable,
  sitePoppinsExt.variable,
  siteLora.variable,
  siteLoraExt.variable,
  sitePlayfairDisplay.variable,
  sitePlayfairDisplayExt.variable,
  siteSourceSerif4.variable,
  siteSourceSerif4Ext.variable,
  sitePlusJakartaSans.variable,
  sitePlusJakartaSansExt.variable,
  siteOutfit.variable,
  siteOutfitExt.variable,
].join(" ");

export const SITE_FONT_FAMILY: Record<SiteFont, string> = {
  SYSTEM: "ui-sans-serif, system-ui, sans-serif",
  INTER: "var(--font-site-inter), var(--font-site-inter-ext)",
  ROBOTO: "var(--font-site-roboto), var(--font-site-roboto-ext)",
  OPEN_SANS: "var(--font-site-open-sans), var(--font-site-open-sans-ext)",
  MONTSERRAT: "var(--font-site-montserrat), var(--font-site-montserrat-ext)",
  POPPINS: "var(--font-site-poppins), var(--font-site-poppins-ext)",
  LORA: "var(--font-site-lora), var(--font-site-lora-ext)",
  PLAYFAIR_DISPLAY: "var(--font-site-playfair-display), var(--font-site-playfair-display-ext)",
  SOURCE_SERIF_4: "var(--font-site-source-serif-4), var(--font-site-source-serif-4-ext)",
  PLUS_JAKARTA_SANS: "var(--font-site-plus-jakarta-sans), var(--font-site-plus-jakarta-sans-ext)",
  OUTFIT: "var(--font-site-outfit), var(--font-site-outfit-ext)",
};

/**
 * Paket L (2026-10-23) — Rusça (Kiril) ve Arapça yazı desteği.
 *
 * Her yüz YALNIZCA ilgili alt kümeyle (unicode-range) tanımlanır, `preload: false` ve
 * `adjustFontFallback: false`: font ailesi yığınında ana fontun ÖNÜNE konur, böylece Latin
 * karakterler ana fonttan, Kiril/Arapça karakterler bu yüzden gelir. Tarayıcı dosyayı yalnızca
 * sayfada o karakterler varsa indirir; değişken sınıfları da yalnızca `ru`/`ar` sayfalarında
 * uygulanır (`siteScriptFontClass`), diğer dillerde hiçbir şey indirilmez.
 *
 * Paket AL notu — Google sürümünde ödünç alınan ailenin (Montserrat/Inter) Latin yüzleri de `-cyr` ailesiyle geliyordu; bu yüzden
 * ödünç aile için Latin yüzler (`--font-site-montserrat`/`-ext`, `--font-site-inter`/`-ext`) listeye açıkça eklenir.
 *
 * Kiril alt kümesi olmayan fontlar için uyumlu yedek: Poppins/Outfit → Montserrat (geometrik),
 * Plus Jakarta Sans (yalnızca cyrillic-ext) → Inter. `SYSTEM` sistem fontlarıyla zaten çalışır.
 */
export const siteInterCyrillic = localFont({
  src: [
    { path: "../../fonts/inter/inter-cyrillic-100-900-normal.woff2", weight: "100 900", style: "normal" },
  ],
  variable: "--font-site-inter-cyr",
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  declarations: [{ prop: "unicode-range", value: "U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116" }],
});
export const siteRobotoCyrillic = localFont({
  src: [
    { path: "../../fonts/roboto/roboto-cyrillic-400-700-normal.woff2", weight: "400", style: "normal" },
    { path: "../../fonts/roboto/roboto-cyrillic-400-700-normal.woff2", weight: "500", style: "normal" },
    { path: "../../fonts/roboto/roboto-cyrillic-400-700-normal.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-site-roboto-cyr",
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  declarations: [{ prop: "unicode-range", value: "U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116" }],
});
export const siteOpenSansCyrillic = localFont({
  src: [
    { path: "../../fonts/open-sans/open-sans-cyrillic-300-800-normal.woff2", weight: "300 800", style: "normal" },
  ],
  variable: "--font-site-open-sans-cyr",
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  declarations: [{ prop: "unicode-range", value: "U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116" }],
});
export const siteMontserratCyrillic = localFont({
  src: [
    { path: "../../fonts/montserrat/montserrat-cyrillic-100-900-normal.woff2", weight: "100 900", style: "normal" },
  ],
  variable: "--font-site-montserrat-cyr",
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  declarations: [{ prop: "unicode-range", value: "U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116" }],
});
export const siteLoraCyrillic = localFont({
  src: [
    { path: "../../fonts/lora/lora-cyrillic-400-700-normal.woff2", weight: "400 700", style: "normal" },
  ],
  variable: "--font-site-lora-cyr",
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  declarations: [{ prop: "unicode-range", value: "U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116" }],
});
export const sitePlayfairDisplayCyrillic = localFont({
  src: [
    { path: "../../fonts/playfair-display/playfair-display-cyrillic-400-900-normal.woff2", weight: "400 900", style: "normal" },
  ],
  variable: "--font-site-playfair-display-cyr",
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  declarations: [{ prop: "unicode-range", value: "U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116" }],
});
export const siteSourceSerif4Cyrillic = localFont({
  src: [
    { path: "../../fonts/source-serif-4/source-serif-4-cyrillic-200-900-normal.woff2", weight: "200 900", style: "normal" },
  ],
  variable: "--font-site-source-serif-4-cyr",
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  declarations: [{ prop: "unicode-range", value: "U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116" }],
});
export const siteArabic = localFont({
  src: [
    { path: "../../fonts/noto-sans-arabic/noto-sans-arabic-arabic-100-900-normal.woff2", weight: "100 900", style: "normal" },
  ],
  variable: "--font-site-arabic",
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  declarations: [{ prop: "unicode-range", value: "U+0600-06FF, U+0750-077F, U+0870-0891, U+0897-08E1, U+08E3-08FF, U+200C-200E, U+2010-2011, U+204F, U+2E41, U+FB50-FDFF, U+FE70-FE74, U+FE76-FEFC, U+102E0-102FB, U+10E60-10E7E, U+10EC2-10EC7, U+10EC9-10EEE, U+10EF0-10EFF, U+1EE00-1EE03, U+1EE05-1EE1F, U+1EE21-1EE22, U+1EE24, U+1EE27, U+1EE29-1EE32, U+1EE34-1EE37, U+1EE39, U+1EE3B, U+1EE42, U+1EE47, U+1EE49, U+1EE4B, U+1EE4D-1EE4F, U+1EE51-1EE52, U+1EE54, U+1EE57, U+1EE59, U+1EE5B, U+1EE5D, U+1EE5F, U+1EE61-1EE62, U+1EE64, U+1EE67-1EE6A, U+1EE6C-1EE72, U+1EE74-1EE77, U+1EE79-1EE7C, U+1EE7E, U+1EE80-1EE89, U+1EE8B-1EE9B, U+1EEA1-1EEA3, U+1EEA5-1EEA9, U+1EEAB-1EEBB, U+1EEF0-1EEF1" }],
});
// Google'daki `Noto Sans Arabic` ailesi Latin yüzlerini de taşıyordu: `/ar` sayfalarındaki Latin harf/rakamlar bu fontla çiziliyordu.
// Görünüm değişmesin diye aynı Latin alt kümeleri (`latin`, `latin-ext`) Arapça yüzün ardına eklenir.
export const siteArabicLatin = localFont({
  src: [
    { path: "../../fonts/noto-sans-arabic/noto-sans-arabic-latin-100-900-normal.woff2", weight: "100 900", style: "normal" },
  ],
  variable: "--font-site-arabic-latin",
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  declarations: [{ prop: "unicode-range", value: "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD" }],
});
export const siteArabicLatinExt = localFont({
  src: [
    { path: "../../fonts/noto-sans-arabic/noto-sans-arabic-latin-ext-100-900-normal.woff2", weight: "100 900", style: "normal" },
  ],
  variable: "--font-site-arabic-latin-ext",
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  declarations: [{ prop: "unicode-range", value: "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C4, U+2113, U+2C60-2C7F, U+A720-A7FF" }],
});

const CYRILLIC_FONT_VARIABLES = [
  siteInterCyrillic.variable,
  siteRobotoCyrillic.variable,
  siteOpenSansCyrillic.variable,
  siteMontserratCyrillic.variable,
  siteLoraCyrillic.variable,
  sitePlayfairDisplayCyrillic.variable,
  siteSourceSerif4Cyrillic.variable,
].join(" ");

/** Seçili site fontuna karşılık gelen Kiril yüzü (yoksa uyumlu yedek). `SYSTEM` → yok. */
const CYRILLIC_FONT_FAMILY: Record<SiteFont, string | null> = {
  SYSTEM: null,
  INTER: "var(--font-site-inter-cyr)",
  ROBOTO: "var(--font-site-roboto-cyr)",
  OPEN_SANS: "var(--font-site-open-sans-cyr)",
  MONTSERRAT: "var(--font-site-montserrat-cyr)",
  POPPINS: "var(--font-site-montserrat-cyr), var(--font-site-montserrat), var(--font-site-montserrat-ext)",
  LORA: "var(--font-site-lora-cyr)",
  PLAYFAIR_DISPLAY: "var(--font-site-playfair-display-cyr)",
  SOURCE_SERIF_4: "var(--font-site-source-serif-4-cyr)",
  PLUS_JAKARTA_SANS: "var(--font-site-inter-cyr), var(--font-site-inter), var(--font-site-inter-ext)",
  OUTFIT: "var(--font-site-montserrat-cyr), var(--font-site-montserrat), var(--font-site-montserrat-ext)",
};

const ARABIC_FONT_STACK = "var(--font-site-arabic), var(--font-site-arabic-latin), var(--font-site-arabic-latin-ext)";

function scriptOf(lang: string | undefined): "cyrillic" | "arabic" | null {
  const base = (lang ?? "").toLowerCase().split("-")[0];
  if (base === "ru") return "cyrillic";
  if (base === "ar") return "arabic";
  return null;
}

/** Dile göre font yığını: Kiril/Arapça yüz ana fontun önüne eklenir; diğer dillerde değişmez. */
export function siteFontFamilyFor(font: SiteFont, lang?: string): string {
  const base = SITE_FONT_FAMILY[font];
  const script = scriptOf(lang);
  if (script === "arabic") return `${ARABIC_FONT_STACK}, ${base}`;
  if (script === "cyrillic") {
    const cyr = CYRILLIC_FONT_FAMILY[font];
    return cyr ? `${cyr}, ${base}` : base;
  }
  return base;
}

/** Yalnızca `ru`/`ar` sayfalarında uygulanan font değişken sınıfları (diğer dillerde boş). */
export function siteScriptFontClass(lang?: string): string {
  const script = scriptOf(lang);
  if (script === "arabic") return `${siteArabic.variable} ${siteArabicLatin.variable} ${siteArabicLatinExt.variable}`;
  if (script === "cyrillic") return CYRILLIC_FONT_VARIABLES;
  return "";
}
