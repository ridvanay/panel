import type { ContactStrings } from "../en/contact";

export const contactStrings: ContactStrings = {
  doctorRequestMessage:
    "Je souhaite prendre rendez-vous avec {doctor}. Merci de me contacter lorsqu’un créneau adapté sera disponible.",
  metaTitle: "Nous contacter",
  metaDescription: "Envoyez-nous votre question, notre équipe patients vous répondra.",
  breadcrumbCurrent: "Contact",
  eyebrow: "Contact",
  title: "Nous contacter",
  intro: "Envoyez-nous votre question, notre équipe patients vous répondra.",
  callButton: "Appeler",
  whatsappButton: "WhatsApp",

  // --- Form ---
  formTitle: "Envoyer un message",
  requiredNote: "Les champs marqués d’un * sont obligatoires.",
  fullNameLabel: "Nom complet",
  emailLabel: "E-mail",
  phoneLabel: "Téléphone",
  phoneCountryLabel: "Indicatif pays",
  phoneNumberLabel: "Numéro de téléphone",
  countryLabel: "Pays",
  countryPlaceholder: "Sélectionnez votre pays",
  treatmentLabel: "Traitement envisagé",
  treatmentPlaceholder: "Sélectionnez un traitement (facultatif)",
  treatmentNotSure: "Je ne sais pas encore",
  treatmentHelp: "Facultatif — vous pouvez laisser ce champ vide.",
  contactMethodLabel: "Moyen de contact préféré",
  methodEmail: "E-mail",
  methodPhone: "Téléphone",
  methodWhatsapp: "WhatsApp",
  whatsappNote:
    "Remarque : si vous choisissez WhatsApp, notre réponse vous sera envoyée via WhatsApp (Meta Platforms, Inc.), qui peut traiter votre numéro de téléphone en dehors de votre pays.",
  messageLabel: "Message",
  messageHelp: "Merci de ne pas inclure ici de dossiers médicaux détaillés ni de résultats d’examens.",
  submit: "Envoyer le message",
  sending: "Envoi en cours…",
  responseTimeDefault: "Notre équipe patients répond généralement sous un jour ouvré.",
  requiredMark: "obligatoire",

  // --- Result ---
  successTitle: "Merci — votre message a bien été envoyé.",
  successBody: "Notre équipe patients vous répondra dans les meilleurs délais par le moyen de contact que vous avez choisi.",
  sendAnother: "Envoyer un autre message",
  errorSummary: "Veuillez corriger les champs signalés.",
  errorGeneric: "Nous n’avons pas pu envoyer votre message. Veuillez réessayer — vos saisies ont été conservées.",
  errorRateLimited: "Trop de tentatives. Veuillez patienter une minute puis réessayer — vos saisies ont été conservées.",
  errorFormExpired: "Le formulaire avait expiré et a été actualisé. Veuillez cliquer à nouveau sur « Envoyer le message ».",

  // --- Validation ---
  errorRequired: "Ce champ est obligatoire.",
  errorInvalidEmail: "Saisissez une adresse e-mail valide.",
  errorInvalidPhone: "Saisissez un numéro de téléphone valide (chiffres, espaces, tirets).",
  errorPhoneRequiredForMethod: "Saisissez un numéro de téléphone pour être contacté par téléphone ou par WhatsApp.",
  errorPhoneCountryRequired: "Sélectionnez un indicatif pays.",
  errorInvalidCountry: "Sélectionnez un pays dans la liste.",
  errorTooLong: "Ce texte est trop long.",
  errorNoticeRequired: "Veuillez confirmer que vous avez lu la Notice d’information sur la protection des données.",
  errorExplicitConsentRequired:
    "Pour indiquer un domaine de traitement, veuillez donner votre consentement explicite — ou laissez le champ traitement vide.",
  errorInvalidTreatment: "Sélectionnez un traitement dans la liste.",
  // Paket U — sayfa-oluşturucu iletişim formu bloğu.
  errorConsentRequired: "Veuillez cocher la case pour continuer.",
  selectPlaceholder: "Sélectionnez…",

  // --- Details column ---
  contactDetailsTitle: "Coordonnées",
  phoneRowLabel: "Téléphone",
  whatsappRowLabel: "WhatsApp",
  emailRowLabel: "E-mail",
  addressRowLabel: "Adresse",
  hoursTitle: "Horaires d’ouverture",
  mapTitle: "Localisation",
  openInMaps: "Ouvrir dans Google Maps",
  mapImageAlt: "Carte indiquant notre emplacement",
};
