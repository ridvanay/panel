import type { CommonStrings } from "./en/common";
import type { NavStrings } from "./en/nav";
import type { TelehealthStrings } from "./en/telehealth";
import type { LegalStrings } from "./en/legal";
import type { ErrorStrings } from "./en/errors";
import type { AboutStrings } from "./en/about";
import type { ContactStrings } from "./en/contact";
import type { HomeStrings } from "./en/home";
import type { PortalStrings } from "./en/portal";
import type { ConsentStrings } from "./en/consent";
import type { UiStrings } from "./en/ui";

/**
 * `.claude/architect-scope-i18n.md` §14.2 — public site UI STRING KAPSAMI. `Locale.code`
 * (DB locale kümesi, `GET /locales`) İLE KARIŞTIRILMAZ (§14.2 tablo) — bu, repo'daki
 * `site-dictionaries/<code>/` klasörlerinin kapsadığı, yalnızca DEPLOY ile genişleyen kümedir.
 */
// Paket T — ro/fr ve Sırpça Latin (`sr-latn`; Intl etiketi `sr-Latn-RS`).
export type SiteUiLocale = "en" | "tr" | "es" | "de" | "ar" | "ru" | "ro" | "fr" | "sr-latn";

export type SiteDictionary = {
  common: CommonStrings;
  nav: NavStrings;
  telehealth: TelehealthStrings;
  legal: LegalStrings;
  errors: ErrorStrings;
  about: AboutStrings;
  contact: ContactStrings;
  home: HomeStrings;
  portal: PortalStrings;
  consent: ConsentStrings;
  /** Paket U (B4) — erişilebilirlik etiketleri + canlı destek sohbeti. */
  ui: UiStrings;
};

export type { CommonStrings, NavStrings, TelehealthStrings, LegalStrings, ErrorStrings, AboutStrings, ContactStrings, HomeStrings, PortalStrings, ConsentStrings, UiStrings };
