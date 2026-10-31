import type { SiteDictionary } from "../types";
import { commonStrings } from "./common";
import { navStrings } from "./nav";
import { telehealthStrings } from "./telehealth";
import { legalStrings } from "./legal";
import { errorStrings } from "./errors";
import { aboutStrings } from "./about";
import { contactStrings } from "./contact";
import { homeStrings } from "./home";
import { portalStrings } from "./portal";
import { consentStrings } from "./consent";
import { uiStrings } from "./ui";
import { reviewsStrings } from "./reviews";

/** KAYNAK dil (source of truth, `.claude/architect-scope-i18n.md` §14.2) — yeni anahtar ÖNCE buraya. */
export const siteDictionary: SiteDictionary = {
  common: commonStrings,
  nav: navStrings,
  telehealth: telehealthStrings,
  legal: legalStrings,
  errors: errorStrings,
  about: aboutStrings,
  contact: contactStrings,
  home: homeStrings,
  portal: portalStrings,
  consent: consentStrings,
  ui: uiStrings,
  reviews: reviewsStrings,
};
