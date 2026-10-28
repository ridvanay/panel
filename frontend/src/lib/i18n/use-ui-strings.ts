"use client";

import { useActiveLocaleCode } from "@/context/locale-alternates-context";
import { uiStrings as enUiStrings, type UiStrings } from "./site-dictionaries/en/ui";
import { uiStrings as trUiStrings } from "./site-dictionaries/tr/ui";
import { uiStrings as esUiStrings } from "./site-dictionaries/es/ui";
import { uiStrings as deUiStrings } from "./site-dictionaries/de/ui";
import { uiStrings as arUiStrings } from "./site-dictionaries/ar/ui";
import { uiStrings as ruUiStrings } from "./site-dictionaries/ru/ui";
import { uiStrings as roUiStrings } from "./site-dictionaries/ro/ui";
import { uiStrings as frUiStrings } from "./site-dictionaries/fr/ui";
import { uiStrings as srLatnUiStrings } from "./site-dictionaries/sr-latn/ui";

/**
 * Paket U (B4, 2026-10-28) — site UI'sının erişilebilirlik etiketleri (galeri, slider, video, yukarı
 * çık) ve canlı destek sohbeti metinleri. `use-auth-strings.ts` ile AYNI desen: dil
 * `LocaleAlternatesProvider` context'inden okunur; sözlüğü olmayan dil EN'e düşer.
 */
const UI_DICTIONARIES: Record<string, UiStrings> = {
  en: enUiStrings,
  tr: trUiStrings,
  es: esUiStrings,
  de: deUiStrings,
  ar: arUiStrings,
  ru: ruUiStrings,
  ro: roUiStrings,
  fr: frUiStrings,
  "sr-latn": srLatnUiStrings,
};

export function useUiStrings(): UiStrings {
  return UI_DICTIONARIES[useActiveLocaleCode()] ?? enUiStrings;
}

/** `{alt}`/`{n}`/`{rating}`/`{site}`/`{max}` yer tutucularını doldurur. */
export function fillUi(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => (key in values ? String(values[key]) : match));
}
