"use client";

import { useCallback } from "react";
import { useActiveLocaleCode } from "@/context/locale-alternates-context";
import { ApiClientError } from "@/lib/api/error";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";
import { contentLocaleToIntl } from "./content-locale-to-intl";
import { portalStrings as enPortalStrings, type PortalStrings } from "./site-dictionaries/en/portal";
import { portalStrings as trPortalStrings } from "./site-dictionaries/tr/portal";
import { portalStrings as esPortalStrings } from "./site-dictionaries/es/portal";
import { portalStrings as dePortalStrings } from "./site-dictionaries/de/portal";
import { portalStrings as arPortalStrings } from "./site-dictionaries/ar/portal";
import { portalStrings as ruPortalStrings } from "./site-dictionaries/ru/portal";

/**
 * Paket A2 (2026-10-18) — hasta/doktor portalı, randevu sihirbazı ve başlıktaki kullanıcı menüsü
 * client bileşenlerinin metinleri. Dil, bu bileşenlerin ZATEN kullandığı `LocaleAlternatesProvider`
 * context'inden (`useActiveLocaleCode`) okunur — layout'lara yeni bir provider eklenmez. Sözlüğü
 * olmayan bir dil (ör. "de") `getSiteDictionary` ile AYNI şekilde kaynak dile (EN) düşer.
 *
 * Provider'ın OLMADIĞI tek yer admin panelidir (ör. `AppointmentStatusBadge` admin listesinde);
 * `useActiveLocaleCode` orada "tr" döner, admin paneli de bilerek Türkçe kalır.
 */
const PORTAL_DICTIONARIES: Record<string, PortalStrings> = {
  en: enPortalStrings,
  tr: trPortalStrings,
  es: esPortalStrings,
  de: dePortalStrings,
  ar: arPortalStrings,
  ru: ruPortalStrings,
};

export function usePortalStrings(): { t: PortalStrings; lang: string; intlLocale: string } {
  const lang = useActiveLocaleCode();
  return { t: PORTAL_DICTIONARIES[lang] ?? enPortalStrings, lang, intlLocale: contentLocaleToIntl(lang) };
}

/** `formatSiteString` ile AYNI `{param}` semantiği (sunucu modülünü client'a çekmemek için kopya). */
export function fmt(template: string, params: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => (key in params ? String(params[key]) : match));
}

/**
 * `fieldErrorsFrom(err)` sonucunu aktif dile uyarlar: TR'de sunucunun alan mesajları aynen kalır,
 * diğer dillerde her alan için genel "geçersiz değer" metni gösterilir.
 */
export function useLocalizedFieldErrors(): (fieldErrors: Record<string, string>) => Record<string, string> {
  const { t, lang } = usePortalStrings();
  return useCallback(
    (fieldErrors: Record<string, string>) =>
      lang === "tr" ? fieldErrors : Object.fromEntries(Object.keys(fieldErrors).map((field) => [field, t.errors.invalidField])),
    [t, lang]
  );
}

/**
 * Backend hata mesajları Türkçedir. TR'de mevcut davranış (`friendlyErrorMessage`, sunucunun
 * mesajı) korunur; diğer dillerde hata KODUNA göre sözlükten çevrilmiş metin, bilinmeyen kodda
 * genel bir mesaj gösterilir.
 */
export function useFriendlyError(): (err: unknown) => string {
  const { t, lang } = usePortalStrings();
  return useCallback(
    (err: unknown) => {
      if (lang === "tr") return friendlyErrorMessage(err);
      if (err instanceof ApiClientError) {
        const byCode = t.errors.byCode as Record<string, string>;
        return byCode[err.code] ?? t.errors.generic;
      }
      return t.errors.generic;
    },
    [t, lang]
  );
}
