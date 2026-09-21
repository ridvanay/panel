/**
 * `.claude/architect-scope-i18n.md` §14.5 — `/doctors`, `/specialties` keşif yüzeyi + acil durum
 * uyarısı. Sihirbazın İÇİ (booking-wizard.tsx ve adım bileşenleri) BİLİNÇLİ OLARAK KAPSAM DIŞI
 * (Faz 2) — buradaki anahtarlar YALNIZCA Faz 1 listesindeki dosyalarda tüketilir.
 */
export const telehealthStrings = {
  /**
   * §14.7 — compliance-agent onaylı NİHAİ metin. `112` Türkiye'ye özeldir, İngilizce sürüm jenerik +
   * eyleme geçirilebilir örnek numaralarla (`tr/telehealth.ts`'teki metinle KARIŞTIRILMAZ).
   */
  emergencyNotice:
    "This platform must NOT be used for medical emergencies and is not a substitute for emergency medical care. In an emergency, call your local emergency number — for example 112 (Türkiye/EU), 911 (US/Canada), or 999 (UK) — or the relevant number for your country.",

  // --- /doctors ızgarası (madde 4/5/6) ---
  doctorsPageTitle: "Our Doctors",
  doctorsPageSubtitle: "Filter by specialty, choose a convenient time and book your online appointment.",
  doctorsEmptyTitle: "No results found",
  doctorsEmptyDescription: "No doctors match these filters. Try adjusting your filters.",
  searchPlaceholder: "Search by doctor name...",
  searchAriaLabel: "Search doctors",
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
  viewProfileCta: "View Profile",
  /** `doctor-quick-booking-card.tsx` — büyük CTA, `bookAppointmentCta`'dan BİLİNÇLİ OLARAK ayrı (kaynakta da farklı metin). */
  createAppointmentCta: "Book Appointment",
  /** `{years}` yer tutucusu. */
  experienceYearsBadge: "{years} Years of Experience",

  // --- doctor-profile-tabs.tsx (madde 9) ---
  tabAbout: "About the Doctor",
  tabCv: "CV",
  tabPublications: "Publications",
  tabExpertise: "Areas of Expertise",
  aboutEmpty: "No biography information has been shared for this doctor yet.",
  cvEmpty: "No CV information has been shared for this doctor yet.",
  publicationsEmpty: "No scientific publications have been shared for this doctor yet.",
  expertiseEmpty: "No area-of-expertise information has been shared for this doctor yet.",
  cvOngoing: "Ongoing",
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
  specialtiesPageSubtitle: "Discover our doctors by specialty and book your online appointment.",
  specialtiesEmptyTitle: "No specialty found",
  specialtiesEmptyDescription: "There are currently no specialties to list.",
  /** `{count}` yer tutucusu — tekil (1 doctor). */
  doctorCountOne: "{count} doctor",
  /** `{count}` yer tutucusu — çoğul (0, 2, 3... doctors). */
  doctorCountOther: "{count} doctors",
  specialtyDoctorsEmptyTitle: "No doctors found in this specialty",
  specialtyDoctorsEmptyDescription: "There are currently no published doctors in this specialty.",
} as const;

export type TelehealthStrings = Record<keyof typeof telehealthStrings, string>;
