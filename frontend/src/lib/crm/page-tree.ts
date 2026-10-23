import type { CrmPageRow } from "@/lib/api/crm";

/**
 * Paket N3 — Sayfa Haritası: düz yol listesini (`/en/doctors/a`) segment ağacına çevirir. Her düğüm kendi
 * yolunun ölçülerini (`own`) ve alt ağacın toplamlarını (`total`) taşır; ortalama okuma süresi ve kaydırma
 * derinliği yalnızca düğümün kendi sayfası için anlamlıdır.
 */
export interface PageTreeNode {
  segment: string;
  path: string;
  own: CrmPageRow | null;
  total: { pageviews: number; visitors: number; entries: number; contacts: number };
  children: PageTreeNode[];
}

export function buildPageTree(rows: CrmPageRow[]): PageTreeNode {
  const root: PageTreeNode = { segment: "/", path: "/", own: null, total: { pageviews: 0, visitors: 0, entries: 0, contacts: 0 }, children: [] };
  for (const row of rows) {
    const segments = row.path.split("/").filter(Boolean);
    let node = root;
    const chain: PageTreeNode[] = [root];
    let current = "";
    for (const segment of segments) {
      current += `/${segment}`;
      let child = node.children.find((c) => c.segment === segment);
      if (!child) {
        child = { segment, path: current, own: null, total: { pageviews: 0, visitors: 0, entries: 0, contacts: 0 }, children: [] };
        node.children.push(child);
      }
      node = child;
      chain.push(node);
    }
    node.own = row;
    for (const n of chain) {
      n.total.pageviews += row.pageviews;
      n.total.visitors += row.visitors;
      n.total.entries += row.entries;
      n.total.contacts += row.contacts;
    }
  }
  const sort = (n: PageTreeNode) => {
    n.children.sort((a, b) => b.total.pageviews - a.total.pageviews);
    n.children.forEach(sort);
  };
  sort(root);
  return root;
}
