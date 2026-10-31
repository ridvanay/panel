import { applyFieldLocalization } from "./localization";
import { doctorDisplayName, type DoctorNameSource } from "./doctor-display-name";

/**
 * E-postalarda hekim unvanı ALICININ dilinde yazılır: `DoctorProfile.translations.<dil>.title` (ör. TR "Doç. Dr.",
 * EN "Assoc. Prof."). Çeviri yoksa ya da boşsa kanonik unvan kullanılır (sitedeki `localizeDoctor` ile aynı kural).
 */
export function localizedDoctorTitle(doctor: { title: string; translations?: unknown }, locale: string | null | undefined): string {
  if (!locale) return doctor.title;
  return applyFieldLocalization({ title: doctor.title, translations: doctor.translations ?? {} }, locale, ["title"]).title;
}

/** Alıcının dilindeki unvan + görünen ad kuralı (kurucu dışında kısaltılmış ad). */
export function doctorEmailName(doctor: DoctorNameSource & { title: string; translations?: unknown }, locale: string | null | undefined): string {
  return `${localizedDoctorTitle(doctor, locale)} ${doctorDisplayName(doctor)}`.trim();
}
