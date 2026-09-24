/**
 * `/about` ("About Us") sayfası — KAYNAK dil (`en`). Metinler ürün sahibinin verdiği NİHAİ
 * metinlerdir, birebir kullanılır (değiştirilmez, yeni metin eklenmez).
 */
export const aboutStrings = {
  metaTitle: "About Us | WM Health",
  metaDescription:
    "WM Health welcomes patients from different countries to Istanbul. Learn about our treatment areas, our approach and our doctors.",

  // --- Hero ---
  breadcrumbCurrent: "About Us",
  heroEyebrow: "About WM Health",
  heroTitle: "Quality healthcare, more accessible across borders.",
  heroBody:
    "Founded under the leadership of Dr. Vahit Mutlu, WM Health welcomes patients from different countries to Istanbul. We bring together high standards of care, clear communication and careful coordination to support a safe and well-informed treatment journey. From the first consultation to the planning of next steps, we aim to make quality healthcare more accessible across borders.",
  bookConsultationCta: "Book a consultation",
  meetDoctorsCta: "Meet our doctors",
  locationTitle: "Istanbul, Türkiye",
  locationSubtitle: "Welcoming patients from different countries",

  // --- Treatment areas ---
  treatmentEyebrow: "What we treat",
  treatmentTitle: "Our treatment areas",
  treatmentBody:
    "Each patient’s needs are different. Treatment decisions are made following an individual medical evaluation, with attention to the patient’s health history and goals.",
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
  doctorsTitle: "Meet our doctors",
  viewAllDoctorsCta: "View all doctors",
  founderBadge: "Founder",

  // --- Kapanış bandı ---
  closingTitle: "Start with a consultation",
  contactCta: "Contact us",
} as const;

export type AboutStrings = Record<keyof typeof aboutStrings, string>;
