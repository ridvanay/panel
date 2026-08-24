import {
  Inter,
  Lora,
  Montserrat,
  Open_Sans,
  Outfit,
  Playfair_Display,
  Plus_Jakarta_Sans,
  Poppins,
  Roboto,
  Source_Serif_4,
} from "next/font/google";
import type { SiteFont } from "@/lib/api/types";

/**
 * §10.12.3 — `SiteFont` KAPALI bir enum'dur (teknik zorunluluk: `next/font/google` font adının
 * DERLEME ZAMANINDA bilinmesini gerektirir). Bu modül TEK bir kaynak: hem `(site)/layout.tsx`
 * (gerçek ziyaretçi sitesi) hem de `/admin/appearance` sayfasının canlı önizlemesi AYNI font
 * setini/değişken adlarını kullanır — design-notes-appearance-panel.md §7'nin "gerçek font
 * yalnızca canlı önizleme panelinde next/font/google çıktısına bağlanır" kararı gereği admin
 * önizlemesi de GERÇEK fontu yükler (kart seçicideki mini-önizleme ise `cssFallback` ile
 * yaklaşık gösterim yapar, bkz. lib/site-settings/appearance.ts — o AYRI bir kaygıdır).
 *
 * `next/font/google` çağrıları modül kapsamında (top-level, sabit obje literalleriyle) olmak
 * ZORUNDADIR — bu yüzden hepsi burada, koşulsuz ve tek tek tanımlanır.
 */
export const siteInter = Inter({ subsets: ["latin"], variable: "--font-site-inter", display: "swap" });
export const siteRoboto = Roboto({ subsets: ["latin"], weight: ["400", "500", "700"], variable: "--font-site-roboto", display: "swap" });
export const siteOpenSans = Open_Sans({ subsets: ["latin"], variable: "--font-site-open-sans", display: "swap" });
export const siteMontserrat = Montserrat({ subsets: ["latin"], variable: "--font-site-montserrat", display: "swap" });
export const sitePoppins = Poppins({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-site-poppins", display: "swap" });
export const siteLora = Lora({ subsets: ["latin"], variable: "--font-site-lora", display: "swap" });
export const sitePlayfairDisplay = Playfair_Display({ subsets: ["latin"], variable: "--font-site-playfair-display", display: "swap" });
export const siteSourceSerif4 = Source_Serif_4({ subsets: ["latin"], variable: "--font-site-source-serif-4", display: "swap" });
export const sitePlusJakartaSans = Plus_Jakarta_Sans({ subsets: ["latin"], variable: "--font-site-plus-jakarta-sans", display: "swap" });
export const siteOutfit = Outfit({ subsets: ["latin"], variable: "--font-site-outfit", display: "swap" });

/**
 * Tüm fontların `variable` çıktısını AYNI sarmalayıcıya (`.site-scope`) uygulamak gerekir —
 * next/font'un derleme-zamanı optimizasyonu (preload/`@font-face`) bu class'ların JSX'te
 * GERÇEKTEN kullanılmasını gerektirir. Kullanıldığı yerde `--site-heading-font`/`--site-body-font`
 * bu değişkenlerden birine `var(...)` ile atıfta bulunur (aynı elemanda tanımlı olduğu için
 * güvenle çözümlenir, bkz. `(site)/layout.tsx`).
 */
export const SITE_FONT_VARIABLES = [
  siteInter.variable,
  siteRoboto.variable,
  siteOpenSans.variable,
  siteMontserrat.variable,
  sitePoppins.variable,
  siteLora.variable,
  sitePlayfairDisplay.variable,
  siteSourceSerif4.variable,
  sitePlusJakartaSans.variable,
  siteOutfit.variable,
].join(" ");

export const SITE_FONT_FAMILY: Record<SiteFont, string> = {
  SYSTEM: "ui-sans-serif, system-ui, sans-serif",
  INTER: `var(${siteInter.variable})`,
  ROBOTO: `var(${siteRoboto.variable})`,
  OPEN_SANS: `var(${siteOpenSans.variable})`,
  MONTSERRAT: `var(${siteMontserrat.variable})`,
  POPPINS: `var(${sitePoppins.variable})`,
  LORA: `var(${siteLora.variable})`,
  PLAYFAIR_DISPLAY: `var(${sitePlayfairDisplay.variable})`,
  SOURCE_SERIF_4: `var(${siteSourceSerif4.variable})`,
  PLUS_JAKARTA_SANS: `var(${sitePlusJakartaSans.variable})`,
  OUTFIT: `var(${siteOutfit.variable})`,
};
