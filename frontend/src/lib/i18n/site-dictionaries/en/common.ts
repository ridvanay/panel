/**
 * `.claude/architect-scope-i18n.md` §14.2/§14.4 — public site "chrome" dili, KAYNAK dil (`en`).
 * `common` namespace: birden fazla sayfa/bileşende tekrar eden, gerçekten jenerik metinler.
 * Yeni bir anahtar eklemeden önce mevcut namespace'lerden birine sığıp sığmadığına bak (§14.4).
 */
export const commonStrings = {
  /** `product-breadcrumbs.tsx` — kırıntı yolunun ilk halkası. */
  home: "Home",
  /** Paket V — canlı destek düğmesi (destek bandı, koordinatör kutusu). */
  liveChatCta: "Live chat",
  contactUsCta: "Contact us",
  /** Paket V — anasayfa destek bandı (yalnızca `supportLanguages` doluysa görünür). */
  supportBandTitle: "Speak with a patient coordinator in your language — free of charge",
  /** Yalnızca `interpreterIncluded=true` iken gösterilir. */
  supportInterpreterIncluded: "Free online video consultation with a patient coordinator — interpreter included.",
  /** Paket AJ — destek bandı açıklaması (her zaman görünür; tercüman cümlesi ayrı). */
  supportBandText: "Meet your patient coordinator in a free online video consultation. Our coordinators support you from your first enquiry to your return home — at no extra cost.",
  supportLanguagesLabel: "Supported languages",
  supportHoursLabel: "Support hours",
  /** Doktor profili ve randevu sihirbazı rozeti; `{count}` desteklenen dil sayısı. */
  supportBadge: "Support in {count} languages",
  /** Footer kısa satırı; `{languages}` yerel adlar. */
  supportFooterLine: "Patient support in your language: {languages}",
  /** Paket V — yetki belgeleri şeridi / listesi. */
  accreditationStripTitle: "Licensed & accredited",
  accreditationListTitle: "Licences and accreditations",
  accreditationCertificateNo: "Certificate no. {number}",
  accreditationVerify: "Verify",
  accreditationVerifyAria: "Verify {name} (opens in a new tab)",
  accreditationIssuer: "Issued by {issuer}",
  accreditationValidUntil: "Valid until {date}",
} as const;

export type CommonStrings = Record<keyof typeof commonStrings, string>;
