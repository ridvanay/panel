import type { PageNode } from "./types";

/**
 * Paket AK (K1) — "Ziyaretçiden gizle" yardımcıları.
 *
 * Serbest sayfa oluşturucu sayfalarında blok listesi dil başına ayrıdır (`pages.blocks` +
 * `pages.translations.<dil>.blocks`). Aynı `id`'li blok ana (kanonik) listede gizliyse çeviri listesinde
 * de gizli sayılır — bir dil kopyası unutulsa bile gizlenen bölüm başka dilde sızmaz.
 */
export function collectHiddenIds(nodes: readonly PageNode[], into: Set<string> = new Set()): Set<string> {
  for (const node of nodes) {
    if (node.hidden === true) into.add(node.id);
    if (node.type === "container") collectHiddenIds(node.children, into);
  }
  return into;
}

/** `localized` listesindeki, `canonical` listesinde gizli olan `id`'li blokları `hidden: true` işaretler (girdiyi değiştirmez). */
export function inheritHiddenFromCanonical(localized: PageNode[], canonical: readonly PageNode[] | null | undefined): PageNode[] {
  if (!canonical || canonical.length === 0) return localized;
  const ids = collectHiddenIds(canonical);
  if (ids.size === 0) return localized;
  const mark = (nodes: PageNode[]): PageNode[] =>
    nodes.map((node) => {
      const next = ids.has(node.id) ? { ...node, hidden: true } : node;
      if (next.type === "container") return { ...next, children: mark(next.children) };
      return next;
    });
  return mark(localized);
}

/** Gizli blokları (ve içlerini) ağaçtan çıkarır — yapılandırılmış veri (FAQ/Place) gizli bölümden üretilmesin diye. */
export function stripHiddenNodes(nodes: PageNode[]): PageNode[] {
  const out: PageNode[] = [];
  for (const node of nodes) {
    if (node.hidden === true) continue;
    out.push(node.type === "container" ? { ...node, children: stripHiddenNodes(node.children) } : node);
  }
  return out;
}

/** Ağaçta canlı veriye bağlı (`metric`) sayaç öğesi var mı? Varsa sayfa `site-metrics`'i çeker (yoksa ek istek yok). */
export function usesCounterMetrics(nodes: readonly PageNode[]): boolean {
  return nodes.some((node) => {
    if (node.hidden === true) return false;
    if (node.type === "counter") return node.data.items.some((item) => Boolean(item.metric));
    if (node.type === "container") return usesCounterMetrics(node.children);
    return false;
  });
}
