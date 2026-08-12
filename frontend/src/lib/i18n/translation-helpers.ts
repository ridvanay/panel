import type { ContentTranslations } from "@/lib/api/types";
import type { LocaleStatus } from "@/components/admin/locale-tabs";

/**
 * `pages`/`blog`/`products`/`portfolio` admin editörlerinde ORTAK çeviri alanı okuma/yazma +
 * durum hesaplama yardımcıları — her editörün kendi `getEnField`/`setEnField` KOPYASI yerine
 * (bkz. `.claude/architect-scope-i18n.md` §0.1a). Sabit `EN` yerine dinamik `locale` (küçük harf).
 */
export function getTranslatedField(translations: ContentTranslations, locale: string, key: string): string {
  const value = translations[locale]?.[key];
  return typeof value === "string" ? value : "";
}

export function setTranslatedField(
  setTranslations: (updater: (prev: ContentTranslations) => ContentTranslations) => void,
  locale: string,
  key: string,
  value: string
): void {
  setTranslations((prev) => ({ ...prev, [locale]: { ...(prev[locale] ?? {}), [key]: value } }));
}

function isFieldFilled(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  return typeof value === "string" && value.trim() !== "";
}

/**
 * Kaydedilmiş (snapshot) çeviriye göre durum — anlık taslak yazımı sekme ikonunu her tuş
 * vuruşunda titretmemeli (design-notes-i18n.md §2.3, appearance panelindeki AYNI ilke).
 */
export function computeLocaleStatus(translations: ContentTranslations, code: string, fieldKeys: string[]): LocaleStatus {
  const bucket = translations[code];
  if (!bucket) return "untranslated";
  const filledCount = fieldKeys.filter((key) => isFieldFilled(bucket[key])).length;
  if (filledCount === 0) return "untranslated";
  if (filledCount === fieldKeys.length) return "translated";
  return "partial";
}

export function localeStatusDetail(translations: ContentTranslations, code: string, fieldKeys: string[]): string {
  const bucket = translations[code] ?? {};
  const filledCount = fieldKeys.filter((key) => isFieldFilled(bucket[key])).length;
  return `${filledCount}/${fieldKeys.length} alan`;
}

/** Fallback göstergesi (§3): override yok AMA varsayılan dilde değer VAR. */
export function isFallbackField(translations: ContentTranslations, locale: string, key: string, canonicalValue: string): boolean {
  const own = translations[locale]?.[key];
  const hasOwn = typeof own === "string" && own.trim() !== "";
  return !hasOwn && canonicalValue.trim() !== "";
}
