import type { EmergencyNoticeSettings, TelehealthThemeSettings } from "@/lib/api/types";
import type { TelehealthStrings } from "@/lib/i18n/site-dictionaries";

/**
 * Acil durum uyarısı — backend `modules/telehealth/lib/emergency-notice.ts` ile AYNI sınırlar
 * (ayna; asıl doğrulama backend'dedir, burası admin formunun anında geri bildirimi içindir).
 */
export const EMERGENCY_NOTICE_SUMMARY_MIN = 10;
export const EMERGENCY_NOTICE_SUMMARY_MAX = 90;
export const EMERGENCY_NOTICE_FULL_MIN = 20;
export const EMERGENCY_NOTICE_FULL_MAX = 300;
/** Dil → metinde bulunması zorunlu kelime (backend `EMERGENCY_NOTICE_REQUIRED_KEYWORDS` aynası). */
export const EMERGENCY_NOTICE_REQUIRED_KEYWORDS: Readonly<Record<string, string>> = { en: "emergency", tr: "acil" };
const HTML_MARKUP_RE = /<\s*[a-z!/?]/i;

export const DEFAULT_EMERGENCY_NOTICE_SETTINGS: EmergencyNoticeSettings = { enabled: true, summary: {}, full: {} };

export interface ResolvedEmergencyNotice {
  /** Header altındaki şerit gösterilsin mi (doktor detay kartı bundan BAĞIMSIZ, her zaman gösterilir). */
  stripEnabled: boolean;
  summary: string;
  full: string;
  showDetailsLabel: string;
  hideDetailsLabel: string;
}

function localeText(map: Record<string, string> | undefined, lang: string, fallback: string): string {
  const value = map?.[lang];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
}

/**
 * Aktif dilin metinleri: o dilde admin metni varsa o, yoksa sözlük varsayılanı (`dict` zaten aktif
 * dilin sözlüğüdür — sözlüğü olmayan diller İngilizceye düşer). Ayar eksik/bozuksa şerit AÇIK.
 */
export function resolveEmergencyNotice(
  settings: Pick<TelehealthThemeSettings, "emergencyNotice"> | null | undefined,
  lang: string,
  dict: Pick<TelehealthStrings, "emergencyNoticeSummary" | "emergencyNoticeFull" | "emergencyNoticeShowDetails" | "emergencyNoticeHideDetails">
): ResolvedEmergencyNotice {
  const notice = settings?.emergencyNotice ?? DEFAULT_EMERGENCY_NOTICE_SETTINGS;
  return {
    stripEnabled: notice.enabled !== false,
    summary: localeText(notice.summary, lang, dict.emergencyNoticeSummary),
    full: localeText(notice.full, lang, dict.emergencyNoticeFull),
    showDetailsLabel: dict.emergencyNoticeShowDetails,
    hideDetailsLabel: dict.emergencyNoticeHideDetails,
  };
}

/** Büyük/küçük harf duyarsız; Türkçe "ACİL"/"ACIL" ikisi de kabul. EN/TR dışındaki dillerde kontrol yok. */
export function hasRequiredKeyword(locale: string, value: string): boolean {
  const keyword = EMERGENCY_NOTICE_REQUIRED_KEYWORDS[locale];
  if (!keyword) return true;
  return value.toLowerCase().includes(keyword) || value.toLocaleLowerCase("tr").includes(keyword);
}

/** Admin formu için anında doğrulama — `null` = geçerli, aksi halde Türkçe hata mesajı. */
export function validateEmergencyNoticeText(value: string, kind: "summary" | "full", locale?: string): string | null {
  const [min, max] = kind === "summary" ? [EMERGENCY_NOTICE_SUMMARY_MIN, EMERGENCY_NOTICE_SUMMARY_MAX] : [EMERGENCY_NOTICE_FULL_MIN, EMERGENCY_NOTICE_FULL_MAX];
  const trimmed = value.trim();
  if (trimmed.length === 0) return "Bu alan boş bırakılamaz.";
  if (trimmed.length < min) return `En az ${min} karakter olmalıdır.`;
  if (trimmed.length > max) return `En fazla ${max} karakter olabilir.`;
  if (HTML_MARKUP_RE.test(trimmed)) return "HTML kullanılamaz; düz metin girin.";
  if (locale && !hasRequiredKeyword(locale, trimmed)) {
    const keyword = EMERGENCY_NOTICE_REQUIRED_KEYWORDS[locale];
    return `Metin "${keyword}" kelimesini içermelidir — uyarının acil durumlarla ilgili olduğu açıkça anlaşılmalı.`;
  }
  return null;
}
