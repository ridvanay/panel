import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { LOCALE_CODE_PATTERN } from "../../../lib/localization";
import { TelehealthThemeSettingsSchema } from "../../../schemas/entities";
import { parseTelehealthTheme } from "./theme-settings";

/**
 * Acil durum uyarısı ayarları — `SiteModule(key="telehealth").settings` JSON'unun `emergencyNotice`
 * alanında tutulur (şema/migration YOK; tema renkleriyle AYNI satır). Şekil:
 *
 *   { enabled: boolean, summary: { [locale]: string }, full: { [locale]: string } }
 *
 * - `enabled` YALNIZCA header altındaki şeridi (`EmergencyNoticeStrip`) kontrol eder; doktor detay
 *   sayfasındaki kart (`EmergencyNoticeCard`) bu anahtardan BAĞIMSIZ, her zaman gösterilir.
 *   Kayıt yoksa/bozuksa `true` (varsayılan AÇIK — mevcut kurulumlar da açık başlar).
 * - `summary`/`full` dil kodu başına admin metni; bir dilde metin yoksa frontend sözlükteki
 *   varsayılanı gösterir. Düz metindir (HTML reddedilir), React kaçışlayarak render eder.
 * - İçerik kuralı (compliance koşulu): EN metinler "emergency", TR metinler "acil" kelimesini
 *   (büyük/küçük harf duyarsız) İÇERMEK ZORUNDADIR — uyarının anlamını kaybetmesini önler. Diğer
 *   dillerde bu kontrol UYGULANMAZ.
 * - Değiştirme yetkisi YALNIZCA `SiteRole.ADMIN` (bkz. `telehealth.admin.routes.ts`).
 */
export const EMERGENCY_NOTICE_SUMMARY_MIN = 10;
export const EMERGENCY_NOTICE_SUMMARY_MAX = 90;
export const EMERGENCY_NOTICE_FULL_MIN = 20;
export const EMERGENCY_NOTICE_FULL_MAX = 300;
const MAX_LOCALES = 10;

/** `<a`, `</p`, `<!--`, `<?` gibi HTML/işaretleme başlangıçları — düz metin kuralı. */
const HTML_MARKUP_RE = /<\s*[a-z!/?]/i;

/** Dil → metinde bulunması zorunlu anahtar kelime. Listede olmayan dillerde kontrol yok. */
export const EMERGENCY_NOTICE_REQUIRED_KEYWORDS: Readonly<Record<string, string>> = { en: "emergency", tr: "acil" };

/**
 * Büyük/küçük harf duyarsız anahtar kelime kontrolü. Türkçe "ACİL" (noktalı İ) ve "ACIL" (ASCII I)
 * ikisi de kabul edilir — hem dilden bağımsız hem Türkçe küçük harfe çevirme denenir.
 */
export function hasRequiredKeyword(locale: string, value: string): boolean {
  const keyword = EMERGENCY_NOTICE_REQUIRED_KEYWORDS[locale];
  if (!keyword) return true;
  return value.toLowerCase().includes(keyword) || value.toLocaleLowerCase("tr").includes(keyword);
}

export function requiredKeywordMessage(locale: string): string {
  return `${locale.toUpperCase()} metni "${EMERGENCY_NOTICE_REQUIRED_KEYWORDS[locale]}" kelimesini içermelidir.`;
}

function isPlainTextWithin(value: string, min: number, max: number): boolean {
  const trimmed = value.trim();
  return trimmed.length >= min && trimmed.length <= max && !HTML_MARKUP_RE.test(trimmed);
}

const plainText = (min: number, max: number) =>
  z
    .string()
    .trim()
    .min(min, `En az ${min} karakter olmalıdır.`)
    .max(max, `En fazla ${max} karakter olabilir.`)
    .refine((value) => !HTML_MARKUP_RE.test(value), "HTML kullanılamaz; düz metin girin.");

/** Dil kodu → metin; `null` o dilin admin metnini siler (sitede sözlük varsayılanı görünür). */
const localeTextPatch = (min: number, max: number) =>
  z
    .record(z.string().regex(LOCALE_CODE_PATTERN, "Geçersiz dil kodu."), plainText(min, max).nullable())
    .refine((value) => Object.keys(value).length <= MAX_LOCALES, `En fazla ${MAX_LOCALES} dil.`)
    .superRefine((value, ctx) => {
      for (const [locale, text] of Object.entries(value)) {
        if (text !== null && !hasRequiredKeyword(locale, text)) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: [locale], message: requiredKeywordMessage(locale) });
        }
      }
    });

export const EmergencyNoticeSettingsSchema = z.object({
  enabled: z.boolean(),
  summary: z.record(z.string()),
  full: z.record(z.string()),
});
export type EmergencyNoticeSettings = z.infer<typeof EmergencyNoticeSettingsSchema>;

/** `PATCH /admin/telehealth/settings/emergency-notice` — kısmi güncelleme, en az bir alan zorunlu. */
export const UpdateEmergencyNoticeRequestSchema = z
  .object({
    enabled: z.boolean().optional(),
    summary: localeTextPatch(EMERGENCY_NOTICE_SUMMARY_MIN, EMERGENCY_NOTICE_SUMMARY_MAX).optional(),
    full: localeTextPatch(EMERGENCY_NOTICE_FULL_MIN, EMERGENCY_NOTICE_FULL_MAX).optional(),
  })
  .refine((body) => body.enabled !== undefined || body.summary !== undefined || body.full !== undefined, "Güncellenecek bir alan gönderin.");
export type UpdateEmergencyNoticeRequest = z.infer<typeof UpdateEmergencyNoticeRequestSchema>;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function validLocaleTexts(raw: unknown, min: number, max: number): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [locale, value] of Object.entries(asRecord(raw))) {
    if (!LOCALE_CODE_PATTERN.test(locale) || typeof value !== "string" || !isPlainTextWithin(value, min, max)) continue;
    // Kurala uymayan (ör. elle yazılmış eski) kayıt yok sayılır → o dilde sözlük varsayılanı.
    if (!hasRequiredKeyword(locale, value)) continue;
    out[locale] = value.trim();
  }
  return out;
}

/**
 * `SiteModule.settings` JSON'unun TAMAMINDAN uyarı ayarlarını okur. Tip güvencesi yoktur (Json);
 * bozuk/eksik/kurala uymayan değerler SESSİZCE atlanır (o dilde sözlük varsayılanı görünür),
 * `enabled` yalnızca açıkça `false` ise kapalıdır. ASLA hata fırlatmaz.
 */
export function parseEmergencyNotice(rawSettings: unknown): EmergencyNoticeSettings {
  const notice = asRecord(asRecord(rawSettings).emergencyNotice);
  return {
    enabled: notice.enabled !== false,
    summary: validLocaleTexts(notice.summary, EMERGENCY_NOTICE_SUMMARY_MIN, EMERGENCY_NOTICE_SUMMARY_MAX),
    full: validLocaleTexts(notice.full, EMERGENCY_NOTICE_FULL_MIN, EMERGENCY_NOTICE_FULL_MAX),
  };
}

function applyLocalePatch(current: Record<string, string>, patch: Record<string, string | null> | undefined): Record<string, string> {
  if (!patch) return current;
  const next = { ...current };
  for (const [locale, value] of Object.entries(patch)) {
    if (value === null) delete next[locale];
    else next[locale] = value;
  }
  return next;
}

/** Mevcut ayarlara kısmi güncellemeyi uygular (saf fonksiyon — birim testle doğrulanır). */
export function applyEmergencyNoticeUpdate(current: EmergencyNoticeSettings, patch: UpdateEmergencyNoticeRequest): EmergencyNoticeSettings {
  return {
    enabled: patch.enabled ?? current.enabled,
    summary: applyLocalePatch(current.summary, patch.summary),
    full: applyLocalePatch(current.full, patch.full),
  };
}

/**
 * `SiteModule.settings` JSON'unu güncellerken DİĞER alanları KORUR. Tema kaydı ve uyarı kaydı aynı
 * JSON'u paylaşır; biri kaydedilirken diğerinin silinmemesi için birleştirme her zaman ham mevcut
 * nesnenin üzerine yapılır (önceden tema kaydı JSON'u yalnızca tema alanlarına indirgiyordu).
 */
export function mergeTelehealthSettings(rawSettings: unknown, patch: Record<string, unknown>): Prisma.InputJsonObject {
  return { ...asRecord(rawSettings), ...patch } as Prisma.InputJsonObject;
}

/** Admin/public `telehealth` ayar yanıtı — tema renkleri + acil durum uyarısı. */
export const TelehealthSettingsResponseSchema = TelehealthThemeSettingsSchema.extend({
  emergencyNotice: EmergencyNoticeSettingsSchema,
});

export function toTelehealthSettingsDto(rawSettings: unknown): z.infer<typeof TelehealthSettingsResponseSchema> {
  return { ...parseTelehealthTheme(rawSettings), emergencyNotice: parseEmergencyNotice(rawSettings) };
}
