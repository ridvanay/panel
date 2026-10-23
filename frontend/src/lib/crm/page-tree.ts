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

export interface PageTreeRow {
  node: PageTreeNode;
  depth: number;
  hasChildren: boolean;
  open: boolean;
}

/**
 * Görünür satırlar (tablo için): önce kökün kendi satırı (varsayılan dilin öneksiz ana sayfası `/`), sonra
 * açık düğümlerin çocukları derinlik sırasıyla. Kökün kendisi bir klasör satırı olarak çizilmez.
 */
export function flattenPageTree(root: PageTreeNode, isOpen: (path: string, depth: number) => boolean): PageTreeRow[] {
  const rows: PageTreeRow[] = [];
  if (root.own) {
    rows.push({
      node: { ...root, total: { pageviews: root.own.pageviews, visitors: root.own.visitors, entries: root.own.entries, contacts: root.own.contacts }, children: [] },
      depth: 0,
      hasChildren: false,
      open: false,
    });
  }
  const walk = (node: PageTreeNode, depth: number) => {
    const open = node.children.length > 0 && isOpen(node.path, depth);
    rows.push({ node, depth, hasChildren: node.children.length > 0, open });
    if (open) for (const child of node.children) walk(child, depth + 1);
  };
  for (const child of root.children) walk(child, 0);
  return rows;
}
