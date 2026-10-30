import { z } from "zod";
import { LOCALE_CODE_PATTERN } from "../../../lib/localization";

/**
 * Paket V (2026-10-30) — "Kendi dilinizde destek, ek ücret yok" bölümü. `SiteModule(key="telehealth")
 * .settings` JSON'unun `languageSupport` alanında tutulur (acil durum uyarısıyla AYNI satır; şema/
 * migration YOK). Şekil:
 *
 *   { supportLanguages: string[], supportHours: { [locale]: string }, interpreterIncluded: boolean }
 *
 * DOĞRULUK KURALI: sitede yalnızca `supportLanguages` içindeki diller listelenir; liste boşsa bölüm
 * (anasayfa bandı, profil/sihirbaz rozeti, footer satırı) HİÇ görünmez. "Tercüman ücretsiz" cümlesi
 * yalnızca `interpreterIncluded=true` iken gösterilir. Varsayılan: liste boş, bölüm kapalı.
 * Değiştirme yetkisi YALNIZCA `SiteRole.ADMIN` (hastaya verilen bir taahhüttür; acil durum uyarısıyla aynı).
 */
export const SUPPORT_LANGUAGES_MAX = 20;
export const SUPPORT_HOURS_MAX = 120;

const HTML_MARKUP_RE = /<\s*[a-z!/?]/i;
const localeCode = z.string().trim().toLowerCase().regex(LOCALE_CODE_PATTERN, "Geçersiz dil kodu.");

export const LanguageSupportSettingsSchema = z.object({
  supportLanguages: z.array(z.string()),
  supportHours: z.record(z.string()),
  interpreterIncluded: z.boolean(),
});
export type LanguageSupportSettings = z.infer<typeof LanguageSupportSettingsSchema>;

export const DEFAULT_LANGUAGE_SUPPORT: LanguageSupportSettings = { supportLanguages: [], supportHours: {}, interpreterIncluded: false };

/** `PATCH /admin/telehealth/settings/language-support` — kısmi güncelleme, en az bir alan zorunlu. */
export const UpdateLanguageSupportRequestSchema = z
  .object({
    supportLanguages: z
      .array(localeCode)
      .max(SUPPORT_LANGUAGES_MAX, `En fazla ${SUPPORT_LANGUAGES_MAX} dil.`)
      .refine((codes) => new Set(codes).size === codes.length, "Aynı dil iki kez seçilemez.")
      .optional(),
    /** Dil kodu → düz metin (ör. "Mon–Sat 09:00–21:00 (GMT+3)"); `null` o dilin metnini siler. */
    supportHours: z
      .record(
        z.string().regex(LOCALE_CODE_PATTERN, "Geçersiz dil kodu."),
        z
          .string()
          .trim()
          .min(1, "Boş bırakmak için alanı silin.")
          .max(SUPPORT_HOURS_MAX, `En fazla ${SUPPORT_HOURS_MAX} karakter.`)
          .refine((v) => !HTML_MARKUP_RE.test(v), "HTML kullanılamaz; düz metin girin.")
          .nullable()
      )
      .refine((v) => Object.keys(v).length <= SUPPORT_LANGUAGES_MAX, `En fazla ${SUPPORT_LANGUAGES_MAX} dil.`)
      .optional(),
    interpreterIncluded: z.boolean().optional(),
  })
  .strict()
  .refine(
    (b) => b.supportLanguages !== undefined || b.supportHours !== undefined || b.interpreterIncluded !== undefined,
    "Güncellenecek bir alan gönderin."
  );
export type UpdateLanguageSupportRequest = z.infer<typeof UpdateLanguageSupportRequestSchema>;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** Ham JSON'dan okur; bozuk/eksik değerler sessizce atlanır (varsayılan: kapalı). ASLA hata fırlatmaz. */
export function parseLanguageSupport(rawSettings: unknown): LanguageSupportSettings {
  const raw = asRecord(asRecord(rawSettings).languageSupport);
  const languages: string[] = [];
  if (Array.isArray(raw.supportLanguages)) {
    for (const code of raw.supportLanguages) {
      if (typeof code === "string" && LOCALE_CODE_PATTERN.test(code) && !languages.includes(code)) languages.push(code);
    }
  }
  const hours: Record<string, string> = {};
  for (const [locale, text] of Object.entries(asRecord(raw.supportHours))) {
    if (!LOCALE_CODE_PATTERN.test(locale) || typeof text !== "string") continue;
    const trimmed = text.trim();
    if (trimmed && trimmed.length <= SUPPORT_HOURS_MAX && !HTML_MARKUP_RE.test(trimmed)) hours[locale] = trimmed;
  }
  return {
    supportLanguages: languages.slice(0, SUPPORT_LANGUAGES_MAX),
    supportHours: hours,
    // Liste boşken "tercüman ücretsiz" de gösterilmez; yalnızca açıkça `true` ise.
    interpreterIncluded: raw.interpreterIncluded === true,
  };
}

/** Saf fonksiyon — birim testle doğrulanır. */
export function applyLanguageSupportUpdate(current: LanguageSupportSettings, patch: UpdateLanguageSupportRequest): LanguageSupportSettings {
  const hours = { ...current.supportHours };
  for (const [locale, text] of Object.entries(patch.supportHours ?? {})) {
    if (text === null) delete hours[locale];
    else hours[locale] = text;
  }
  return {
    supportLanguages: patch.supportLanguages ?? current.supportLanguages,
    supportHours: hours,
    interpreterIncluded: patch.interpreterIncluded ?? current.interpreterIncluded,
  };
}
