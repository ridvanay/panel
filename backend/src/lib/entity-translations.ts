import { z } from "zod";
import { LOCALE_CODE_PATTERN, applyFieldLocalization, resolveDefaultLocaleOverride, resolveEffectiveLocaleCode, type LocaleSet } from "./localization";

/**
 * Paket O (2026-10-23) — menü (`NavigationItem`), footer (`FooterColumn`/`FooterLink`) ve uzmanlık
 * (`Specialty`) için dil bazlı düz metin çevirileri: `translations = { "<dil>": { "<alan>": "..." } }`.
 * Kanonik kolonlar İngilizce (EN) metindir; aktif dilin çevirisi yoksa kanonik metin döner.
 * Varsayılan dil (TR) de kendi çevirisini `translations.tr` altında taşır (bkz. `resolveContentLocaleCode`).
 */

const MAX_LOCALES = 20;

/** Paket U (B2) — site ayarlarında çevrilebilen GÖRÜNEN metin alanları (alan → en fazla karakter). */
export const SITE_SETTINGS_TEXT_FIELDS = { tagline: 200, headerCtaLabel: 60, footerCopyrightText: 200 } as const;
export type SiteSettingsTextField = keyof typeof SITE_SETTINGS_TEXT_FIELDS;

/**
 * `{ "<dil>": { alan: metin } }` şeması. Bilinmeyen alan reddedilir (strict), metinler kırpılır,
 * boş alanlar ve boş diller atılır (boş = "çeviri yok" → kanonik metne düşer).
 */
export function textTranslationsSchema(fields: Record<string, number>) {
  const shape = Object.fromEntries(Object.entries(fields).map(([key, max]) => [key, z.string().trim().max(max).nullable().optional()]));
  return z
    .record(z.string().regex(LOCALE_CODE_PATTERN, "Geçersiz dil kodu."), z.object(shape).strict())
    .refine((map) => Object.keys(map).length <= MAX_LOCALES, `En fazla ${MAX_LOCALES} dil.`)
    .transform(compactTranslations);
}

export type TextTranslations = Record<string, Record<string, string>>;

export function compactTranslations(map: Record<string, Record<string, unknown>>): TextTranslations {
  const out: TextTranslations = {};
  for (const [locale, entry] of Object.entries(map)) {
    const fields = Object.fromEntries(
      Object.entries(entry ?? {}).filter((pair): pair is [string, string] => typeof pair[1] === "string" && pair[1].trim().length > 0)
    );
    if (Object.keys(fields).length > 0) out[locale] = fields;
  }
  return out;
}

/** DB'deki `translations` JSON'unu güvenli biçimde nesneye çevirir (bozuk veri → `{}`). */
export function readTranslations(value: unknown): TextTranslations {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return compactTranslations(value as Record<string, Record<string, unknown>>);
}

/**
 * İçerik dili: etkin bir dil istendiyse onun kodu — VARSAYILAN dil dahil (kanonik EN olduğu için TR
 * de kendi çevirisini uygular). Bilinmeyen/kapalı dil → `undefined` (kanonik metin, hata yok).
 */
export function resolveContentLocaleCode(localeSet: LocaleSet, requestedRaw?: string): string | undefined {
  return resolveEffectiveLocaleCode(localeSet, requestedRaw) ?? resolveDefaultLocaleOverride(localeSet, requestedRaw);
}

/** Aktif dilin çevirisi varsa ilgili alanları değiştirir; yoksa kanonik değerler kalır. */
export function localizeFields<T extends { translations: unknown }>(entity: T, locale: string | undefined, fields: readonly (keyof T & string)[]): T {
  if (!locale) return entity;
  return applyFieldLocalization(entity, locale, fields);
}
