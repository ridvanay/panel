/**
 * Paket AH - kurumsal kimlik ibaresi (SAF veri): WM Health bir saglik kurulusu degil, uluslararasi saglik turizmi
 * araci kurulusudur. Metinler frontend sozlugu (`site-dictionaries/<dil>/intermediary.ts`) ile AYNIDIR; e-posta
 * footer'i ve talep onay e-postasi buradan okur. `tr` YOKTUR: musteriye giden hicbir e-posta Turkce olmaz.
 */
export const INTERMEDIARY_LOCALES = ["en", "de", "es", "fr", "ar", "ru", "ro", "sr-latn"] as const;
export type IntermediaryLocale = (typeof INTERMEDIARY_LOCALES)[number];

export interface IntermediaryIdentity {
  shortLabel: string;
  description: string;
}

export const INTERMEDIARY_IDENTITY: Record<IntermediaryLocale, IntermediaryIdentity> = {
  en: {
    shortLabel: "International Health Tourism Intermediary",
    description:
      "WM Health is an international health tourism intermediary organization, not a healthcare provider. All medical treatments are performed by healthcare facilities holding an International Health Tourism Authorization Certificate issued by the Republic of Türkiye Ministry of Health.",
  },
  de: {
    shortLabel: "Internationaler Vermittler für Gesundheitstourismus",
    description:
      "WM Health ist eine internationale Vermittlungsorganisation für Gesundheitstourismus und kein Gesundheitsdienstleister. Alle medizinischen Behandlungen werden von Gesundheitseinrichtungen durchgeführt, die über ein vom Gesundheitsministerium der Republik Türkiye ausgestelltes Zertifikat für internationalen Gesundheitstourismus verfügen.",
  },
  ar: {
    shortLabel: "وسيط دولي في السياحة العلاجية",
    description:
      "WM Health منظمة وسيطة دولية في مجال السياحة العلاجية، وليست جهة مقدِّمة للرعاية الصحية. تُجرى جميع العلاجات الطبية في منشآت صحية حاصلة على شهادة ترخيص السياحة العلاجية الدولية الصادرة عن وزارة الصحة في الجمهورية التركية.",
  },
  ru: {
    shortLabel: "Международный посредник в сфере медицинского туризма",
    description:
      "WM Health — международная посредническая организация в сфере медицинского туризма, а не медицинское учреждение. Все медицинские процедуры проводятся в медицинских учреждениях, имеющих Сертификат на право деятельности в сфере международного медицинского туризма, выданный Министерством здравоохранения Турецкой Республики.",
  },
  fr: {
    shortLabel: "Intermédiaire international en tourisme de santé",
    description:
      "WM Health est un organisme intermédiaire international de tourisme de santé et non un prestataire de soins. Tous les traitements médicaux sont réalisés par des établissements de santé titulaires d’un certificat d’autorisation de tourisme de santé international délivré par le ministère de la Santé de la République de Türkiye.",
  },
  es: {
    shortLabel: "Intermediario internacional de turismo de salud",
    description:
      "WM Health es una organización intermediaria internacional de turismo de salud, no un proveedor de atención médica. Todos los tratamientos médicos se realizan en centros sanitarios que cuentan con un Certificado de Autorización de Turismo de Salud Internacional expedido por el Ministerio de Salud de la República de Türkiye.",
  },
  ro: {
    shortLabel: "Intermediar internațional de turism medical",
    description:
      "WM Health este o organizație intermediară internațională de turism medical, nu un furnizor de servicii medicale. Toate tratamentele medicale sunt efectuate de unități sanitare care dețin un Certificat de autorizare pentru turism medical internațional emis de Ministerul Sănătății al Republicii Türkiye.",
  },
  "sr-latn": {
    shortLabel: "Međunarodni posrednik u zdravstvenom turizmu",
    description:
      "WM Health je međunarodna posrednička organizacija u zdravstvenom turizmu, a ne pružalac zdravstvenih usluga. Sve medicinske tretmane obavljaju zdravstvene ustanove koje poseduju Sertifikat o ovlašćenju za međunarodni zdravstveni turizam koji izdaje Ministarstvo zdravlja Republike Turske.",
  },
};

/** Herhangi bir dil kodu -> kimlik ibaresi dili (`tr` ve bilinmeyen -> `en`). */
export function toIntermediaryLocale(code: string | null | undefined): IntermediaryLocale {
  const normalized = (code ?? "").toLowerCase();
  return (INTERMEDIARY_LOCALES as readonly string[]).includes(normalized) ? (normalized as IntermediaryLocale) : "en";
}

export function intermediaryIdentityFor(code: string | null | undefined): IntermediaryIdentity {
  return INTERMEDIARY_IDENTITY[toIntermediaryLocale(code)];
}
