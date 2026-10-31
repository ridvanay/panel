"use client";

import { useActiveLocaleCode } from "@/context/locale-alternates-context";
import { packagesStrings as enPackages, type PackagesStrings } from "./site-dictionaries/en/packages";
import { packagesStrings as trPackages } from "./site-dictionaries/tr/packages";
import { packagesStrings as esPackages } from "./site-dictionaries/es/packages";
import { packagesStrings as dePackages } from "./site-dictionaries/de/packages";
import { packagesStrings as arPackages } from "./site-dictionaries/ar/packages";
import { packagesStrings as ruPackages } from "./site-dictionaries/ru/packages";
import { packagesStrings as roPackages } from "./site-dictionaries/ro/packages";
import { packagesStrings as frPackages } from "./site-dictionaries/fr/packages";
import { packagesStrings as srLatnPackages } from "./site-dictionaries/sr-latn/packages";

/** Paket X — sağlık paketleri metinleri (client); `use-contact-cta-strings.ts` ile aynı desen. */
export const PACKAGES_DICTIONARIES: Record<string, PackagesStrings> = {
  en: enPackages,
  tr: trPackages,
  es: esPackages,
  de: dePackages,
  ar: arPackages,
  ru: ruPackages,
  ro: roPackages,
  fr: frPackages,
  "sr-latn": srLatnPackages,
};

export function usePackagesStrings(): PackagesStrings {
  const lang = useActiveLocaleCode();
  return PACKAGES_DICTIONARIES[lang] ?? enPackages;
}
