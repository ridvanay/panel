/**
 * Sürükle-bırakla iç-içe geçirilebilen (en fazla `NAVIGATION_MAX_DEPTH + 1` seviye — bkz.
 * `@/lib/navigation-constants`) navigasyon ağacı için SAF (pure) mantık. Bkz.
 * `.claude/design-notes-navigation-menu-editor.md` Karar 3-5,
 * `.claude/architect-scope-navigation-deep-nesting.md` §2 ve ARCHITECTURE.md §10.10.1 / §10.10.3 /
 * §10.10.3.1.
 *
 * Kanonik (canonical) state: `FlatNavItem[]` — HER ZAMAN "derinlik-önce" (depth-first) sırada
 * tutulur, yani her kök öğe hemen ardından KENDİ alt ağacıyla (tüm torunlarıyla, derinlik-önce)
 * gelir (`(parentId NULLS FIRST, order)` sunucu sıralamasıyla aynı sonucu üretir). Bu değişmez
 * (invariant) her mutasyon fonksiyonu tarafından korunur — dizinin ortasına "yabancı" bir kök
 * sokulmaz.
 *
 * TÜM fonksiyonlar derinlikten BAĞIMSIZDIR — hiçbir yerde derinlik sayısı hardcode edilmez, tek
 * sınır `NAVIGATION_MAX_DEPTH` sabitinden okunur (bkz. `@/lib/navigation-constants`).
 */

import { NAVIGATION_MAX_DEPTH } from "@/lib/navigation-constants";

/** Sürükleme sırasında imleç ofsetini (px) derinlik adımına çevirmek için kullanılan SABİT adım
 * genişliği — ui-designer kararı (a): 32 → 20px (bkz. `.claude/ui-designer-navigation-flyout-spec.md`). */
export const INDENTATION_WIDTH = 20;

export interface FlatNavItem {
  id: string;
  label: string;
  href: string;
  /** null ise kök seviye öğe. */
  parentId: string | null;
}

/** Bir öğenin doğrudan ebeveynden köke kadar giden ATA SAYISI (kök = 0). `parentId` zincirini
 * yürüyerek hesaplanır — `depth` kolonu DB'de tutulmaz (bkz. ARCHITECTURE.md §10.10.1), burada da
 * türetilir. Bozuk (döngülü) state'e karşı savunma amaçlı `visited` seti ile sonsuz döngü engellenir
 * (normalde bu editörün ürettiği state'te döngü oluşamaz — mutasyonlar hep ağaç-korur). */
export function getDepth(items: FlatNavItem[], id: string): number {
  const byId = new Map(items.map((item) => [item.id, item] as const));
  const visited = new Set<string>();
  let depth = 0;
  let current = byId.get(id);
  while (current && current.parentId !== null) {
    if (visited.has(current.id)) break;
    visited.add(current.id);
    depth++;
    current = byId.get(current.parentId);
  }
  return depth;
}

export function hasChildren(items: FlatNavItem[], id: string): boolean {
  return items.some((item) => item.parentId === id);
}

/** Bir öğenin altındaki en derin dalın YÜKSEKLİĞİ (yapraksa 0). `canIndent`/`computeProjection`
 * bir öğeyi taşırken ONUN ALTINDAKİ tüm alt ağacın da yeni konumda `NAVIGATION_MAX_DEPTH`'i
 * aşmayacağını garanti etmek için bunu kullanır. */
export function subtreeHeight(items: FlatNavItem[], id: string): number {
  const children = items.filter((item) => item.parentId === id);
  if (children.length === 0) return 0;
  return 1 + Math.max(...children.map((child) => subtreeHeight(items, child.id)));
}

/** Bir öğenin TÜM alt ağacının (doğrudan + dolaylı torunlarının) id kümesi. */
function getDescendantIds(items: FlatNavItem[], id: string): Set<string> {
  const result = new Set<string>();
  const stack: string[] = [id];
  while (stack.length > 0) {
    const current = stack.pop()!;
    for (const item of items) {
      if (item.parentId === current && !result.has(item.id)) {
        result.add(item.id);
        stack.push(item.id);
      }
    }
  }
  return result;
}

/** Yeni içerik/özel bağlantı öğelerini kök seviyenin SONUNA ekler (Karar 2.1/2.2). */
export function appendRootItems(items: FlatNavItem[], newItems: Omit<FlatNavItem, "parentId">[]): FlatNavItem[] {
  return [...items, ...newItems.map((item) => ({ ...item, parentId: null }))];
}

/** Bir öğeyi VE onun TÜM alt ağacını (doğrudan + dolaylı torunlarını) kaldırır. Bunu atlamak
 * torunları orphan bırakır ve `PUT /admin/navigation`'ı 422'ye düşürür (bkz. ARCHITECTURE.md
 * §10.10.3.1 — çözülebilirlik kuralı). */
export function removeItemCascade(items: FlatNavItem[], id: string): FlatNavItem[] {
  const toRemove = getDescendantIds(items, id);
  toRemove.add(id);
  return items.filter((item) => !toRemove.has(item.id));
}

export function updateItem(items: FlatNavItem[], id: string, patch: Partial<Pick<FlatNavItem, "label" | "href">>): FlatNavItem[] {
  return items.map((item) => (item.id === id ? { ...item, ...patch } : item));
}

/**
 * Bir öğe, kendisinden önce AYNI seviyede (aynı `parentId`) bir kardeşi varsa VE yeni konumda
 * (kendi derinliği + 1) + (kendi alt ağacının yüksekliği) `NAVIGATION_MAX_DEPTH`'i aşmıyorsa
 * indent edilebilir. "Çocuğu varsa indent yasak" kuralı KALKTI (architect-scope §2) — bir öğe
 * kendi alt ağacıyla BİRLİKTE taşınır, yeter ki toplam derinlik sınırı aşılmasın.
 */
export function canIndent(items: FlatNavItem[], id: string): boolean {
  const index = items.findIndex((item) => item.id === id);
  if (index <= 0) return false;
  const item = items[index]!;
  const hasPrecedingSibling = items.slice(0, index).some((prior) => prior.parentId === item.parentId);
  if (!hasPrecedingSibling) return false;
  const currentDepth = getDepth(items, id);
  const height = subtreeHeight(items, id);
  return currentDepth + 1 + height <= NAVIGATION_MAX_DEPTH;
}

export function canOutdent(items: FlatNavItem[], id: string): boolean {
  const item = items.find((i) => i.id === id);
  return Boolean(item) && getDepth(items, id) > 0;
}

/** Aynı ebeveyne (`parentId`) sahip kardeşleri, kanonik derinlik-önce sıradaki GÖRELİ sırayla döner. */
function siblingsOf(items: FlatNavItem[], id: string): FlatNavItem[] {
  const item = items.find((i) => i.id === id);
  if (!item) return [];
  return items.filter((i) => i.parentId === item.parentId);
}

/** Yukarı ok butonu için — kardeşleri arasında zaten ilk sıradaysa (ya da öğe yoksa) false döner. */
export function canMoveUpSibling(items: FlatNavItem[], id: string): boolean {
  const siblings = siblingsOf(items, id);
  const index = siblings.findIndex((i) => i.id === id);
  return index > 0;
}

/** Aşağı ok butonu için — kardeşleri arasında zaten son sıradaysa (ya da öğe yoksa) false döner. */
export function canMoveDownSibling(items: FlatNavItem[], id: string): boolean {
  const siblings = siblingsOf(items, id);
  const index = siblings.findIndex((i) => i.id === id);
  return index !== -1 && index < siblings.length - 1;
}

/**
 * Fail-safe yukarı/aşağı ok butonları — Karar 5.6'nın sürükle-bırak alternatifidir. Öğeyi AYNI
 * ebeveyne sahip bir komşu kardeşle yer değiştirir (indent/outdent'ten farklı olarak `parentId`
 * DEĞİŞMEZ). `flattenDepthFirst` ile normalize edilerek kanonik derinlik-önce sıra korunur.
 */
export function moveSibling(items: FlatNavItem[], id: string, direction: -1 | 1): FlatNavItem[] {
  const canMove = direction === -1 ? canMoveUpSibling(items, id) : canMoveDownSibling(items, id);
  if (!canMove) return items;

  const item = items.find((i) => i.id === id)!;
  const siblings = siblingsOf(items, id);
  const siblingIndex = siblings.findIndex((i) => i.id === id);
  const targetSibling = siblings[siblingIndex + direction]!;

  const index = items.findIndex((i) => i.id === id);
  const targetIndex = items.findIndex((i) => i.id === targetSibling.id);
  const swapped = [...items];
  swapped[index] = items[targetIndex]!;
  swapped[targetIndex] = item;

  return flattenDepthFirst(swapped);
}

/**
 * Öğeyi, kendisinden önceki en yakın AYNI SEVİYEDEKİ kardeşin çocuk listesinin SONUNA taşır
 * (Karar 3, çok seviyeli genelleme — architect-scope §2). Öğenin kendi alt ağacı (varsa) `parentId`
 * referansları değişmediği için otomatik olarak onunla birlikte taşınır; fiziksel dizideki tam
 * ekleme konumu önemli değildir çünkü sonuç `flattenDepthFirst` ile kanonikleştirilir (gruplama
 * tamamen `parentId` üzerinden yapılır — ARCHITECTURE.md §10.10.1).
 */
export function indentItem(items: FlatNavItem[], id: string): FlatNavItem[] {
  if (!canIndent(items, id)) return items;
  const index = items.findIndex((item) => item.id === id);
  const item = items[index]!;
  let precedingSiblingIndex = -1;
  for (let i = index - 1; i >= 0; i--) {
    if (items[i]!.parentId === item.parentId) {
      precedingSiblingIndex = i;
      break;
    }
  }
  if (precedingSiblingIndex === -1) return items;
  const precedingSibling = items[precedingSiblingIndex]!;

  const updated = items.map((i) => (i.id === id ? { ...i, parentId: precedingSibling.id } : i));
  return flattenDepthFirst(updated);
}

/**
 * Öğeyi bir üst seviyeye (eski ebeveyninin ebeveynine — kök ise `null`) taşır; alt ağacı `parentId`
 * referansları değişmediği için onunla birlikte gelir. Sonuç `flattenDepthFirst` ile
 * kanonikleştirilir — eski ebeveyninin (kalan) alt ağacının HEMEN ARDINDAN görünür (Karar 3:
 * "görsel sıçrama olmasın").
 */
export function outdentItem(items: FlatNavItem[], id: string): FlatNavItem[] {
  if (!canOutdent(items, id)) return items;
  const item = items.find((i) => i.id === id)!;
  const parent = items.find((i) => i.id === item.parentId)!;

  const updated = items.map((i) => (i.id === id ? { ...i, parentId: parent.parentId } : i));
  return flattenDepthFirst(updated);
}

export interface DropProjection {
  depth: number;
  parentId: string | null;
}

/** `withoutActive` içinde, `item`'ın atalarını `targetDepth`'e ULAŞANA kadar yukarı çıkarak bulur
 * (item'ın kendisi zaten `targetDepth`'teyse onu döner). `computeProjection`'ın hedef derinlikteki
 * yeni ebeveyni bulmasının genel (derinlikten bağımsız) yoludur. */
function findAncestorAtDepth(items: FlatNavItem[], item: FlatNavItem, targetDepth: number): FlatNavItem | null {
  let current: FlatNavItem | null = item;
  let depth = getDepth(items, item.id);
  while (current && depth > targetDepth) {
    current = current.parentId ? (items.find((i) => i.id === current!.parentId) ?? null) : null;
    depth -= 1;
  }
  return current;
}

/**
 * Sürükleme sırasında imlecin yatay ofsetine (`offsetX`, px) ve bırakma pozisyonundan hemen
 * önceki öğeye göre projelenen derinliği/ebeveyni hesaplar (Karar 5.3, çok seviyeli genelleme).
 * `withoutActive`, aktif öğe (ve TÜM alt ağacı) çıkarılmış, hedef konuma göre YENİDEN sıralanmış
 * listedir; `insertAt` bu liste içindeki hedef ekleme indeksidir. `activeSubtreeHeight` (yapraksa 0)
 * — aktif öğenin alt ağacı yeni konumda da `NAVIGATION_MAX_DEPTH`'i aşmasın diye izin verilen
 * maksimum derinliği aşağı çeker (eski `activeHasChildren ? 0 : ...` hack'inin yerini alır).
 */
export function computeProjection(
  withoutActive: FlatNavItem[],
  insertAt: number,
  activeSubtreeHeight: number,
  activeDepth: number,
  offsetX: number
): DropProjection {
  const previousItem = insertAt > 0 ? (withoutActive[insertAt - 1] ?? null) : null;
  const previousDepth = previousItem ? getDepth(withoutActive, previousItem.id) : 0;
  const dragDepthDelta = Math.round(offsetX / INDENTATION_WIDTH);
  let projected = activeDepth + dragDepthDelta;

  const depthCeiling = NAVIGATION_MAX_DEPTH - activeSubtreeHeight;
  const maxAllowed = previousItem ? Math.min(previousDepth + 1, depthCeiling) : 0;
  projected = Math.max(0, Math.min(projected, maxAllowed));

  if (projected === 0) return { depth: 0, parentId: null };
  const ancestor = findAncestorAtDepth(withoutActive, previousItem!, projected - 1);
  return { depth: projected, parentId: ancestor ? ancestor.id : null };
}

export interface NavTreeNode {
  item: FlatNavItem;
  children: NavTreeNode[];
}

/**
 * Render için: kök öğeleri sırayla, her biri KENDİ ALT AĞACIYLA (özyinelemeli `NavTreeNode[]`)
 * döner. İki geçişli `parentId -> children[]` haritası (O(n)) — `items`'in FİZİKSEL dizi sırasından
 * bağımsızdır, gruplama tamamen `parentId` üzerinden yapılır (ARCHITECTURE.md §10.10.1). Ebeveyni
 * payload içinde bulunamayan (orphan) öğeler ATLANIR — tüm ağaç düşürülmez.
 */
export function buildTree(items: FlatNavItem[]): NavTreeNode[] {
  const nodeById = new Map<string, NavTreeNode>();
  for (const item of items) nodeById.set(item.id, { item, children: [] });

  const roots: NavTreeNode[] = [];
  for (const item of items) {
    const node = nodeById.get(item.id)!;
    if (item.parentId === null) {
      roots.push(node);
      continue;
    }
    const parent = nodeById.get(item.parentId);
    if (parent) {
      parent.children.push(node);
    }
    // orphan (ebeveyni payload'da yok) -> atla, ağacın geri kalanı etkilenmez.
  }
  return roots;
}

/** `buildTree`'yi derinlik-önce (depth-first) düz bir diziye geri çevirir — kanonik gösterim sırası. */
export function flattenDepthFirst(items: FlatNavItem[]): FlatNavItem[] {
  const result: FlatNavItem[] = [];
  function visit(nodes: NavTreeNode[]) {
    for (const node of nodes) {
      result.push(node.item);
      visit(node.children);
    }
  }
  visit(buildTree(items));
  return result;
}

/**
 * Aktif öğeyi (kendi TÜM alt ağacıyla birlikte — resmi dnd-kit "Sortable Tree" örneğindeki
 * `removeChildrenOf` ile aynı gerekçe: bir öğe kendi altına/üstüne bırakılamaz, ama artık yalnızca
 * doğrudan çocuklar değil TÜM torunlar aday listesinden çıkarılır) hedef konuma taşır,
 * projeksiyonu (`computeProjection`) uygulayarak `parentId`'sini günceller. `overId === null` —
 * pointer listenin SONUNU geçtiğinde (dnd-kit `DragEndEvent.over === null`) — listenin en sonuna
 * ekleneceği anlamına gelir (bu, SON öğenin altına iç-içe geçirmenin TEK yoludur: ondan sonra
 * hover edilecek başka bir satır yoktur). Dönüş değeri HER ZAMAN kanonik derinlik-önce sırada
 * olacak şekilde yeniden düzleştirilir (`flattenDepthFirst`) — çağıranın sonraki indent/outdent/
 * render işlemleri için fiziksel diziyle uğraşmasına gerek kalmaz.
 */
interface MoveContext {
  without: FlatNavItem[];
  insertAt: number;
  activeItem: FlatNavItem;
  activeDescendantIds: Set<string>;
  projection: DropProjection;
}

function computeMoveContext(items: FlatNavItem[], activeId: string, overId: string | null, offsetX: number): MoveContext | null {
  const flat = flattenDepthFirst(items);
  const activeIndex = flat.findIndex((i) => i.id === activeId);
  if (activeIndex === -1) return null;
  const activeItem = flat[activeIndex]!;
  const activeDepth = getDepth(items, activeId);
  const activeDescendantIds = getDescendantIds(items, activeId);
  const activeSubtreeHeight = subtreeHeight(items, activeId);

  const without = flat.filter((i) => i.id !== activeId && !activeDescendantIds.has(i.id));

  let insertAt: number;
  if (overId === null) {
    insertAt = without.length;
  } else {
    const overIndex = without.findIndex((i) => i.id === overId);
    insertAt = overIndex === -1 ? without.length : overIndex;
  }

  const projection = computeProjection(without, insertAt, activeSubtreeHeight, activeDepth, offsetX);
  return { without, insertAt, activeItem, activeDescendantIds, projection };
}

/**
 * Sürükleme SIRASINDA (henüz bırakılmadan) canlı bir önizleme için — `moveItem`'ın hesapladığı
 * projeksiyonu, state'i DEĞİŞTİRMEDEN döner. Bırakma göstergesinin (`DropIndicator`) hangi
 * derinlikte render edileceğini belirlemek için kullanılır.
 */
export function previewProjection(
  items: FlatNavItem[],
  activeId: string | null,
  overId: string | null,
  offsetX: number
): DropProjection | null {
  if (!activeId) return null;
  const ctx = computeMoveContext(items, activeId, overId, offsetX);
  return ctx ? ctx.projection : null;
}

export function moveItem(items: FlatNavItem[], activeId: string, overId: string | null, offsetX: number): FlatNavItem[] {
  const ctx = computeMoveContext(items, activeId, overId, offsetX);
  if (!ctx) return items;
  const { without, insertAt, activeItem, activeDescendantIds, projection } = ctx;

  const updatedActive: FlatNavItem = { ...activeItem, parentId: projection.parentId };
  const reordered = [...without.slice(0, insertAt), updatedActive, ...without.slice(insertAt)];

  const activeDescendants = items.filter((i) => activeDescendantIds.has(i.id));
  return flattenDepthFirst([...reordered, ...activeDescendants]);
}

/** `PUT /admin/navigation` payload'ı — sunucunun beklediği kardeş-kapsamlı `order`'ı özyinelemeli
 * olarak hesaplar (her seviyede 0'dan başlar, global bir indeks DEĞİLDİR — ARCHITECTURE.md §10.10.1). */
export function toNavigationItemsPayload(
  items: FlatNavItem[]
): { id: string; label: string; href: string; order: number; parentId: string | null }[] {
  const result: { id: string; label: string; href: string; order: number; parentId: string | null }[] = [];
  function visit(nodes: NavTreeNode[], parentId: string | null) {
    nodes.forEach((node, order) => {
      result.push({ id: node.item.id, label: node.item.label, href: node.item.href, order, parentId });
      visit(node.children, node.item.id);
    });
  }
  visit(buildTree(items), null);
  return result;
}
