import type { Specialty } from "@/lib/api/types";
import { safeJsonLdString } from "@/lib/page-builder/structured-data";

/**
 * Görev (2026-09-16) — `/specialties/[slug]` `schema.org/MedicalSpecialty` JSON-LD üreticisi.
 * `doctor-json-ld.ts` İLE BİREBİR AYNI kaçışlama deseni (`safeJsonLdString`, ikinci bir escape
 * mantığı YOK) ve AYNI disiplin: uydurma alan (rating/review — sistemde review tablosu yok, bkz.
 * `doctor-json-ld.ts` yorumu) KESİNLİKLE EKLENMEZ. Yalnızca DB'de zaten var olan `Specialty`
 * alanları (ad, açıklama VARSA) taşınır.
 */
export function buildSpecialtyJsonLd(specialty: Specialty, canonicalUrl: string): string {
  return safeJsonLdString({
    "@context": "https://schema.org",
    "@type": "MedicalSpecialty",
    name: specialty.name,
    ...(specialty.description ? { description: specialty.description } : {}),
    url: canonicalUrl,
  });
}
