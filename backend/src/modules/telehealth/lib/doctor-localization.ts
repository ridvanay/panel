import { applyFieldLocalization } from "../../../lib/localization";
import { sanitizeRichHtml } from "../../../lib/html-sanitize";
import { localizeFields } from "../../../lib/entity-translations";

/** Paket O — uzmanlık adı/açıklaması aktif dilde (çeviri yoksa kanonik EN). */
export function localizeSpecialty<T extends { translations: unknown; name: string; description: string | null }>(specialty: T, contentLocale: string | undefined): T {
  return localizeFields(specialty, contentLocale, ["name", "description"]);
}

type DoctorSpecialtyRelations<S> = { specialty: S | null; additionalSpecialties?: Array<{ specialty: S }> };

/** Doktorun birincil ve ek uzmanlık adları aktif dilde (varsayılan dil dahil — bkz. `resolveContentLocaleCode`). */
export function localizeDoctorSpecialties<
  S extends { translations: unknown; name: string; description: string | null },
  T extends DoctorSpecialtyRelations<S>,
>(doctor: T, contentLocale: string | undefined): T {
  if (!contentLocale) return doctor;
  return {
    ...doctor,
    specialty: doctor.specialty ? localizeSpecialty(doctor.specialty, contentLocale) : null,
    ...(doctor.additionalSpecialties
      ? { additionalSpecialties: doctor.additionalSpecialties.map((link) => ({ ...link, specialty: localizeSpecialty(link.specialty, contentLocale) })) }
      : {}),
  };
}

/**
 * Paket L (2026-10-23) — `DoctorProfile.translations` alan bazlı çevirisi (`Page` ile aynı sessiz
 * fallback: çeviri yoksa ya da boşsa kanonik değer). `cvEntries`/`publications` çevrilmez.
 */
export const DOCTOR_TRANSLATABLE_FIELDS = ["title", "bio", "aboutHtml", "subSpecialty"] as const;
export type DoctorTranslatableField = (typeof DOCTOR_TRANSLATABLE_FIELDS)[number];

type LocalizableDoctor = {
  translations: unknown;
  title: string;
  bio: string;
  aboutHtml: string | null;
  subSpecialty: string | null;
};

export function localizeDoctor<T extends LocalizableDoctor>(doctor: T, effectiveLocale: string | undefined): T {
  if (!effectiveLocale) return doctor;
  const localized = applyFieldLocalization(doctor, effectiveLocale, DOCTOR_TRANSLATABLE_FIELDS as unknown as (keyof T & string)[]);
  // Okuma yolunda da savunma: çeviri `aboutHtml`'i her zaman sanitize edilmiş döner (yazma yolu da sanitize eder).
  if (localized.aboutHtml && localized.aboutHtml !== doctor.aboutHtml) {
    return { ...localized, aboutHtml: sanitizeRichHtml(localized.aboutHtml) };
  }
  return localized;
}
