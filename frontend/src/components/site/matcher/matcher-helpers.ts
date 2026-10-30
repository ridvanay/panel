import { foldTerm, matchScore, textContainsTerm } from "@/lib/matcher/text";
import type { MatcherTopic } from "@/lib/api/matcher";

/** Paket W — sihirbaz yardımcıları (saf fonksiyonlar; testlerle sabitlenir). */

export const MATCHER_MAX_TOPICS = 3;
export const MATCHER_FREE_TEXT_MAX = 500;

/** Aranabilir terimler bir kez katlanır (her tuşta yeniden `foldTerm` çalışmasın). */
export interface IndexedTopic {
  topic: MatcherTopic;
  terms: string[];
}

export function prepareTopicIndex(topics: readonly MatcherTopic[]): IndexedTopic[] {
  return topics.map((topic) => ({ topic, terms: [topic.label, ...topic.synonyms].map(foldTerm).filter(Boolean) }));
}

function asIndex(source: readonly MatcherTopic[] | readonly IndexedTopic[]): readonly IndexedTopic[] {
  return source.length > 0 && "terms" in source[0]! ? (source as readonly IndexedTopic[]) : prepareTopicIndex(source as readonly MatcherTopic[]);
}

/** Otomatik tamamlama: aktif dil + EN eş anlamlıları; aksan/büyük-küçük harf/Türkçe İ-ı duyarsız. */
export function searchTopics(source: readonly MatcherTopic[] | readonly IndexedTopic[], query: string, limit = 8): MatcherTopic[] {
  const q = foldTerm(query);
  if (q.length < 2) return [];
  const scored: { topic: MatcherTopic; score: number }[] = [];
  for (const entry of asIndex(source)) {
    let score = 0;
    for (const term of entry.terms) score = Math.max(score, matchScore(q, term));
    if (score > 0) scored.push({ topic: entry.topic, score });
  }
  return scored
    .sort((a, b) => b.score - a.score || a.topic.label.localeCompare(b.topic.label))
    .slice(0, limit)
    .map((entry) => entry.topic);
}

/** Serbest metinde geçen konular (kırmızı bayrak dahil; çağıran ayırır). */
export function topicsInText(source: readonly MatcherTopic[] | readonly IndexedTopic[], text: string): MatcherTopic[] {
  const folded = foldTerm(text);
  if (!folded) return [];
  return asIndex(source)
    .filter((entry) => entry.terms.some((term) => textContainsTerm(folded, term)))
    .map((entry) => entry.topic);
}

/** Kullanıcının ülkesine göre acil numarası (Türkiye 112, AB 112, ABD/Kanada 911, BK 999; diğer 112). */
export function emergencyNumberFor(countryCode: string | null | undefined): string {
  switch ((countryCode ?? "").toUpperCase()) {
    case "US":
    case "CA":
    case "PR":
      return "911";
    case "GB":
      return "999";
    default:
      return "112";
  }
}

/**
 * Randevu sayfası bağlantısı — URL'ye YALNIZCA `?specialty=<uzmanlık slug>&from=matcher` eklenir.
 * Kullanıcı kararı (2026-10-30): şikayet/konu (sağlık bilgisi) URL'ye GİRMEZ.
 */
export function bookingHref(localize: (path: string) => string, doctorSlug: string, specialtySlug: string | null): string {
  const params = new URLSearchParams();
  if (specialtySlug) params.set("specialty", specialtySlug);
  params.set("from", "matcher");
  return `${localize(`/physicians/${encodeURIComponent(doctorSlug)}`)}?${params.toString()}#randevu`;
}

/** CRM olayı — yalnızca CRM izleyici yüklüyse (çerez onayı varsa) gider; kişisel veri KONMAZ. */
// Güvenlik/uyumluluk incelemesi: "matcher_red_flag" CRM olayı GÖNDERİLMEZ (ziyaretçi kimliğiyle sağlık
// çıkarımı riski); kırmızı bayrak yalnızca anonim sayaçta (`/matcher/progress`) sayılır.
export function trackMatcher(name: "matcher_start" | "matcher_step" | "matcher_result" | "matcher_book_click" | "matcher_submit", props?: Record<string, string | number | boolean>): void {
  if (typeof window === "undefined") return;
  const tracker = (window as unknown as { WMCRM?: { track?: (n: string, p?: Record<string, string | number | boolean>) => void } }).WMCRM;
  try {
    tracker?.track?.(name, props);
  } catch {
    // önemsiz
  }
}
