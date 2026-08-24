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
export const siteInter = Inter({ subsets: ["latin", "latin-ext"], variable: "--font-site-inter", display: "swap" });
export const siteRoboto = Roboto({ subsets: ["latin", "latin-ext"], weight: ["400", "500", "700"], variable: "--font-site-roboto", display: "swap" });
export const siteOpenSans = Open_Sans({ subsets: ["latin", "latin-ext"], variable: "--font-site-open-sans", display: "swap" });
export const siteMontserrat = Montserrat({ subsets: ["latin", "latin-ext"], variable: "--font-site-montserrat", display: "swap" });
export const sitePoppins = Poppins({ subsets: ["latin", "latin-ext"], weight: ["400", "500", "600", "700"], variable: "--font-site-poppins", display: "swap" });
export const siteLora = Lora({ subsets: ["latin", "latin-ext"], variable: "--font-site-lora", display: "swap" });
export const sitePlayfairDisplay = Playfair_Display({ subsets: ["latin", "latin-ext"], variable: "--font-site-playfair-display", display: "swap" });
export const siteSourceSerif4 = Source_Serif_4({ subsets: ["latin", "latin-ext"], variable: "--font-site-source-serif-4", display: "swap" });
export const sitePlusJakartaSans = Plus_Jakarta_Sans({ subsets: ["latin", "latin-ext"], variable: "--font-site-plus-jakarta-sans", display: "swap" });
export const siteOutfit = Outfit({ subsets: ["latin", "latin-ext"], variable: "--font-site-outfit", display: "swap" });

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
  INTER: "var(--font-site-inter)",
  ROBOTO: "var(--font-site-roboto)",
  OPEN_SANS: "var(--font-site-open-sans)",
  MONTSERRAT: "var(--font-site-montserrat)",
  POPPINS: "var(--font-site-poppins)",
  LORA: "var(--font-site-lora)",
  PLAYFAIR_DISPLAY: "var(--font-site-playfair-display)",
  SOURCE_SERIF_4: "var(--font-site-source-serif-4)",
  PLUS_JAKARTA_SANS: "var(--font-site-plus-jakarta-sans)",
  OUTFIT: "var(--font-site-outfit)",
};
