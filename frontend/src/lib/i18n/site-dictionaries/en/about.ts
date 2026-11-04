/**
 * `/about` ("About Us") sayfası — KAYNAK dil (`en`). Metinler ürün sahibinin verdiği NİHAİ
 * metinlerdir, birebir kullanılır (değiştirilmez, yeni metin eklenmez).
 */
export const aboutStrings = {
  metaTitle: "About Us | WM Health",
  metaDescription:
    "WM Health is an international health tourism intermediary that helps patients from different countries plan their treatment in Türkiye. Learn about our role, the treatment services we facilitate and our approach.",

  // --- Hero ---
  breadcrumbCurrent: "About Us",
  heroEyebrow: "About WM Health",
  heroTitle: "Quality healthcare, more accessible across borders.",
  heroBody:
    "WM Health welcomes patients from different countries to Istanbul. We bring together clear communication and careful coordination to support a safe and well-informed treatment journey with authorized healthcare facilities. From the first enquiry to the planning of next steps, we aim to make quality healthcare more accessible across borders.",
  bookConsultationCta: "Request a consultation",
  meetDoctorsCta: "Who we are",
  locationTitle: "Istanbul, Türkiye",
  locationSubtitle: "Welcoming patients from different countries",

  // --- Treatment areas ---
  treatmentEyebrow: "What we coordinate",
  treatmentTitle: "Treatment services we facilitate",
  treatmentBody:
    "Each patient’s needs are different. We connect you with healthcare facilities holding an International Health Tourism Authorization Certificate, where treatment decisions are made following an individual medical evaluation.",
  treatmentObesity: "Obesity & metabolic surgery",
  treatmentOncology: "Surgical oncology",
  treatmentIvf: "IVF & reproductive health",
  treatmentDental: "Dental care",
  treatmentHair: "Hair transplantation",
  treatmentPlastic: "Plastic, reconstructive & aesthetic surgery",

  // --- Why WM Health? ---
  approachEyebrow: "Our approach",
  approachTitle: "Why WM Health?",
  approach1Title: "Care Guided by Medical Assessment",
  approach1Body: "Treatment options are considered in light of your individual health needs.",
  approach2Title: "Clarity at Every Step",
  approach2Body: "Understand the proposed treatment, its timeline and the questions to discuss with your medical team.",
  approach3Title: "Support Across Borders",
  approach3Body: "Plan your healthcare journey in Istanbul with guidance before and during your visit.",

  // --- Meet our doctors ---
  doctorsEyebrow: "Our medical team",
  doctorsTitle: "Meet our physicians",
  viewAllDoctorsCta: "View all physicians",
  founderBadge: "Founder",

  // --- Kapanış bandı ---
  closingTitle: "Start with a consultation",
  contactCta: "Contact us",
} as const;

export type AboutStrings = Record<keyof typeof aboutStrings, string>;
