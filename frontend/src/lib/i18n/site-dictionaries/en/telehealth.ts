/**
 * `.claude/architect-scope-i18n.md` §14.5 — `/doctors`, `/specialties` keşif yüzeyi + acil durum
 * uyarısı. Sihirbazın İÇİ (booking-wizard.tsx ve adım bileşenleri) BİLİNÇLİ OLARAK KAPSAM DIŞI
 * (Faz 2) — buradaki anahtarlar YALNIZCA Faz 1 listesindeki dosyalarda tüketilir.
 */
export const telehealthStrings = {
  /** Paket P (İş 3) — kurucu doktor rozeti. */
  founderBadge: "Founder",
  /** Paket P — doktor kartında en erken uygun randevu günü. */
  earliestShortLabel: "Earliest: {date}",
  /**
   * Acil durum uyarısı — VARSAYILAN metinler (ürün sahibinin 2026-09-25 kararı; admin → TeleHealth
   * ayarlarında dil başına değiştirilebilir, admin alanı boşsa bunlar gösterilir). `Summary`:
   * header altındaki şeridin kapalı hâli (tek satırlık özet); `Full`: şeridin açık hâli ve doktor
   * detay sayfasındaki kart (her zaman tam metin). Sınırlar: özet 10–90, tam metin 20–300 karakter;
   * EN metinler "emergency" kelimesini içermelidir (TR sözlükte "acil").
   */
  emergencyNoticeSummary: "Not for emergencies. In an emergency, call your local emergency number.",
  emergencyNoticeFull:
    "This platform is not for emergencies and is not a substitute for emergency medical care. In an emergency, call your local emergency number (112 in Türkiye/EU, 911 in the US/Canada, 999 in the UK).",
  /** Şeridi açan/kapatan düğme. */
  emergencyNoticeShowDetails: "Details",
  emergencyNoticeHideDetails: "Hide details",

  // --- /doctors ızgarası (madde 4/5/6) ---
  doctorsPageTitle: "Physicians",
  doctorsPageSubtitle: "Filter by specialty, choose a convenient time and book your online appointment.",
  doctorsEmptyTitle: "No results found",
  doctorsEmptyDescription: "No physicians match these filters. Try adjusting your filters.",
  searchPlaceholder: "Search by physician name...",
  searchAriaLabel: "Search physicians",
  specialtyFilterAriaLabel: "Filter by specialty",
  languageFilterAriaLabel: "Filter by language",
  allSpecialties: "All specialties",
  allLanguages: "All languages",

  // --- doctor-card.tsx / doctor-profile-hero.tsx ortak etiketler (madde 7/9) ---
  /** Kart üzerindeki görünür rozet — Title Case. */
  verifiedPhysicianBadge: "Verified Physician",
  /** Yalnızca ekran okuyucu için sr-only metin — cümle içi doğal küçük harf. */
  verifiedPhysicianSrOnly: "Verified physician",
  /** `doctor-card.tsx` — uzmanlık yoksa kısa jenerik ad. */
  generalSpecialty: "General",
  /** `doctor-profile-hero.tsx` — uzmanlık yoksa hero rozetindeki uzun jenerik ad. */
  generalConsultationSpecialty: "General Consultation",
  /** `{languages}` yer tutucusu — konuşulan diller listesi. */
  spokenLanguagesAriaLabel: "Languages spoken: {languages}",
  /** `{minutes}` yer tutucusu — seans süresi (ör. "30 min"). */
  sessionDurationLabel: "{minutes} min",
  /** `doctor.sessionPriceCents === null` — ücret bilgisi tanımlanmamış doktorlarda fiyat yerine gösterilir. */
  freeSessionLabel: "Free / Contact for pricing",
  bookAppointmentCta: "Book Appointment",
  viewProfileCta: "View physician",
  /** `doctor-quick-booking-card.tsx` — büyük CTA, `bookAppointmentCta`'dan BİLİNÇLİ OLARAK ayrı (kaynakta da farklı metin). */
  createAppointmentCta: "Book Appointment",
  /** `{years}` yer tutucusu. */
  socialLinksAriaLabel: "Social media and web links",
  experienceYearsBadge: "{years} Years of Experience",

  // --- doctor-profile-tabs.tsx (madde 9) ---
  tabAbout: "About the Physician",
  tabCv: "CV",
  tabPublications: "Publications",
  tabExpertise: "Areas of Expertise",
  aboutEmpty: "No biography information has been shared for this physician yet.",
  cvEmpty: "No CV information has been shared for this physician yet.",
  publicationsEmpty: "No scientific publications have been shared for this physician yet.",
  expertiseEmpty: "No area-of-expertise information has been shared for this physician yet.",
  cvOngoing: "Ongoing",
  /** Paket L — CV kalemine ekli belge (sertifika PDF'i), yeni sekmede açılır. */
  cvViewCertificate: "View certificate",
  publicationInternational: "International Articles",
  publicationNational: "National Articles",
  publicationProceeding: "Proceedings",
  publicationBookChapter: "Book Chapters",
  publicationOther: "Other Publications",
  viewSource: "View Source",
  expertiseAreaLabel: "Area of Expertise",
  certificationsLabel: "Certifications & Memberships",

  // --- doctor-quick-booking-card.tsx (madde 9) ---
  quickBookingLabel: "Online Consultation / Book Appointment",
  /** `{minutes}` yer tutucusu — ör. "/ 30 min". */
  perUnitDurationSuffix: "/ {minutes} min",
  earliestAppointmentLabel: "Earliest appointment:",
  noAvailableAppointment: "No appointments currently available.",
  securePaymentNotice: "Secure Payment & Data Protection Compliant",
  recordingSupportNotice: "Session Recording & Medical Report Support",

  // --- doctor-service-summary.tsx (madde 9, dict OPSİYONEL — booking-wizard.tsx Faz 2 kapsamında) ---
  serviceSummaryLabel: "Service Summary",
  /** `{specialty}` yer tutucusu. */
  sessionWithSpecialtyLabel: "{specialty} Session",
  selectedAppointmentLabel: "Selected Appointment",
  changeAction: "Change",
  /** `doctor-service-summary.tsx` hizmet satırı — `sessionDurationLabel`'dan BİLİNÇLİ AYRI (kaynakta farklı biçim: "Dk."). */
  serviceDurationLabel: "{minutes} min",
  selectDateTimePrompt: "Select date and time",
  /** `{time}` yer tutucusu. */
  removeSlotAriaLabel: "Remove {time} slot",
  /** `{count}`/`{minutes}` yer tutucuları. */
  slotSummaryLabel: "{count} Slot · {minutes} min",
  perSessionPriceSuffix: "/ session",
  /** `{unitPrice} × {count} {sessionsUnitWord}` — çoklu seans fiyat dökümü satırı. */
  sessionsUnitWord: "sessions",
  totalLabel: "Total",
  continueCta: "Continue",
  /** `{current}` yer tutucusu. */
  stepProgressLabel: "Step {current} / 5",

  // --- doctors/[slug]/page.tsx sayfa chrome'u (madde 8) ---
  availabilityAndBookingTitle: "Availability and Booking",

  // --- /specialties (madde 10) ---
  specialtiesPageTitle: "Our Areas of Expertise",
  // Paket U (B4) — sayfa meta açıklamaları (önceden tüm dillerde Türkçe sabit metindi).
  doctorsMetaDescription: "Book an online consultation with our physicians in specialties such as {specialties}.",
  doctorsMetaDescriptionDefault: "Book an online consultation with our physicians.",
  specialtiesMetaDescription: "Explore our physicians in specialties such as {specialties}.",
  specialtiesMetaDescriptionDefault: "Explore our specialties and book an online consultation.",
  specialtyMetaDescription: "Book an online consultation with our physicians in {specialty}.",
  specialtiesPageSubtitle: "Discover our physicians by specialty and book your online appointment.",
  specialtiesEmptyTitle: "No specialty found",
  specialtiesEmptyDescription: "There are currently no specialties to list.",
  /** `{count}` yer tutucusu — tekil (1 doctor). */
  doctorCountOne: "{count} physician",
  /** `{count}` yer tutucusu — çoğul (0, 2, 3... doctors). */
  doctorCountOther: "{count} physicians",
  specialtyDoctorsEmptyTitle: "No physicians found in this specialty",
  specialtyDoctorsEmptyDescription: "There are currently no published physicians in this specialty.",
  /** Paket V — hekimi olmayan uzmanlık sayfasında doktor listesinin yerine. */
  specialtyCoordinatorTitle: "Let our coordinator find the right physician for you",
  specialtyCoordinatorText: "Tell us about your situation and a patient coordinator will match you with a suitable physician in this field.",

  // --- Öne Çıkan Doktorlar carousel'i (Paket D) ---
  featuredDoctorsCarouselLabel: "Featured physicians",
  featuredDoctorsPrevious: "Previous physicians",
  featuredDoctorsNext: "Next physicians",
  /** `{page}`/`{total}` yer tutucuları. */
  featuredDoctorsPause: "Pause automatic scrolling",
  featuredDoctorsPlay: "Resume automatic scrolling",
  featuredDoctorsGoToPage: "Page {page} of {total}",
  // --- Paket AE: sadeleştirilmiş hekim profili ---
  keyFactsTitle: "Key facts",
  keyFactsExperience: "Experience",
  keyFactsExperienceValue: "{years} years",
  keyFactsLanguages: "Languages",
  keyFactsPublications: "Publications",
  keyFactsProcedures: "Procedures",
  keyFactsRating: "Patient rating",
  keyFactsRatingValue: "{average} / 5 ({count})",
  overviewReadMore: "Read more",
  overviewReadLess: "Show less",
  overviewFeaturedExpertise: "Featured areas of expertise",
  overviewViewAll: "View all",
  overviewViewAllAria: "View all: {section}",
  overviewLatestReviews: "Latest patient reviews",
  pubSearchLabel: "Search publications",
  pubSearchPlaceholder: "Title, author or journal",
  pubYearLabel: "Year",
  pubAllYears: "All years",
  pubShowAll: "Show all ({count})",
  pubShowLess: "Show fewer",
  pubNoResults: "No publications match your search.",
  videoUnsupported: "Your browser cannot play this video.",
  bookingPanelHint: "Choose a date and time, then complete your booking here.",
  bookingPanelHide: "Hide booking form",
} as const;

export type TelehealthStrings = Record<keyof typeof telehealthStrings, string>;
