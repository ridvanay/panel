"use client";

import { useActiveLocaleCode } from "@/context/locale-alternates-context";
import { authStrings as enAuthStrings, type AuthStrings } from "./site-dictionaries/en/auth";
import { authStrings as trAuthStrings } from "./site-dictionaries/tr/auth";
import { authStrings as esAuthStrings } from "./site-dictionaries/es/auth";
import { authStrings as deAuthStrings } from "./site-dictionaries/de/auth";
import { authStrings as arAuthStrings } from "./site-dictionaries/ar/auth";
import { authStrings as ruAuthStrings } from "./site-dictionaries/ru/auth";
import { authStrings as roAuthStrings } from "./site-dictionaries/ro/auth";
import { authStrings as frAuthStrings } from "./site-dictionaries/fr/auth";
import { authStrings as srLatnAuthStrings } from "./site-dictionaries/sr-latn/auth";

/**
 * Paket O — giriş/kayıt/şifre/doğrulama ekranları ve doktor girişi metinleri. Dil `usePortalStrings`
 * ile AYNI kaynaktan (`LocaleAlternatesProvider`) okunur; `(auth)` layout'u bu sağlayıcıyı proxy'nin
 * belirlediği dille kurar. Sözlüğü olmayan dil kaynak dile (EN) düşer.
 */
const AUTH_DICTIONARIES: Record<string, AuthStrings> = {
  en: enAuthStrings,
  tr: trAuthStrings,
  es: esAuthStrings,
  de: deAuthStrings,
  ar: arAuthStrings,
  ru: ruAuthStrings,
  ro: roAuthStrings,
  fr: frAuthStrings,
  "sr-latn": srLatnAuthStrings,
};

export function useAuthStrings(): AuthStrings {
  return AUTH_DICTIONARIES[useActiveLocaleCode()] ?? enAuthStrings;
}

/** `{name}` yer tutucularını React düğümleriyle doldurur (ör. kalın e-posta, bağlantılar). */
export function splitTemplate<T>(template: string, nodes: Record<string, T>): (string | T)[] {
  return template.split(/(\{\w+\})/g).map((part) => {
    const match = /^\{(\w+)\}$/.exec(part);
    return match && match[1]! in nodes ? nodes[match[1]!]! : part;
  });
}
