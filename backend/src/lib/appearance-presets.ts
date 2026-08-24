import type { SiteBorderRadius, SiteButtonStyle, SiteFont } from "@prisma/client";

/**
 * §10.12.3 Tema ön ayarları — kod içi statik registry, `MODULE_REGISTRY`/`PERMISSIONS_MATRIX` ile
 * AYNI patern (bkz. lib/module-registry.ts, lib/permissions-matrix.ts). DB tablosu YOKTUR —
 * kullanıcı ön ayar OLUŞTURAMAZ. Ön ayar uygulamak bir SUNUCU işlemi DEĞİLDİR: istemci burdan
 * değerleri alır, formu doldurur, kullanıcı Kaydet dediğinde normal `PATCH /admin/appearance`
 * gider. `presetKey` CANLI BİR BAĞ DEĞİLDİR (bkz. ARCHITECTURE.md §10.12.3).
 *
 * Ön ayarlar YALNIZCA renk ve tipografi taşır — görünüm anahtarlarını (bakım modu/çerez bandı),
 * 404 metinlerini veya özel kodu ASLA değiştirmezler.
 */
export interface AppearancePresetValues {
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
  headingFont: SiteFont;
  bodyFont: SiteFont;
  baseFontSize: number;
  borderRadius: SiteBorderRadius;
  buttonStyle: SiteButtonStyle;
}

export interface AppearancePresetDefinition {
  key: string;
  label: string;
  description: string;
  values: AppearancePresetValues;
}

export const APPEARANCE_PRESETS: AppearancePresetDefinition[] = [
  {
    key: "classic",
    label: "Klasik",
    description: "Dengeli kontrast, serif başlıklar — geleneksel/kurumsal bir görünüm.",
    values: {
      primaryColor: "#1d4ed8",
      secondaryColor: "#1f2937",
      buttonColor: "#1d4ed8",
      buttonTextColor: "#ffffff",
      linkColor: "#1d4ed8",
      // Geçici/makul değerler — ui-designer paleti gözden geçirip değiştirebilir (bkz.
      // .claude/architect-scope-theme-typography.md).
      accentColor: "#b45309",
      backgroundColor: "#ffffff",
      surfaceColor: "#f8fafc",
      textColor: "#1f2937",
      mutedTextColor: "#64748b",
      headingFont: "PLAYFAIR_DISPLAY",
      bodyFont: "SOURCE_SERIF_4",
      baseFontSize: 16,
      borderRadius: "MD",
      buttonStyle: "SOLID",
    },
  },
  {
    key: "modern",
    label: "Modern",
    description: "Yüksek kontrastlı, geniş boşluklu, sans-serif.",
    values: {
      primaryColor: "#4f46e5",
      secondaryColor: "#111827",
      buttonColor: "#4f46e5",
      buttonTextColor: "#ffffff",
      linkColor: "#4f46e5",
      // Geçici/makul değerler — ui-designer paleti gözden geçirip değiştirebilir.
      accentColor: "#f59e0b",
      backgroundColor: "#ffffff",
      surfaceColor: "#f9fafb",
      textColor: "#111827",
      mutedTextColor: "#6b7280",
      headingFont: "INTER",
      bodyFont: "INTER",
      baseFontSize: 16,
      borderRadius: "MD",
      buttonStyle: "SOLID",
    },
  },
  {
    key: "minimal",
    label: "Minimal",
    description: "Yumuşak nötr tonlar, sade tipografi, az görsel gürültü.",
    values: {
      primaryColor: "#0f172a",
      secondaryColor: "#475569",
      buttonColor: "#0f172a",
      buttonTextColor: "#ffffff",
      linkColor: "#0f172a",
      // Geçici/makul değerler — ui-designer paleti gözden geçirip değiştirebilir.
      accentColor: "#64748b",
      backgroundColor: "#ffffff",
      surfaceColor: "#f1f5f9",
      textColor: "#0f172a",
      mutedTextColor: "#64748b",
      headingFont: "SYSTEM",
      bodyFont: "SYSTEM",
      baseFontSize: 16,
      borderRadius: "MD",
      buttonStyle: "SOLID",
    },
  },
  {
    key: "modern-blue",
    label: "Modern Mavi",
    description: "Canlı, güvenilir mavi — SaaS/teknoloji ürünleri için temiz ve modern.",
    values: {
      primaryColor: "#2563eb",
      secondaryColor: "#1e3a8a",
      buttonColor: "#2563eb",
      buttonTextColor: "#ffffff",
      linkColor: "#2563eb",
      accentColor: "#38bdf8",
      backgroundColor: "#ffffff",
      surfaceColor: "#eff6ff",
      textColor: "#0f172a",
      mutedTextColor: "#64748b",
      headingFont: "PLUS_JAKARTA_SANS",
      bodyFont: "INTER",
      baseFontSize: 16,
      borderRadius: "LG",
      buttonStyle: "SOLID",
    },
  },
  {
    key: "corporate-navy",
    label: "Kurumsal Lacivert",
    description: "Lacivert + altın vurgu — finans/hukuk/kurumsal kimlikler için ciddi ton.",
    values: {
      primaryColor: "#1e3a8a",
      secondaryColor: "#0f172a",
      buttonColor: "#1e3a8a",
      buttonTextColor: "#ffffff",
      linkColor: "#1e40af",
      accentColor: "#ca8a04",
      backgroundColor: "#ffffff",
      surfaceColor: "#f1f5f9",
      textColor: "#0f172a",
      mutedTextColor: "#475569",
      headingFont: "INTER",
      bodyFont: "INTER",
      baseFontSize: 16,
      borderRadius: "SM",
      buttonStyle: "SOLID",
    },
  },
  {
    key: "emerald",
    label: "Zümrüt Yeşili",
    description: "Büyüme/doğa/sürdürülebilirlik temalı zümrüt yeşili, sıcak amber vurgu.",
    values: {
      primaryColor: "#047857",
      secondaryColor: "#065f46",
      buttonColor: "#047857",
      buttonTextColor: "#ffffff",
      linkColor: "#047857",
      accentColor: "#f59e0b",
      backgroundColor: "#ffffff",
      surfaceColor: "#f0fdf4",
      textColor: "#052e16",
      mutedTextColor: "#6b7280",
      headingFont: "OUTFIT",
      bodyFont: "INTER",
      baseFontSize: 16,
      borderRadius: "LG",
      buttonStyle: "SOLID",
    },
  },
  {
    key: "warm-terracotta",
    label: "Sıcak Toprak",
    description: "Toprak tonu turuncu-kahve + krem zemin — sıcak, el yapımı/artisan hissi.",
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
      headingFont: "LORA",
      bodyFont: "OPEN_SANS",
      baseFontSize: 16,
      borderRadius: "SM",
      buttonStyle: "SOFT",
    },
  },
];

export function getAppearancePreset(key: string): AppearancePresetDefinition | undefined {
  return APPEARANCE_PRESETS.find((preset) => preset.key === key);
}
