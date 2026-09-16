import type { CommonStrings } from "./en/common";
import type { NavStrings } from "./en/nav";
import type { TelehealthStrings } from "./en/telehealth";
import type { LegalStrings } from "./en/legal";
import type { ErrorStrings } from "./en/errors";

/**
 * `.claude/architect-scope-i18n.md` §14.2 — public site UI STRING KAPSAMI. `Locale.code`
 * (DB locale kümesi, `GET /locales`) İLE KARIŞTIRILMAZ (§14.2 tablo) — bu, repo'daki
 * `site-dictionaries/<code>/` klasörlerinin kapsadığı, yalnızca DEPLOY ile genişleyen kümedir.
 */
export type SiteUiLocale = "en" | "tr";

export type SiteDictionary = {
  common: CommonStrings;
  nav: NavStrings;
  telehealth: TelehealthStrings;
  legal: LegalStrings;
  errors: ErrorStrings;
};

export type { CommonStrings, NavStrings, TelehealthStrings, LegalStrings, ErrorStrings };
