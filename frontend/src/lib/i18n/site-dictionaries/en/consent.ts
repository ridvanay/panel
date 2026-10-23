/**
 * Paket N (2026-10-23) — çerez onay bandı ve tercihler penceresi. "Reddet" ve "Kabul et" AYNI görünürlükte
 * gösterilir; analitik/pazarlama varsayılan KAPALIDIR. Metin değişirse `lib/crm/consent.ts::CONSENT_VERSION`
 * artırılır (backend `CRM_CONSENT_VERSION` ile aynı) ve bant yeniden gösterilir.
 */
export const consentStrings = {
  bannerTitle: "Your privacy",
  bannerText:
    "We use strictly necessary cookies to run this site. With your permission we would also like to use analytics cookies to understand how the site is used, and marketing cookies to measure our advertising. You can change your choice at any time via “Cookie preferences” at the bottom of the page.",
  acceptAll: "Accept all",
  rejectAll: "Reject all",
  preferences: "Preferences",
  policyLink: "Cookie policy",
  dialogTitle: "Cookie preferences",
  dialogDescription: "Choose which cookies we may use. Strictly necessary cookies cannot be turned off because the site does not work without them.",
  necessaryTitle: "Strictly necessary",
  necessaryText: "Security, language choice and remembering your cookie choice. Always on.",
  alwaysOn: "Always on",
  analyticsTitle: "Analytics",
  analyticsText:
    "Pseudonymous measurement (with a random visitor ID stored in your browser) of visits, pages and clicks so we can improve the site. IP addresses are masked; data is kept for 180 days. Never used on account, payment or consultation pages.",
  marketingTitle: "Marketing",
  marketingText:
    "Measuring which ads brought you to us (for example the Google Ads click ID, kept for 90 days). Conversions may be reported to Google (USA). Only stored together with analytics.",
  save: "Save choices",
  close: "Close",
  footerLink: "Cookie preferences",
} as const;

export type ConsentStrings = Record<keyof typeof consentStrings, string>;
