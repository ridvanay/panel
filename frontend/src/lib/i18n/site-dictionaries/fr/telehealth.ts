import type { TelehealthStrings } from "../en/telehealth";

export const telehealthStrings: TelehealthStrings = {
  founderBadge: "Fondateur",
  earliestShortLabel: "Au plus tôt : {date}",
  emergencyNoticeSummary: "Non destiné aux urgences. En cas d’urgence, appelez le numéro d’urgence local.",
  emergencyNoticeFull:
    "Cette plateforme n’est pas destinée aux urgences et ne remplace pas une prise en charge médicale d’urgence. En cas d’urgence, appelez le numéro d’urgence local (112 en Türkiye/UE, 911 aux États-Unis/Canada, 999 au Royaume-Uni).",
  emergencyNoticeShowDetails: "Détails",
  emergencyNoticeHideDetails: "Masquer les détails",

  // --- /doctors ---
  doctorsPageTitle: "Nos médecins",
  doctorsPageSubtitle: "Filtrez par spécialité, choisissez un horaire qui vous convient et réservez votre rendez-vous en ligne.",
  doctorsEmptyTitle: "Aucun résultat",
  doctorsEmptyDescription: "Aucun médecin ne correspond à ces filtres. Essayez de modifier vos filtres.",
  searchPlaceholder: "Rechercher par nom de médecin…",
  searchAriaLabel: "Rechercher des médecins",
  specialtyFilterAriaLabel: "Filtrer par spécialité",
  languageFilterAriaLabel: "Filtrer par langue",
  allSpecialties: "Toutes les spécialités",
  allLanguages: "Toutes les langues",

  // --- doctor-card.tsx / doctor-profile-hero.tsx ---
  verifiedPhysicianBadge: "Médecin vérifié",
  verifiedPhysicianSrOnly: "Médecin vérifié",
  generalSpecialty: "Médecine générale",
  generalConsultationSpecialty: "Consultation générale",
  spokenLanguagesAriaLabel: "Langues parlées : {languages}",
  sessionDurationLabel: "{minutes} min",
  freeSessionLabel: "Gratuit / Nous contacter pour le tarif",
  bookAppointmentCta: "Prendre rendez-vous",
  viewProfileCta: "Voir le médecin",
  createAppointmentCta: "Prendre rendez-vous",
  socialLinksAriaLabel: "Réseaux sociaux et liens web",
  experienceYearsBadge: "{years} ans d’expérience",

  // --- doctor-profile-tabs.tsx ---
  tabAbout: "À propos du médecin",
  tabCv: "CV",
  tabPublications: "Publications",
  tabExpertise: "Domaines d’expertise",
  aboutEmpty: "Aucune information biographique n’a encore été communiquée pour ce médecin.",
  cvEmpty: "Aucune information de CV n’a encore été communiquée pour ce médecin.",
  publicationsEmpty: "Aucune publication scientifique n’a encore été communiquée pour ce médecin.",
  expertiseEmpty: "Aucune information sur les domaines d’expertise n’a encore été communiquée pour ce médecin.",
  cvOngoing: "En cours",
  cvViewCertificate: "Voir le certificat",
  publicationInternational: "Articles internationaux",
  publicationNational: "Articles nationaux",
  publicationProceeding: "Actes de congrès",
  publicationBookChapter: "Chapitres d’ouvrages",
  publicationOther: "Autres publications",
  viewSource: "Voir la source",
  expertiseAreaLabel: "Domaine d’expertise",
  certificationsLabel: "Certifications et affiliations",

  // --- doctor-quick-booking-card.tsx ---
  quickBookingLabel: "Consultation en ligne / Prendre rendez-vous",
  perUnitDurationSuffix: "/ {minutes} min",
  earliestAppointmentLabel: "Premier rendez-vous disponible :",
  noAvailableAppointment: "Aucun rendez-vous disponible actuellement.",
  securePaymentNotice: "Paiement sécurisé et conformité en matière de protection des données",
  recordingSupportNotice: "Enregistrement de la séance et compte rendu médical",

  // --- doctor-service-summary.tsx ---
  serviceSummaryLabel: "Récapitulatif du service",
  sessionWithSpecialtyLabel: "Séance de {specialty}",
  selectedAppointmentLabel: "Rendez-vous sélectionné",
  changeAction: "Modifier",
  serviceDurationLabel: "{minutes} min",
  selectDateTimePrompt: "Sélectionnez la date et l’heure",
  removeSlotAriaLabel: "Supprimer le créneau de {time}",
  slotSummaryLabel: "{count} créneau(x) · {minutes} min",
  perSessionPriceSuffix: "/ séance",
  sessionsUnitWord: "séances",
  totalLabel: "Total",
  continueCta: "Continuer",
  stepProgressLabel: "Étape {current} / 5",

  // --- doctors/[slug]/page.tsx ---
  availabilityAndBookingTitle: "Disponibilités et réservation",

  // --- /specialties ---
  specialtiesPageTitle: "Nos domaines d’expertise",
  // Paket U (B4) — sayfa meta açıklamaları (önceden tüm dillerde Türkçe sabit metindi).
  doctorsMetaDescription: "Réservez une consultation en ligne avec nos médecins dans des spécialités telles que {specialties}.",
  doctorsMetaDescriptionDefault: "Réservez une consultation en ligne avec nos médecins.",
  specialtiesMetaDescription: "Découvrez nos médecins dans des spécialités telles que {specialties}.",
  specialtiesMetaDescriptionDefault: "Découvrez nos spécialités et réservez une consultation en ligne.",
  specialtyMetaDescription: "Réservez une consultation en ligne avec nos médecins en {specialty}.",
  specialtiesPageSubtitle: "Découvrez nos médecins par spécialité et réservez votre rendez-vous en ligne.",
  specialtiesEmptyTitle: "Aucune spécialité trouvée",
  specialtiesEmptyDescription: "Aucune spécialité à afficher pour le moment.",
  doctorCountOne: "{count} médecin",
  doctorCountOther: "{count} médecins",
  specialtyDoctorsEmptyTitle: "Aucun médecin trouvé dans cette spécialité",
  specialtyDoctorsEmptyDescription: "Aucun médecin n’est actuellement publié dans cette spécialité.",
  specialtyCoordinatorTitle: "Laissez notre coordinateur trouver le médecin qui vous convient",
  specialtyCoordinatorText: "Expliquez-nous votre situation : un coordinateur patients vous orientera vers un médecin adapté dans cette spécialité.",

  // --- Öne Çıkan Doktorlar carousel'i (Paket D) ---
  featuredDoctorsCarouselLabel: "Médecins à la une",
  featuredDoctorsPrevious: "Médecins précédents",
  featuredDoctorsNext: "Médecins suivants",
  featuredDoctorsPause: "Mettre en pause le défilement automatique",
  featuredDoctorsPlay: "Reprendre le défilement automatique",
  featuredDoctorsGoToPage: "Page {page} sur {total}",
};
