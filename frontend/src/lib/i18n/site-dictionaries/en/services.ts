/**
 * Paket AI — "Health Tourism Services" mega menüsü, hizmet grupları, süreç şeridi, hizmet kartı düğmeleri ve
 * header düğmeleri. KAYNAK dil; diğer diller aynı anahtarlara sahip olmalı (`tr/` ziyaretçiye kapalı, EN metin).
 * Yer tutucu: {service} (hizmet adı; düğmenin erişilebilir adı).
 */
export const servicesStrings = {
  groupSurgeryOncology: "Surgery & Oncology",
  groupDigestiveInterventional: "Digestive & Interventional",
  groupAestheticDentalHair: "Aesthetic, Dental & Hair",
  groupFertility: "Fertility",
  groupOther: "Other",
  panelHeading: "Not sure which treatment you need?",
  findYourTreatment: "Find your treatment",
  bookOnlineConsultation: "Book an online consultation",
  bookConsultation: "Book a consultation",
  coordinatorHeading: "Talk to a patient coordinator",
  viewAllServices: "View all services",
  facilitiesNote: "Treatments at authorized healthcare facilities",
  relatedProceduresAria: "Related procedures",
  processHeading: "How it works",
  processStep1: "Request or book",
  processStep2: "Coordinator call",
  processStep3: "Authorized facility & plan",
  processStep4: "Travel & stay",
  processStep5: "Treatment",
  processStep6: "Aftercare",
  cardRequest: "Request",
  cardBookAria: "Book an online consultation: {service}",
  cardRequestAria: "Request a consultation: {service}",
} as const;

export type ServicesStrings = Record<keyof typeof servicesStrings, string>;
