/**
 * design-notes-appearance-studio.md §2.2 — 8 kurumsal renk paleti, `/admin/appearance` `colors`
 * sekmesindeki "hızlı başlangıç" şeridi için. Bu sabit `presetKey` sistemiyle (7'li renk+tipografi
 * ön ayarları, `lib/appearance-presets.ts`, backend registry) KARIŞTIRILMAZ — SAF frontend sabiti,
 * yalnızca 10 renk alanını doldurur (font/border-radius/button-style DOKUNULMAZ). Tüm hex değerleri
 * ve WCAG AA (4.5:1) kontrast doğrulaması design-notes'ta elle hesaplandı — burada AYNEN kopyalanır,
 * yeniden hesaplama YAPILMAZ.
 */
export interface CorporateColorPaletteValues {
  primaryColor: string;
  secondaryColor: string;
  buttonColor: string;
  buttonTextColor: string;
  linkColor: string;
  accentColor: string;
  backgroundColor: string;
  surfaceColor: string;
  textColor: string;
  mutedTextColor: string;
}

export interface CorporateColorPalette {
  key: string;
  label: string;
  description: string;
  values: CorporateColorPaletteValues;
}

export const CORPORATE_COLOR_PALETTES: CorporateColorPalette[] = [
  {
    key: "modern-indigo",
    label: "Modern Indigo",
    description: "Platformun varsayılan kimliği — canlı indigo, SaaS/teknoloji ürünleri için güvenilir ve modern.",
    values: {
      primaryColor: "#4f46e5",
      secondaryColor: "#111827",
      buttonColor: "#4f46e5",
      buttonTextColor: "#ffffff",
      linkColor: "#4f46e5",
      accentColor: "#f59e0b",
      backgroundColor: "#ffffff",
      surfaceColor: "#f9fafb",
      textColor: "#111827",
      mutedTextColor: "#6b7280",
    },
  },
  {
    key: "emerald-corporate",
    label: "Zümrüt Kurumsal",
    description: "Koyu zümrüt yeşili — sürdürülebilirlik/finans/sağlık sektörlerinde ciddi ve güvenilir bir ton.",
    values: {
      primaryColor: "#065f46",
      secondaryColor: "#022c22",
      buttonColor: "#065f46",
      buttonTextColor: "#ffffff",
      linkColor: "#047857",
      accentColor: "#34d399",
      backgroundColor: "#ffffff",
      surfaceColor: "#ecfdf5",
      textColor: "#022c22",
      mutedTextColor: "#6b7280",
    },
  },
  {
    key: "luxury-gold-black",
    label: "Lüks Altın / Siyah",
    description: "Siyah zemin + altın vurgu — moda/mücevher/premium hizmet markaları için yüksek uçlu bir izlenim.",
    values: {
      primaryColor: "#18181b",
      secondaryColor: "#3f3f46",
      buttonColor: "#18181b",
      buttonTextColor: "#d4af37",
      linkColor: "#7c5e10",
      accentColor: "#d4af37",
      backgroundColor: "#fffdf7",
      surfaceColor: "#f5f0e6",
      textColor: "#1c1917",
      mutedTextColor: "#6b6459",
    },
  },
  {
    key: "minimalist-slate",
    label: "Minimalist Slate",
    description: "Nötr gri tonlar, sıfır renk gürültüsü — portföy/ajans/mimarlık siteleri için sade bir zemin.",
    values: {
      primaryColor: "#334155",
      secondaryColor: "#1e293b",
      buttonColor: "#334155",
      buttonTextColor: "#ffffff",
      linkColor: "#334155",
      accentColor: "#94a3b8",
      backgroundColor: "#ffffff",
      surfaceColor: "#f8fafc",
      textColor: "#0f172a",
      mutedTextColor: "#64748b",
    },
  },
  {
    key: "warm-terracotta",
    label: "Sıcak Toprak",
    description: "Toprak tonu turuncu-kahve + krem zemin — el yapımı/artisan/butik markalar için sıcak bir his.",
    values: {
      primaryColor: "#c2410c",
      secondaryColor: "#7c2d12",
      buttonColor: "#c2410c",
      buttonTextColor: "#ffffff",
      linkColor: "#c2410c",
      accentColor: "#b45309",
      backgroundColor: "#fffbf5",
      surfaceColor: "#fef3e8",
      textColor: "#292524",
      mutedTextColor: "#78716c",
    },
  },
  {
    key: "ocean-blue",
    label: "Okyanus Mavisi",
    description: "Camgöbeği-mavi tonları — turizm/lojistik/su ürünleri gibi 'temiz ve güvenilir' hissi gereken sektörler.",
    values: {
      primaryColor: "#0e7490",
      secondaryColor: "#164e63",
      buttonColor: "#0e7490",
      buttonTextColor: "#ffffff",
      linkColor: "#0e7490",
      accentColor: "#22d3ee",
      backgroundColor: "#ffffff",
      surfaceColor: "#ecfeff",
      textColor: "#083344",
      mutedTextColor: "#4b6b74",
    },
  },
  {
    key: "burgundy-executive",
    label: "Bordo Executive",
    description: "Koyu bordo + altın vurgu — hukuk bürosu/özel kulüp/üst düzey danışmanlık için otoriter bir ton.",
    values: {
      primaryColor: "#7f1d1d",
      secondaryColor: "#450a0a",
      buttonColor: "#7f1d1d",
      buttonTextColor: "#ffffff",
      linkColor: "#9f1239",
      accentColor: "#f59e0b",
      backgroundColor: "#ffffff",
      surfaceColor: "#fef2f2",
      textColor: "#2a0e10",
      mutedTextColor: "#7c5257",
    },
  },
  {
    key: "forest-green",
    label: "Orman Yeşili",
    description: "Derin orman yeşili + amber vurgu — outdoor/doğa/tarım/sürdürülebilir ürün markaları için organik bir his.",
    values: {
      primaryColor: "#14532d",
      secondaryColor: "#052e16",
      buttonColor: "#14532d",
      buttonTextColor: "#ffffff",
      linkColor: "#15803d",
      accentColor: "#ca8a04",
      backgroundColor: "#ffffff",
      surfaceColor: "#f0fdf4",
      textColor: "#052e16",
      mutedTextColor: "#6b7280",
    },
  },
];
