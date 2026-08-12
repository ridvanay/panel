import type { SiteFont } from "@prisma/client";

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
  headingFont: SiteFont;
  bodyFont: SiteFont;
  baseFontSize: number;
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
      headingFont: "PLAYFAIR_DISPLAY",
      bodyFont: "SOURCE_SERIF_4",
      baseFontSize: 16,
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
      headingFont: "INTER",
      bodyFont: "INTER",
      baseFontSize: 16,
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
      headingFont: "SYSTEM",
      bodyFont: "SYSTEM",
      baseFontSize: 16,
    },
  },
];

export function getAppearancePreset(key: string): AppearancePresetDefinition | undefined {
  return APPEARANCE_PRESETS.find((preset) => preset.key === key);
}
