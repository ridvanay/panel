import type { SiteDictionary } from "../types";
import { commonStrings } from "./common";
import { navStrings } from "./nav";
import { telehealthStrings } from "./telehealth";
import { legalStrings } from "./legal";
import { errorStrings } from "./errors";
import { aboutStrings } from "./about";
import { contactStrings } from "./contact";
import { homeStrings } from "./home";

export const siteDictionary: SiteDictionary = {
  common: commonStrings,
  nav: navStrings,
  telehealth: telehealthStrings,
  legal: legalStrings,
  errors: errorStrings,
  about: aboutStrings,
  contact: contactStrings,
  home: homeStrings,
};
