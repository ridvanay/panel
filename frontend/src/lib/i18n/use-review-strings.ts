"use client";

import { useActiveLocaleCode } from "@/context/locale-alternates-context";
import { contentLocaleToIntl } from "./content-locale-to-intl";
import { reviewsStrings as enReviews, type ReviewsStrings } from "./site-dictionaries/en/reviews";
import { reviewsStrings as trReviews } from "./site-dictionaries/tr/reviews";
import { reviewsStrings as esReviews } from "./site-dictionaries/es/reviews";
import { reviewsStrings as deReviews } from "./site-dictionaries/de/reviews";
import { reviewsStrings as arReviews } from "./site-dictionaries/ar/reviews";
import { reviewsStrings as ruReviews } from "./site-dictionaries/ru/reviews";
import { reviewsStrings as roReviews } from "./site-dictionaries/ro/reviews";
import { reviewsStrings as frReviews } from "./site-dictionaries/fr/reviews";
import { reviewsStrings as srLatnReviews } from "./site-dictionaries/sr-latn/reviews";

/**
 * Paket Y — hekim profili bölümleri, yorumlar, yorum formu ve karusel metinleri (client bileşenler).
 * `use-ui-strings.ts` ile AYNI desen: dil `LocaleAlternatesProvider`'dan okunur, sözlüğü olmayan dil EN'e düşer.
 */
const REVIEW_DICTIONARIES: Record<string, ReviewsStrings> = {
  en: enReviews,
  tr: trReviews,
  es: esReviews,
  de: deReviews,
  ar: arReviews,
  ru: ruReviews,
  ro: roReviews,
  fr: frReviews,
  "sr-latn": srLatnReviews,
};

export function useReviewStrings(): { t: ReviewsStrings; lang: string; intlLocale: string } {
  const lang = useActiveLocaleCode();
  return { t: REVIEW_DICTIONARIES[lang] ?? enReviews, lang, intlLocale: contentLocaleToIntl(lang) };
}

/** `{param}` yer tutucularını doldurur (sunucu modülünü client'a çekmemek için kopya). */
// Sunucu bileşenleri de kullanabilsin diye "use client" olmayan modülde (Paket AE).
export { fillReview } from "@/lib/review-format";
