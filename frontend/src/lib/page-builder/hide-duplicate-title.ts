import type { PageNode } from "./types";

/**
 * Paket Z1-ek - CMS sayfa gorunumu: icerik, sayfa basligiyla AYNI bir basliga (H1/H2) ile basliyorsa o baslik
 * ikinci kez gosterilmez (sayfa basligi `PageHeader`da zaten vardir). YALNIZCA render katmanidir; veri
 * (Page.blocks) degismez. Yalnizca ilk gorunen dugum incelenir (konteynerin ilk cocugu dahil); metin blogunun
 * basindaki `<h1|h2>` ogesi de ayni kuralla soyulur. Eslesme: etiketsiz, bosluklari birlestirilmis, buyuk/kucuk
 * harf duyarsiz.
 */
const ENTITIES: Record<string, string> = { "&amp;": "&", "&nbsp;": " ", "&quot;": '"', "&#39;": "'", "&apos;": "'", "&lt;": "<", "&gt;": ">" };

export function normalizeTitle(value: string): string {
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/&(amp|nbsp|quot|apos|lt|gt|#39);/g, (m) => ENTITIES[m] ?? m)
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase();
}

const LEADING_HEADING = /^\s*<(h[12])\b[^>]*>([\s\S]*?)<\/\1>\s*/i;

function stripLeadingHeading(html: string, title: string): string | null {
  const match = LEADING_HEADING.exec(html);
  if (!match) return null;
  return normalizeTitle(match[2] ?? "") === title ? html.slice(match[0].length) : null;
}

/** `null` = bu dugumde tekrar yok; dizi = tekrar cikarilmis yeni dugum listesi (bos olabilir). */
function dropFromNode(node: PageNode, title: string): PageNode[] | null {
  if (node.type === "heading") {
    return node.data.level <= 2 && normalizeTitle(node.data.text) === title ? [] : null;
  }
  if (node.type === "text") {
    const rest = stripLeadingHeading(node.data.html, title);
    if (rest === null) return null;
    return rest.trim() === "" ? [] : [{ ...node, data: { ...node.data, html: rest } }];
  }
  if (node.type === "container") {
    const first = node.children[0];
    if (!first) return null;
    const dropped = dropFromNode(first, title);
    if (dropped === null) return null;
    const children = [...dropped, ...node.children.slice(1)];
    return children.length === 0 ? [] : [{ ...node, children }];
  }
  return null;
}

export function hideDuplicateTitle(nodes: PageNode[], pageTitle: string): PageNode[] {
  const title = normalizeTitle(pageTitle);
  if (!title) return nodes;
  let current = nodes;
  // Art arda tekrar eden basliklar da (ornegin H1 + ayni H2) temizlenir.
  for (let i = 0; i < 3; i += 1) {
    const first = current[0];
    if (!first) break;
    const dropped = dropFromNode(first, title);
    if (dropped === null) break;
    current = [...dropped, ...current.slice(1)];
  }
  return current;
}

/**
 * CMS sayfasinin gorunen dugumleri: tekrarli baslik yalnizca baslik bandi gorunuyorsa, anasayfa sablonu degilse ve
 * sayfa HUKUKI BELGE DEGILSE gizlenir (hukuki belgelerin metnine hicbir kosulda dokunulmaz).
 */
export function selectDisplayNodes(input: { nodes: PageNode[]; title: string; isLegalDocument: boolean; isHomeTemplate: boolean; headerStyle: string }): PageNode[] {
  if (input.isHomeTemplate || input.isLegalDocument || input.headerStyle === "HIDDEN") return input.nodes;
  return hideDuplicateTitle(input.nodes, input.title);
}
