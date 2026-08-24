import type { SiteFont } from "@/lib/api/types";

/**
 * design-notes-appearance-studio.md §3.1 — 15 kürasyonlu (headingFont, bodyFont) çifti,
 * `/admin/appearance` `typography` sekmesindeki "Hazır Font Eşleşmeleri" şeridi için. `SiteFont`
 * enum'u KAPALI olduğu için (§10.12.3, `next/font/google` derleme-zamanı kısıtı) burada SADECE
 * mevcut 11 `SiteFont` değerinin kombinasyonları kullanılır — yeni font YOK. Tıklama HEM
 * `headingFont` HEM `bodyFont`'u aynı anda değiştirir (`baseFontSize`/renkler DOKUNULMAZ).
 */
export interface FontPairing {
  key: string;
  label: string;
  description: string;
  headingFont: SiteFont;
  bodyFont: SiteFont;
}

export const FONT_PAIRINGS: FontPairing[] = [
  {
    key: "classic-corporate",
    label: "Klasik Kurumsal",
    description: "Playfair Display + Source Serif 4 — hukuk/finans/danışmanlık için zamansız ciddiyet.",
    headingFont: "PLAYFAIR_DISPLAY",
    bodyFont: "SOURCE_SERIF_4",
  },
  {
    key: "modern-minimal",
    label: "Modern Minimal",
    description: "Outfit + Inter — SaaS/teknoloji ürünleri için geometrik başlık, nötr gövde.",
    headingFont: "OUTFIT",
    bodyFont: "INTER",
  },
  {
    key: "saas-clean",
    label: "SaaS Temiz",
    description: "Plus Jakarta Sans + Inter — yumuşak humanist başlık, yüksek okunabilirlik.",
    headingFont: "PLUS_JAKARTA_SANS",
    bodyFont: "INTER",
  },
  {
    key: "editorial-elegant",
    label: "Editoryal Zarif",
    description: "Lora + Open Sans — dergi hissi veren serif başlık, sade sans gövde.",
    headingFont: "LORA",
    bodyFont: "OPEN_SANS",
  },
  {
    key: "tech-trust",
    label: "Teknoloji Güvenilir",
    description: "Montserrat + Roboto — güçlü geometrik başlık, tanıdık/net gövde.",
    headingFont: "MONTSERRAT",
    bodyFont: "ROBOTO",
  },
  {
    key: "artisan-warm",
    label: "Sıcak Butik",
    description: "Playfair Display + Open Sans — el yapımı/atölye markaları için sıcak serif-sans ikilisi (Sıcak Toprak paletiyle uyumlu).",
    headingFont: "PLAYFAIR_DISPLAY",
    bodyFont: "OPEN_SANS",
  },
  {
    key: "startup-energetic",
    label: "Startup Enerjik",
    description: "Poppins + Inter — genç/hızlı büyüyen markalar için yuvarlak, arkadaşça başlık.",
    headingFont: "POPPINS",
    bodyFont: "INTER",
  },
  {
    key: "luxury-editorial",
    label: "Lüks Editoryal",
    description: "Playfair Display + Lora — iki serif'in birleşimi, yüksek moda/lüks perakende hissi (Lüks Altın/Siyah paletiyle uyumlu).",
    headingFont: "PLAYFAIR_DISPLAY",
    bodyFont: "LORA",
  },
  {
    key: "corporate-serif",
    label: "Kurumsal Serif",
    description: "Source Serif 4 + Open Sans — ciddi serif başlık, nötr sans gövde; raporlama/hukuk içerikleri için.",
    headingFont: "SOURCE_SERIF_4",
    bodyFont: "OPEN_SANS",
  },
  {
    key: "system-native",
    label: "Sistem Varsayılan",
    description: "Sistem + Sistem — harici font indirmez, en hızlı yüklenen seçenek; performans öncelikli siteler.",
    headingFont: "SYSTEM",
    bodyFont: "SYSTEM",
  },
  {
    key: "geometric-mono",
    label: "Geometrik Tek Aile",
    description: "Outfit + Outfit — tek font ailesi, sıkı ve tutarlı bir marka kimliği.",
    headingFont: "OUTFIT",
    bodyFont: "OUTFIT",
  },
  {
    key: "friendly-soft",
    label: "Yumuşak Dostane",
    description: "Poppins + Open Sans — sağlık/eğitim/topluluk siteleri için yuvarlak başlık, sakin gövde.",
    headingFont: "POPPINS",
    bodyFont: "OPEN_SANS",
  },
  {
    key: "bold-header-plain-body",
    label: "Güçlü Başlık, Sade Gövde",
    description: "Montserrat + Inter — pazarlama sayfaları için yüksek kontrastlı başlık ağırlığı.",
    headingFont: "MONTSERRAT",
    bodyFont: "INTER",
  },
  {
    key: "fashion-magazine",
    label: "Zarif Dergi",
    description: "Playfair Display + Plus Jakarta Sans — moda/yaşam tarzı için klasik başlık + modern humanist gövde.",
    headingFont: "PLAYFAIR_DISPLAY",
    bodyFont: "PLUS_JAKARTA_SANS",
  },
  {
    key: "consistent-sans",
    label: "Tutarlı Sans",
    description: "Inter + Inter — dokümantasyon/ürün siteleri için tam tutarlılık.",
    headingFont: "INTER",
    bodyFont: "INTER",
  },
];
