/**
 * "Anasayfa" şablonu (`home-page` bloğu) — KAYNAK dil (`en`). Ürün sahibinin verdiği varsayılan
 * metinler; admin'de alan boşsa bunlar gösterilir. "Yeni Sayfa → Anasayfa şablonu" da sayfayı bu
 * metinlerle doldurarak oluşturur (bkz. `lib/home-page.ts::buildDefaultHomeContent`).
 */
export const homeStrings = {
  // --- Hero ---
  heroEyebrow: "Telehealth consultation",
  heroTitle: "Book a video consultation with top specialists",
  heroBody: "Book in a few clicks and meet your doctor in a secure video consultation — without leaving home.",
  heroPrimaryCta: "Find a doctor",
  heroSecondaryCta: "How it works",
  heroCardTitle: "Secure video consultation",
  heroCardText: "Join from your browser",

  // --- Trust strip ---
  trust1Title: "24/7 access",
  trust1Text: "Find an available doctor and book an appointment at a time that suits you.",
  trust2Title: "Encrypted consultations",
  trust2Text: "Video consultations take place over an encrypted connection.",
  trust3Title: "Verified profiles",
  trust3Text: "Published doctor profiles go through identity and diploma verification.",

  // --- Specialties ---
  specialtiesEyebrow: "Specialties",
  specialtiesTitle: "Find care by specialty",
  specialtiesViewAll: "View all specialties",

  // --- How it works ---
  howEyebrow: "How it works",
  howTitle: "Three steps to your consultation",
  step1Title: "Choose a doctor",
  step1Text: "Filter by specialty and language, and review doctor profiles.",
  step2Title: "Book a time",
  step2Text: "Pick an available slot and complete your booking online.",
  step3Title: "Join the video call",
  step3Text: "At your appointment time, join the consultation from your browser.",
  /** Ekran okuyucu için adım numarası — `{number}` yer tutucusu. */
  stepLabel: "Step {number}",

  // --- Doctors ---
  doctorsEyebrow: "Our medical team",
  doctorsTitle: "Meet our doctors",
  doctorsCta: "View all doctors",

  // --- Closing band ---
  closingTitle: "Start with a consultation",
  closingPrimaryCta: "Find a doctor",
  closingSecondaryCta: "Contact us",
} as const;

export type HomeStrings = Record<keyof typeof homeStrings, string>;
