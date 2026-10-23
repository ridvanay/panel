import type { CrmScoreWeights } from "./crm.settings";

/**
 * Paket N — ziyaretçi sıcaklık puanı (0–100). Ağırlıklar CRM → Ayarlar'dan değiştirilebilir.
 *
 *   puan = min(30, okunan_dakika × perEngagedMinute)
 *        + min(30, sayfa_görüntüleme × perPageview)
 *        + min(20, (ziyaret_sayısı − 1) × perReturnVisit)
 *        + (randevu sihirbazına geldiyse bookingPage)
 *        + (temas tıklaması varsa contactClick)
 *   → 100 ile sınırlanır.
 */
export interface ScoreInput {
  engagedSeconds: number;
  pageviewCount: number;
  sessionCount: number;
  reachedBooking: boolean;
  contactClicks: number;
}

export function computeVisitorScore(input: ScoreInput, weights: CrmScoreWeights): number {
  const minutes = Math.floor(Math.max(0, input.engagedSeconds) / 60);
  const score =
    Math.min(30, minutes * weights.perEngagedMinute) +
    Math.min(30, Math.max(0, input.pageviewCount) * weights.perPageview) +
    Math.min(20, Math.max(0, input.sessionCount - 1) * weights.perReturnVisit) +
    (input.reachedBooking ? weights.bookingPage : 0) +
    (input.contactClicks > 0 ? weights.contactClick : 0);
  return Math.max(0, Math.min(100, Math.round(score)));
}
