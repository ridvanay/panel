import type { Metadata } from "next";
import { headers } from "next/headers";
import localFont from "next/font/local";
import { Providers } from "./providers";
import { HtmlLangSync } from "@/components/html-lang-sync";
import { localeDirection } from "@/lib/i18n/locale-direction";
import { SITE_URL } from "@/lib/env";
import { buildSiteIconsMetadata } from "@/lib/site-settings/site-icons";
import { fetchSiteSettingsServer } from "@/lib/api/server-settings";
import "./globals.css";

// Paket AL — Geist yerel dosyadan (next/font/local; build'de Google Fonts indirmesi YOK). Google'daki gibi alt küme başına
// ayrı yüz (unicode-range): latin + latin-ext (Paket T: Romence ș ț ă î â, Sırpça Latin č ć đ š ž, Fransızca œ) + cyrillic (Rusça).
// `-cyr`/`-ext` yüzleri ana fontun ardına `font-family` listesinde eklenir (bkz. globals.css `--font-sans`/`--font-mono`).
const geistSans = localFont({
  src: [
    { path: "../fonts/geist/geist-latin-100-900-normal.woff2", weight: "100 900", style: "normal" },
  ],
  variable: "--font-geist-sans",
  display: "swap",
  adjustFontFallback: false,
  declarations: [{ prop: "unicode-range", value: "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD" }],
});
const geistSansCyr = localFont({
  src: [
    { path: "../fonts/geist/geist-cyrillic-100-900-normal.woff2", weight: "100 900", style: "normal" },
  ],
  variable: "--font-geist-sans-cyr",
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  declarations: [{ prop: "unicode-range", value: "U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116" }],
});
const geistSansExt = localFont({
  src: [
    { path: "../fonts/geist/geist-latin-ext-100-900-normal.woff2", weight: "100 900", style: "normal" },
  ],
  variable: "--font-geist-sans-ext",
  display: "swap",
  preload: false,
  declarations: [{ prop: "unicode-range", value: "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C4, U+2113, U+2C60-2C7F, U+A720-A7FF" }],
});
const geistMono = localFont({
  src: [
    { path: "../fonts/geist-mono/geist-mono-latin-100-900-normal.woff2", weight: "100 900", style: "normal" },
  ],
  variable: "--font-geist-mono",
  display: "swap",
  adjustFontFallback: false,
  declarations: [{ prop: "unicode-range", value: "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD" }],
});
const geistMonoCyr = localFont({
  src: [
    { path: "../fonts/geist-mono/geist-mono-cyrillic-100-900-normal.woff2", weight: "100 900", style: "normal" },
  ],
  variable: "--font-geist-mono-cyr",
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  declarations: [{ prop: "unicode-range", value: "U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116" }],
});
const geistMonoExt = localFont({
  src: [
    { path: "../fonts/geist-mono/geist-mono-latin-ext-100-900-normal.woff2", weight: "100 900", style: "normal" },
  ],
  variable: "--font-geist-mono-ext",
  display: "swap",
  preload: false,
  declarations: [{ prop: "unicode-range", value: "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C4, U+2113, U+2C60-2C7F, U+A720-A7FF" }],
});

export async function generateMetadata(): Promise<Metadata> {
  // Paket O — site simgesi TEK yerden: admin'de seçilen simge (`SiteSettings.faviconUrl` /
  // `appleTouchIconUrl`), yoksa repodaki WM simgesi. Alt layout'lar `icons` TANIMLAMAZ; admin,
  // giriş, site ve doktor portalı aynı simgeyi gösterir.
  // İnceleme bulgusu — backend hatası (429/5xx) admin/giriş dahil TÜM rotaları düşürmesin: varsayılan WM simgesi.
  const settings = await fetchSiteSettingsServer().catch(() => ({ faviconUrl: null, appleTouchIconUrl: null }));
  return {
    // Relative OG image/canonical URL'lerinin doğru mutlak URL'e çözümlenmesi için gerekli.
    metadataBase: new URL(SITE_URL),
    title: {
      default: "WM Health Istanbul",
      template: "%s · WM Health Istanbul",
    },
    // Paket AH — aracı kuruluş vurgusu (dile özgü sayfa açıklamaları `buildContentMetadata.fallbackDescription` ile).
    description:
      "WM Health is an international health tourism intermediary organization, not a healthcare provider. Treatments are performed by authorized healthcare facilities.",
    icons: buildSiteIconsMetadata(settings),
  };
}

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // `.claude/architect-scope-i18n.md` §6.3 — `<html lang>` aktif locale'den türetilir. Kök layout
  // `[lang]` dinamik segmentinin ÜSTÜNDE olduğu için route param'a erişemez (bkz. görev notu);
  // bunun yerine `proxy.ts`'in her site isteğine yazdığı `x-active-locale` header'ı okunur. Bu,
  // YALNIZCA TAM SAYFA yüklemesinde doğrudur — client-side navigasyonda (ör. dil değiştiricideki
  // `<Link>`) kök layout YENİDEN ÇALIŞMAZ (bkz. `<HtmlLangSync>` — bu bayatlığı client tarafında
  // giderir, qa-agent bulgusu). Admin/auth/dashboard gibi proxy'nin HİÇ görmediği rotalarda bu
  // header YOKTUR → "tr" varsayılanı (admin panelinin dili zaten URL/html lang'e değil
  // `localStorage`'a bağlıdır, §7.4).
  const headersList = await headers();
  // Paket O (güvenlik incelemesi) — proxy'nin yazmadığı yollarda istemci kendi başlığını gönderebilir;
  // yalnızca dil kodu biçimindeki değer kabul edilir.
  const rawLocale = headersList.get("x-active-locale") ?? "";
  const activeLocale = /^[a-z]{2,3}(-[a-z0-9]{2,8})?$/.test(rawLocale) ? rawLocale : "tr";

  return (
    <html
      lang={activeLocale}
      // Paket L — Arapça gibi sağdan sola dillerde `rtl`; admin/auth rotalarında header yok → "tr" → `ltr`.
      dir={localeDirection(activeLocale)}
      className={`${geistSans.variable} ${geistSansCyr.variable} ${geistSansExt.variable} ${geistMono.variable} ${geistMonoCyr.variable} ${geistMonoExt.variable} h-full antialiased`}
      // next-themes <html> üzerinde class="dark"/style="color-scheme" ekleyip kaldırdığı için
      // sunucu/istemci ilk render'ında kaçınılmaz bir farklılık oluşur; bu satır o beklenen
      // farkı bastırır (yalnızca bir seviye derinlikte etkilidir, başka hydration uyarılarını
      // gizlemez).
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col">
        {/* İlk render'ı sunucudaki `lang` ile AYNI değerle "günceller" (no-op) — sonraki
            client-side navigasyonlarda gerçek işi yapar (bkz. bileşen içi açıklama). */}
        <HtmlLangSync />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
