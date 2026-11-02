/**
 * "Anasayfa" şablonu (`home-page` bloğu) — KAYNAK dil (`en`). Ürün sahibinin verdiği varsayılan
 * metinler; admin'de alan boşsa bunlar gösterilir. "Yeni Sayfa → Anasayfa şablonu" da sayfayı bu
 * metinlerle doldurarak oluşturur (bkz. `lib/home-page.ts::buildDefaultHomeContent`).
 */
export const homeStrings = {
  // --- Hero ---
  heroEyebrow: "International health tourism",
  heroTitle: "Plan your treatment in Türkiye with a dedicated patient coordinator",
  heroBody: "Tell us which service you need. A patient coordinator arranges your treatment at an authorized healthcare facility, your travel and your stay.",
  heroPrimaryCta: "Request a consultation",
  heroSecondaryCta: "How it works",
  heroCardTitle: "Patient coordinator",
  heroCardText: "Reply within 1 business day",

  // --- Trust strip ---
  trust1Title: "Dedicated coordinator",
  trust1Text: "A patient coordinator supports you before, during and after your visit.",
  trust2Title: "Secure handling of your data",
  trust2Text: "Your request is sent over an encrypted connection and handled with care.",
  trust3Title: "Authorized facilities",
  trust3Text: "Treatments are performed by facilities holding an International Health Tourism Authorization Certificate.",

  // --- Specialties ---
  specialtiesEyebrow: "Health tourism services",
  specialtiesTitle: "Find the right service",
  specialtiesViewAll: "View all services",

  // --- How it works ---
  howEyebrow: "How it works",
  howTitle: "Three steps to your consultation",
  step1Title: "Choose a service",
  step1Text: "Browse our health tourism services and pick the one you need.",
  step2Title: "Send a request",
  step2Text: "Tell us about your plans. It takes a few minutes and is free of charge.",
  step3Title: "Talk to a coordinator",
  step3Text: "A patient coordinator contacts you within 1 business day and plans the next steps with you.",
  /** Ekran okuyucu için adım numarası — `{number}` yer tutucusu. */
  stepLabel: "Step {number}",

  // --- Global patient journey ---
  journeyEyebrow: "Global patient journey",
  journeyTitle: "From Across the World to Istanbul",
  journeyBody:
    "WM Health coordinates each stage of your journey to Istanbul, with treatment planning guided by your medical needs.",
  journeyStep1Title: "Pre-Travel Planning",
  journeyStep1Text: "Share your medical history and treatment goals so we can prepare a plan tailored to you before you travel.",
  journeyStep2Title: "Arrival in Istanbul",
  journeyStep2Text: "Our team welcomes you, arranges your accommodation, and confirms your appointment schedule.",
  journeyStep3Title: "Examination and Treatment",
  journeyStep3Text: "Examinations and treatment take place at an authorized healthcare facility, with your coordinator by your side.",
  journeyStep4Title: "Follow-Up After Your Return",
  journeyStep4Text: "We stay in touch after you return home to support your recovery and answer any questions.",
  journeyCountry1: "United Kingdom",
  journeyCountry2: "Germany",
  journeyCountry3: "Russia",
  journeyCountry4: "Kazakhstan",
  journeyCountry5: "Saudi Arabia",
  journeyCountry6: "United States",
  /** Harita üzerindeki merkez noktanın sabit etiketi — ülke listesinden bağımsız. */
  journeyIstanbulLabel: "Istanbul",

  // --- Doctors ---
  doctorsEyebrow: "Our medical team",
  doctorsTitle: "Meet our physicians",
  doctorsCta: "View all physicians",

  // --- Closing band ---
  closingTitle: "Start with a consultation",
  closingPrimaryCta: "Request a consultation",
  closingSecondaryCta: "Contact us",
} as const;

export type HomeStrings = Record<keyof typeof homeStrings, string>;
