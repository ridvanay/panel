import type { Specialty } from "@/lib/api/types";

/** Paket AG — alt uzmanlığı olmayan (üst seviye) uzmanlık mı? Alan yoksa (eski API) üst seviye sayılır. */
export function isTopLevelSpecialty(specialty: Pick<Specialty, "parentId">): boolean {
  return specialty.parentId == null;
}

/** Paket AG — liste yüzeyleri (uzmanlıklar sayfası, kartlar, filtreler) yalnızca üst uzmanlıkları gösterir. */
export function topLevelSpecialties<T extends Pick<Specialty, "parentId">>(specialties: T[]): T[] {
  return specialties.filter(isTopLevelSpecialty);
}
