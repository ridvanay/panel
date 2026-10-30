import { matcherStrings as en, type MatcherStrings } from "./en";
import { matcherStrings as tr } from "./tr";
import { matcherStrings as es } from "./es";
import { matcherStrings as de } from "./de";
import { matcherStrings as ar } from "./ar";
import { matcherStrings as ru } from "./ru";
import { matcherStrings as ro } from "./ro";
import { matcherStrings as fr } from "./fr";
import { matcherStrings as srLatn } from "./sr-latn";

/** Paket W — sihirbaz sözlükleri (9 dil). "use client" İÇERMEZ: hem istemci kancası hem sunucu sayfası kullanır. */
export const MATCHER_DICTIONARIES: Record<string, MatcherStrings> = { en, tr, es, de, ar, ru, ro, fr, "sr-latn": srLatn };

export function matcherStringsFor(lang: string): MatcherStrings {
  return MATCHER_DICTIONARIES[lang] ?? en;
}

export type { MatcherStrings };
