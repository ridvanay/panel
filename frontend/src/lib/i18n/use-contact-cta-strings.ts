"use client";

import { useActiveLocaleCode } from "@/context/locale-alternates-context";
import { contactCtaStrings as enContactCta, type ContactCtaStrings } from "./site-dictionaries/en/contact-cta";
import { contactCtaStrings as trContactCta } from "./site-dictionaries/tr/contact-cta";
import { contactCtaStrings as esContactCta } from "./site-dictionaries/es/contact-cta";
import { contactCtaStrings as deContactCta } from "./site-dictionaries/de/contact-cta";
import { contactCtaStrings as arContactCta } from "./site-dictionaries/ar/contact-cta";
import { contactCtaStrings as ruContactCta } from "./site-dictionaries/ru/contact-cta";
import { contactCtaStrings as roContactCta } from "./site-dictionaries/ro/contact-cta";
import { contactCtaStrings as frContactCta } from "./site-dictionaries/fr/contact-cta";
import { contactCtaStrings as srLatnContactCta } from "./site-dictionaries/sr-latn/contact-cta";

/** Paket X — `ContactCta` ve iletişim düğmeleri metinleri (client); `use-review-strings.ts` ile aynı desen. */
const CONTACT_CTA_DICTIONARIES: Record<string, ContactCtaStrings> = {
  en: enContactCta,
  tr: trContactCta,
  es: esContactCta,
  de: deContactCta,
  ar: arContactCta,
  ru: ruContactCta,
  ro: roContactCta,
  fr: frContactCta,
  "sr-latn": srLatnContactCta,
};

export function useContactCtaStrings(): ContactCtaStrings {
  const lang = useActiveLocaleCode();
  return CONTACT_CTA_DICTIONARIES[lang] ?? enContactCta;
}
