import type { Metadata } from "next";
import { headers } from "next/headers";
import { Geist, Geist_Mono } from "next/font/google";
import { Providers } from "./providers";
import { HtmlLangSync } from "@/components/html-lang-sync";
import { localeDirection } from "@/lib/i18n/locale-direction";
import { SITE_URL } from "@/lib/env";
import { buildSiteIconsMetadata } from "@/lib/site-settings/site-icons";
import { fetchSiteSettingsServer } from "@/lib/api/server-settings";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
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
    description: "Uzman doktorlarla güvenli online görüşme ve randevu platformu.",
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
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
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
