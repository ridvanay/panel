import type { StatCardDelta } from "@/components/admin/stats/stat-card";

/**
 * İki dönem toplamı arasındaki yüzde değişimi üretir. Önceki dönem için veri
 * yoksa (baseline 0), anlamlı bir yüzde hesaplanamayacağı için `undefined`
 * döner ve kart delta göstermez.
 *
 * `admin/page.tsx` (Genel Bakış) ve `admin/stats/page.tsx` (İstatistikler)
 * arasında paylaşılan tek gerçek kod tekrarı bu fonksiyon olduğu için ortak
 * bir modüle çıkarıldı.
 */
export function computeDelta(current: number, previous: number): StatCardDelta | undefined {
  if (!previous || previous <= 0) return undefined;

  const changePercent = ((current - previous) / previous) * 100;
  if (!Number.isFinite(changePercent)) return undefined;

  const direction: StatCardDelta["direction"] = changePercent >= 0 ? "up" : "down";

  return {
    value: `%${Math.abs(changePercent).toFixed(1)}`,
    direction,
    isGood: direction === "up",
  };
}
