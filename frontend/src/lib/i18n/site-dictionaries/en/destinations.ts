/**
 * Paket X — anasayfa "Top destinations" bölümü. KAYNAK dil; diğer 8 dil aynı anahtarlara sahip olmalı.
 * `{site}` site adıyla, `{count}` hasta sayısıyla, `{price}` biçimlenmiş fiyatla değiştirilir.
 */
export const destinationsStrings = {
  sectionTitle: "Top destinations",
  sectionIntro: "Where {site} patients travelled most in the past year, with typical starting prices.",
  patientsLastYear: "Patients last year: {count}",
  fromPrice: "from {price}",
  priceNote: "Prices are indicative starting prices; final price after medical evaluation.",
  treatmentsLabel: "Popular treatments",
  explorePackages: "Explore health packages",
} as const;

export type DestinationsStrings = Record<keyof typeof destinationsStrings, string>;
