/**
 * `/contact` sayfası — KAYNAK dil (`en`). Başlık, giriş metni ve yanıt süresi admin → İletişim →
 * "İletişim sayfası"ndan dil başına değiştirilebilir; admin alanı boşsa buradaki varsayılan
 * gösterilir. Onay kutusu metinleri BURADA DEĞİL, sunucudadır (gösterilen metin = saklanan metin,
 * bkz. backend `modules/contact/contact-page.ts::CONTACT_PAGE_CONSENT_TEXTS`).
 */
export const contactStrings = {
  metaTitle: "Contact us",
  metaDescription: "Send us your question and our patient team will get back to you.",
  breadcrumbCurrent: "Contact",
  eyebrow: "Contact",
  title: "Contact us",
  intro: "Send us your question and our patient team will get back to you.",
  callButton: "Call",
  whatsappButton: "WhatsApp",

  // --- Form ---
  formTitle: "Send a message",
  requiredNote: "Fields marked * are required.",
  fullNameLabel: "Full name",
  emailLabel: "Email",
  phoneLabel: "Phone",
  phoneCountryLabel: "Country code",
  phoneNumberLabel: "Phone number",
  countryLabel: "Country",
  countryPlaceholder: "Select your country",
  treatmentLabel: "Treatment of interest",
  treatmentPlaceholder: "Select a treatment (optional)",
  treatmentNotSure: "Not sure yet",
  treatmentHelp: "Optional — you can leave this blank.",
  contactMethodLabel: "Preferred contact method",
  methodEmail: "Email",
  methodPhone: "Phone",
  methodWhatsapp: "WhatsApp",
  whatsappNote:
    "Note: if you choose WhatsApp, our reply is sent via WhatsApp (Meta Platforms, Inc.), which may process your phone number outside your country.",
  messageLabel: "Message",
  messageHelp: "Please do not include detailed medical records or test results here.",
  submit: "Send message",
  sending: "Sending…",
  responseTimeDefault: "Our patient team usually replies within one business day.",
  requiredMark: "required",

  // --- Result ---
  successTitle: "Thank you — your message has been sent.",
  successBody: "Our patient team will get back to you as soon as possible using your preferred contact method.",
  sendAnother: "Send another message",
  errorSummary: "Please correct the highlighted fields.",
  errorGeneric: "We couldn't send your message. Please try again — your entries have been kept.",
  errorRateLimited: "Too many attempts. Please wait a minute and try again — your entries have been kept.",
  errorFormExpired: "The form had expired and has been refreshed. Please press “Send message” again.",

  // --- Validation ---
  errorRequired: "This field is required.",
  errorInvalidEmail: "Enter a valid email address.",
  errorInvalidPhone: "Enter a valid phone number (digits, spaces, dashes).",
  errorPhoneRequiredForMethod: "Enter a phone number to be contacted by phone or WhatsApp.",
  errorPhoneCountryRequired: "Select a country code.",
  errorInvalidCountry: "Select a country from the list.",
  errorTooLong: "This text is too long.",
  errorNoticeRequired: "Please confirm that you have read the Privacy Notice.",
  errorExplicitConsentRequired: "To share a treatment area, please give your explicit consent — or leave the treatment blank.",
  errorInvalidTreatment: "Select a treatment from the list.",

  // --- Details column ---
  contactDetailsTitle: "Contact details",
  phoneRowLabel: "Phone",
  whatsappRowLabel: "WhatsApp",
  emailRowLabel: "Email",
  addressRowLabel: "Address",
  hoursTitle: "Working hours",
  mapTitle: "Location",
  openInMaps: "Open in Google Maps",
  mapImageAlt: "Map showing our location",
} as const;

export type ContactStrings = Record<keyof typeof contactStrings, string>;
