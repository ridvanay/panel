"use client";

import { useActiveLocaleCode } from "@/context/locale-alternates-context";
import { consultationStrings as enConsultation, type ConsultationStrings } from "./site-dictionaries/en/consultation";
import { consultationStrings as trConsultation } from "./site-dictionaries/tr/consultation";
import { consultationStrings as esConsultation } from "./site-dictionaries/es/consultation";
import { consultationStrings as deConsultation } from "./site-dictionaries/de/consultation";
import { consultationStrings as arConsultation } from "./site-dictionaries/ar/consultation";
import { consultationStrings as ruConsultation } from "./site-dictionaries/ru/consultation";
import { consultationStrings as roConsultation } from "./site-dictionaries/ro/consultation";
import { consultationStrings as frConsultation } from "./site-dictionaries/fr/consultation";
import { consultationStrings as srLatnConsultation } from "./site-dictionaries/sr-latn/consultation";

/** `{param}` yer tutucularını doldurur (sunucu sözlüğündeki `formatSiteString` ile aynı semantik; o modülü client'a çekmemek için kopya). */
export function fmt(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, key: string) => (key in params ? String(params[key]) : match));
}

/** Paket AF — video görüşme odası metinleri (client); `use-contact-cta-strings.ts` ile aynı desen. */
export const CONSULTATION_DICTIONARIES: Record<string, ConsultationStrings> = {
  en: enConsultation,
  tr: trConsultation,
  es: esConsultation,
  de: deConsultation,
  ar: arConsultation,
  ru: ruConsultation,
  ro: roConsultation,
  fr: frConsultation,
  "sr-latn": srLatnConsultation,
};

/**
 * Bilinmeyen dil kodu İngilizceye düşer (diğer sözlük kancalarıyla aynı). Bağlam yoksa `useActiveLocaleCode`
 * "tr" döner — mevcut Türkçe metinler bağlamsız durumda aynen korunur.
 */
export function useConsultationStrings(): { t: ConsultationStrings; fmt: typeof fmt; lang: string } {
  const lang = useActiveLocaleCode();
  return { t: CONSULTATION_DICTIONARIES[lang] ?? enConsultation, fmt, lang };
}
