"use client";

import { useActiveLocaleCode } from "@/context/locale-alternates-context";
import { contentLocaleToIntl } from "./content-locale-to-intl";
import { MATCHER_DICTIONARIES, matcherStringsFor, type MatcherStrings } from "./matcher-dictionaries";

export { MATCHER_DICTIONARIES, matcherStringsFor };

/** Paket W — "Find my physician" sihirbazı metinleri (9 dil; `usePortalStrings` deseni). */
export function useMatcherStrings(): { m: MatcherStrings; lang: string; intlLocale: string } {
  const lang = useActiveLocaleCode();
  return { m: matcherStringsFor(lang), lang, intlLocale: contentLocaleToIntl(lang) };
}
