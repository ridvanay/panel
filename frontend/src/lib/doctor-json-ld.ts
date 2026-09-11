import type { DoctorProfile } from "@/lib/api/types";
import { safeJsonLdString } from "@/lib/page-builder/structured-data";

/**
 * `.claude/architect-scope-telehealth-template.md` §9.5 — `/doctors/[slug]` `schema.org/Physician`
 * JSON-LD üreticisi. Mevcut `product-json-ld.ts` deseniyle AYNI kaçışlama (`safeJsonLdString`,
 * ikinci bir escape mantığı YOK). Çağıran taraf (`doctors/[slug]/page.tsx`) bu çıktıyı her zaman
 * render eder — `Product`'ın aksine `DoctorProfile`'da `noIndex` alanı YOK (§3.8: doktor profili
 * `ContentSlug`/SEO-override sistemine dahil değil), dolayısıyla ikinci bir bastırma kontrolü yok.
 *
 * BAĞLAYICI (mimari §9.5, "Kurallar" madde 2): `aggregateRating`/`review` alanı KESİNLİKLE
 * EKLENMEZ — sistemde değerlendirme (review) tablosu yoktur (§3.3), uydurma sosyal kanıt olurdu.
 * Tanı/tedavi/başarı iddiası içeren hiçbir alan doldurulmaz — yalnızca DB'de zaten var olan profil
 * alanları (ad, unvan, uzmanlık, konuşulan diller, biyografi, avatar) taşınır.
 */
export function buildDoctorJsonLd(doctor: DoctorProfile, canonicalUrl: string): string {
  const name = `${doctor.title} ${doctor.fullName}`.trim();

  return safeJsonLdString({
    "@context": "https://schema.org",
    "@type": "Physician",
    name,
    ...(doctor.title ? { honorificPrefix: doctor.title } : {}),
    ...(doctor.bio ? { description: doctor.bio } : {}),
    ...(doctor.avatarMedia?.url ? { image: doctor.avatarMedia.url } : {}),
    url: canonicalUrl,
    ...(doctor.specialty ? { medicalSpecialty: doctor.specialty.name } : {}),
    ...(doctor.languages.length > 0 ? { knowsLanguage: doctor.languages } : {}),
  });
}
