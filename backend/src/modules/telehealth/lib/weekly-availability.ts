import type { DoctorAvailability, Prisma } from "@prisma/client";

/**
 * Paket Q — haftalık çalışma saatleri için TEK yazma/karşılaştırma noktası. Admin
 * `PUT /admin/telehealth/doctors/:id/availability`, doktor portalı `PUT /doctor/availability` ve
 * toplu işlemler (`lib/bulk-availability.ts`) aynı fonksiyonları kullanır.
 */
export interface WeeklyRuleInput {
  dayOfWeek: number;
  startMinute: number;
  endMinute: number;
  isActive?: boolean;
}

export interface WeeklyRule {
  dayOfWeek: number;
  startMinute: number;
  endMinute: number;
  isActive: boolean;
}

export function normalizeWeeklyRules(rules: readonly WeeklyRuleInput[]): WeeklyRule[] {
  return rules
    .map((r) => ({ dayOfWeek: r.dayOfWeek, startMinute: r.startMinute, endMinute: r.endMinute, isActive: r.isActive ?? true }))
    .sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.startMinute - b.startMinute || a.endMinute - b.endMinute);
}

export const weeklyRuleKey = (r: WeeklyRuleInput) => `${r.dayOfWeek}:${r.startMinute}-${r.endMinute}:${r.isActive === false ? 0 : 1}`;

/** İki kural kümesi değer olarak aynı mı (id'lerden bağımsız)? */
export function sameWeeklyRules(a: readonly WeeklyRuleInput[], b: readonly WeeklyRuleInput[]): boolean {
  const ka = normalizeWeeklyRules(a).map(weeklyRuleKey);
  const kb = normalizeWeeklyRules(b).map(weeklyRuleKey);
  return ka.length === kb.length && ka.every((k, i) => k === kb[i]);
}

/** Aynı gündeki örtüşen AKTİF aralık çiftleri (giriş dizisindeki indekslerle). Bitişik aralıklar örtüşmez. */
export function findWeeklyOverlaps(rules: readonly WeeklyRuleInput[]): [number, number][] {
  const pairs: [number, number][] = [];
  for (let i = 0; i < rules.length; i++) {
    for (let j = i + 1; j < rules.length; j++) {
      const a = rules[i]!;
      const b = rules[j]!;
      if (a.isActive === false || b.isActive === false || a.dayOfWeek !== b.dayOfWeek) continue;
      if (a.startMinute < b.endMinute && b.startMinute < a.endMinute) pairs.push([i, j]);
    }
  }
  return pairs;
}

/** Haftalık ızgaranın TAMAMINI değiştirir (eski kurallar silinir, yenileri yazılır). Çağıran transaction sağlar. */
export async function replaceWeeklyAvailability(
  tx: Prisma.TransactionClient,
  doctorId: string,
  rules: readonly WeeklyRuleInput[],
  options: { returnRows?: boolean } = {}
): Promise<DoctorAvailability[]> {
  await tx.doctorAvailability.deleteMany({ where: { doctorId } });
  if (rules.length > 0) {
    await tx.doctorAvailability.createMany({
      data: rules.map((rule) => ({
        doctorId,
        dayOfWeek: rule.dayOfWeek,
        startMinute: rule.startMinute,
        endMinute: rule.endMinute,
        isActive: rule.isActive ?? true,
      })),
    });
  }
  if (options.returnRows === false) return [];
  return tx.doctorAvailability.findMany({ where: { doctorId }, orderBy: [{ dayOfWeek: "asc" }, { startMinute: "asc" }] });
}
