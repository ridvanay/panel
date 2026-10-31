/**
 * Paket X — ortak iletişim eylemleri (`ContactCta`): WhatsApp (yalnızca açık ve numara girilmişse), canlı destek,
 * "Sizi arayalım". KAYNAK dil; diğer 8 dil aynı anahtarlara sahip olmalı.
 */
export const contactCtaStrings = {
  whatsapp: "WhatsApp",
  whatsappAria: "Write to us on WhatsApp (opens in a new tab)",
  liveChat: "Live chat",
  callback: "Request a call back",
  talkToUs: "Talk to us",
  contactMenu: "Contact",
  contactMenuAria: "Contact options",
  close: "Close",
  whatsappNote: "WhatsApp is operated by Meta. Please do not share health information there.",
} as const;

export type ContactCtaStrings = Record<keyof typeof contactCtaStrings, string>;
