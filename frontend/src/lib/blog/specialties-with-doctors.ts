/**
 * Paket Z2 öncesi düzeltme (kullanıcı kararı) — blog ana sayfasındaki "Browse by specialty" kartlarında yalnızca en az
 * bir aktif (herkese açık) hekimi olan uzmanlıklar gösterilir. Hekim listesi public `/doctors` ucundan gelir (yalnızca
 * aktif, arşivlenmemiş hekimler); ana uzmanlık ve ek uzmanlıklar birlikte sayılır (`/specialties/:slug` doctorCount ile aynı).
 */
export function specialtiesWithActiveDoctors<T extends { id: string; isActive?: boolean }>(
  specialties: T[],
  doctors: { specialtyId?: string | null; isActive?: boolean; additionalSpecialties?: { id: string }[] }[]
): T[] {
  const covered = new Set<string>();
  for (const doctor of doctors) {
    if (doctor.isActive === false) continue;
    if (doctor.specialtyId) covered.add(doctor.specialtyId);
    for (const extra of doctor.additionalSpecialties ?? []) covered.add(extra.id);
  }
  return specialties.filter((sp) => sp.isActive !== false && covered.has(sp.id));
}
