import { cache } from "react";
import type { SiteDictionary, SiteUiLocale } from "./types";

export type { SiteDictionary, SiteUiLocale, CommonStrings, NavStrings, TelehealthStrings, LegalStrings, ErrorStrings, AboutStrings } from "./types";

/**
 * `.claude/architect-scope-i18n.md` §14.2 — KAYNAK dil. Bilinmeyen/sözlüğü olmayan bir dil
 * (`getSiteDictionary`, `hasSiteDictionary`) SESSİZCE buna düşer — DB locale kümesi (`GET /locales`)
 * deploy'suz genişleyebilir ama UI string kapsamı yalnızca deploy ile genişler (§14.2 tablo).
 */
export const SITE_UI_SOURCE_LOCALE = "en" satisfies SiteUiLocale;

const SITE_UI_LOCALES: readonly SiteUiLocale[] = ["en", "tr"];

export function hasSiteDictionary(lang: string): lang is SiteUiLocale {
  return (SITE_UI_LOCALES as readonly string[]).includes(lang);
}

const loaders: Record<SiteUiLocale, () => Promise<{ siteDictionary: SiteDictionary }>> = {
  en: () => import("./en"),
  tr: () => import("./tr"),
};

/**
 * `.claude/architect-scope-i18n.md` §14.3 — her sunucu bileşeni bunu KENDİSİ çağırır (prop drilling
 * ZORUNLU değildir), `React.cache` sayesinde istek başına yalnızca BİR kez çözümlenir. Asla
 * throw/404 ETMEZ — bilinmeyen `lang` sessizce `SITE_UI_SOURCE_LOCALE`'e düşer.
 */
export const getSiteDictionary = cache(async (lang: string): Promise<SiteDictionary> => {
  const locale = hasSiteDictionary(lang) ? lang : SITE_UI_SOURCE_LOCALE;
  const mod = await loaders[locale]();
  return mod.siteDictionary;
});

/**
 * Admin `t(key, params)`'in AYNI semantiği — sözlük değerleri YALNIZCA `string` olabildiği için
 * (§14.2 — RSC payload serialize kısıtı, fonksiyon değer YASAK) parametreli metinler `{param}`
 * yer tutucusuyla yazılır, bu yardımcı ile doldurulur.
 */
export function formatSiteString(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, key: string) => (key in params ? String(params[key]) : match));
}
