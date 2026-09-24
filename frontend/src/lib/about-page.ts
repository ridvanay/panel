import type { DoctorProfile } from "@/lib/api/types";

/**
 * `/about` sayfasının "Meet our doctors" bölümünde DAİMA ilk sırada gösterilen kurucu hekimin
 * slug'ı. Şemada "kurucu" işareti YOKTUR (bilinçli karar — şema değişikliği yerine sabit slug);
 * değer prod veritabanındaki `doctor_profiles.slug` ile birebir aynı olmalıdır.
 *
 * Boş bırakılırsa ya da bu slug'la aktif bir doktor bulunamazsa sayfa hata VERMEZ: kurucu etiketi
 * olmadan ilk `ABOUT_DOCTORS_LIMIT` aktif doktor gösterilir (bkz. `selectAboutDoctors`).
 */
export const FOUNDER_DOCTOR_SLUG = "";

export const ABOUT_DOCTORS_LIMIT = 3;

export interface AboutDoctorsSelection {
  doctors: DoctorProfile[];
  /** Kurucu listede bulunduysa onun `id`'si, aksi hâlde `null`. */
  founderId: string | null;
}

/**
 * Kurucu (varsa) başa alınır, ardından kalan doktorlar GELDİKLERİ SIRAYLA eklenir. Public
 * `GET /doctors` ucu listeyi `seq` artan sırada döndürdüğü için bu, "seq sırasıyla ilk N aktif
 * doktor (kurucu hariç)" anlamına gelir — burada yeniden sıralama YAPILMAZ.
 */
export function selectAboutDoctors(
  doctors: DoctorProfile[],
  founderSlug: string = FOUNDER_DOCTOR_SLUG,
  limit: number = ABOUT_DOCTORS_LIMIT
): AboutDoctorsSelection {
  const founder = founderSlug ? doctors.find((doctor) => doctor.slug === founderSlug) : undefined;
  if (!founder) return { doctors: doctors.slice(0, limit), founderId: null };

  const others = doctors.filter((doctor) => doctor.id !== founder.id);
  return { doctors: [founder, ...others.slice(0, limit - 1)], founderId: founder.id };
}
