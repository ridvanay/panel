import type { CommonStrings } from "./en/common";
import type { NavStrings } from "./en/nav";
import type { TelehealthStrings } from "./en/telehealth";
import type { LegalStrings } from "./en/legal";
import type { ErrorStrings } from "./en/errors";
import type { AboutStrings } from "./en/about";
import type { ContactStrings } from "./en/contact";
import type { HomeStrings } from "./en/home";
import type { PortalStrings } from "./en/portal";
import type { ConsentStrings } from "./en/consent";
import type { UiStrings } from "./en/ui";
import type { ReviewsStrings } from "./en/reviews";
import type { ContactCtaStrings } from "./en/contact-cta";
import type { PackagesStrings } from "./en/packages";
import type { DestinationsStrings } from "./en/destinations";
import type { ConsultationStrings } from "./en/consultation";
import type { BlogStrings } from "./en/blog";
import type { TrustPagesStrings } from "./en/trust-pages";
import type { IntermediaryStrings } from "./en/intermediary";
import type { RequestStrings } from "./en/request";

/**
 * `.claude/architect-scope-i18n.md` §14.2 — public site UI STRING KAPSAMI. `Locale.code`
 * (DB locale kümesi, `GET /locales`) İLE KARIŞTIRILMAZ (§14.2 tablo) — bu, repo'daki
 * `site-dictionaries/<code>/` klasörlerinin kapsadığı, yalnızca DEPLOY ile genişleyen kümedir.
 */
// Paket T — ro/fr ve Sırpça Latin (`sr-latn`; Intl etiketi `sr-Latn-RS`).
export type SiteUiLocale = "en" | "tr" | "es" | "de" | "ar" | "ru" | "ro" | "fr" | "sr-latn";

export type SiteDictionary = {
  common: CommonStrings;
  nav: NavStrings;
  telehealth: TelehealthStrings;
  legal: LegalStrings;
  errors: ErrorStrings;
  about: AboutStrings;
  contact: ContactStrings;
  home: HomeStrings;
  portal: PortalStrings;
  consent: ConsentStrings;
  /** Paket U (B4) — erişilebilirlik etiketleri + canlı destek sohbeti. */
  ui: UiStrings;
  /** Paket Y — zengin hekim profili ve hasta yorumları. */
  reviews: ReviewsStrings;
  /** Paket X — ortak iletişim eylemleri, sağlık paketleri, "Top destinations". */
  contactCta: ContactCtaStrings;
  packages: PackagesStrings;
  destinations: DestinationsStrings;
  /** Paket AF — video görüşme odası (consultation-room, interpreter-room, room/*). */
  consultation: ConsultationStrings;
  /** Paket Z1 — blog ("Health Guides"), yazı sayfası ve doktor paneli "Medical review" kuyruğu. */
  blog: BlogStrings;
  /** Paket Z1-ek - guven sayfalari (content-standards, medical-reviewers). */
  trustPages: TrustPagesStrings;
  /** Paket AH — kurumsal kimlik ibaresi (aracı kuruluş). */
  intermediary: IntermediaryStrings;
  /** Paket AH — talep formu, VIP sayfası, Hakkımızda aracı kuruluş bölümleri. */
  request: RequestStrings;
};

export type { CommonStrings, NavStrings, TelehealthStrings, LegalStrings, ErrorStrings, AboutStrings, ContactStrings, HomeStrings, PortalStrings, ConsentStrings, UiStrings, ReviewsStrings, ContactCtaStrings, PackagesStrings, DestinationsStrings, ConsultationStrings, BlogStrings, TrustPagesStrings, IntermediaryStrings, RequestStrings };
