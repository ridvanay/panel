import type { PublicBlogTopicGroup } from "@/lib/api/types";

/** Paket Z1 — blog ana sayfası URL ve filtre yardımcıları (saf). */
export const BLOG_PAGE_SIZE = 12;
/** "More topics" daraltmasından önce görünen konu çipi sayısı (grup başına). */
export const VISIBLE_TOPIC_CHIPS = 6;
export const MAX_QUERY_LENGTH = 100;

export function firstParam(value: string | string[] | undefined): string {
  const v = Array.isArray(value) ? value[0] : value;
  return (v ?? "").trim();
}

export function cleanQuery(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, MAX_QUERY_LENGTH);
}

export function cleanTopic(value: string): string {
  return /^[a-z0-9][a-z0-9-]{0,80}$/i.test(value) ? value : "";
}

/** `/blog`, `/blog/page/2` + isteğe bağlı `?topic=&q=` (dil öneki çağıranda eklenir). */
export function blogListPath(options: { page?: number; topic?: string; q?: string }): string {
  const base = options.page && options.page > 1 ? `/blog/page/${options.page}` : "/blog";
  const params = new URLSearchParams();
  if (options.topic) params.set("topic", options.topic);
  if (options.q) params.set("q", options.q);
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}

export function totalPages(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / pageSize));
}

/** Aktif konu hangi uzmanlık grubunda? (uzmanlık slug'ı ya da o gruptaki konu çipi). */
export function findActiveGroup(groups: PublicBlogTopicGroup[], topic: string): PublicBlogTopicGroup | null {
  if (!topic) return null;
  return groups.find((g) => g.specialty.slug === topic || g.topics.some((t) => t.slug === topic)) ?? null;
}

/**
 * Bir grubun görünür/gizli konu çipleri. Aktif konu gizli kalmasın diye görünür kümeye taşınır.
 * `hidden.length > 0` ise "More topics" gösterilir.
 */
export function splitTopicChips(
  topics: PublicBlogTopicGroup["topics"],
  activeTopic: string,
  visibleCount: number = VISIBLE_TOPIC_CHIPS
): { visible: PublicBlogTopicGroup["topics"]; hidden: PublicBlogTopicGroup["topics"] } {
  const visible = topics.slice(0, visibleCount);
  const hidden = topics.slice(visibleCount);
  const activeIndex = hidden.findIndex((t) => t.slug === activeTopic);
  if (activeIndex >= 0) {
    const [active] = hidden.splice(activeIndex, 1);
    visible.push(active!);
  }
  return { visible, hidden };
}

/** Sayfa meta kararı: konu filtreli sayfa kendi canonical'ıyla indekslenir; arama / boş sonuç noindex. */
export function listingRobots(options: { q: string; total: number }): { index: boolean; follow: boolean } {
  if (options.q || options.total === 0) return { index: false, follow: true };
  return { index: true, follow: true };
}
