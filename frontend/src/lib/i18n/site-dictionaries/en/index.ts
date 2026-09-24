import type { SiteDictionary } from "../types";
import { commonStrings } from "./common";
import { navStrings } from "./nav";
import { telehealthStrings } from "./telehealth";
import { legalStrings } from "./legal";
import { errorStrings } from "./errors";
import { aboutStrings } from "./about";

/** KAYNAK dil (source of truth, `.claude/architect-scope-i18n.md` §14.2) — yeni anahtar ÖNCE buraya. */
export const siteDictionary: SiteDictionary = {
  common: commonStrings,
  nav: navStrings,
  telehealth: telehealthStrings,
  legal: legalStrings,
  errors: errorStrings,
  about: aboutStrings,
};
