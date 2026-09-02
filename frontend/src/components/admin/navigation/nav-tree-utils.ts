/**
 * Sürükle-bırakla iç-içe geçirilebilen (max. 2 seviye) navigasyon ağacı için SAF (pure) mantık.
 * Bkz. `.claude/design-notes-navigation-menu-editor.md` Karar 3-5 ve ARCHITECTURE.md §10.10.1.
 *
 * Kanonik (canonical) state: `FlatNavItem[]` — HER ZAMAN "derinlik-önce" (depth-first) sırada
 * tutulur, yani her kök öğe hemen ardından KENDİ çocuklarıyla gelir (`(parentId NULLS FIRST,
 * order)` sunucu sıralamasıyla aynı sonucu üretir). Bu değişmez (invariant) her mutasyon
 * fonksiyonu tarafından korunur — dizinin ortasına "yabancı" bir kök sokulmaz.
 */

export const INDENTATION_WIDTH = 32;
/** Maksimum derinlik 2 (kök + 1 alt) — ARCHITECTURE.md §10.10.1 ile bağlayıcı. */
export const MAX_DEPTH = 1;

export interface FlatNavItem {
  id: string;
  label: string;
  href: string;
  /** null ise kök seviye öğe. */
  parentId: string | null;
}

export function getDepth(item: Pick<FlatNavItem, "parentId">): 0 | 1 {
  return item.parentId === null ? 0 : 1;
}

export function hasChildren(items: FlatNavItem[], id: string): boolean {
  return items.some((item) => item.parentId === id);
}

/** Yeni içerik/özel bağlantı öğelerini kök seviyenin SONUNA ekler (Karar 2.1/2.2). */
export function appendRootItems(items: FlatNavItem[], newItems: Omit<FlatNavItem, "parentId">[]): FlatNavItem[] {
  return [...items, ...newItems.map((item) => ({ ...item, parentId: null }))];
}

/** Bir öğeyi (ve kök ise TÜM çocuklarını) kaldırır. */
export function removeItemCascade(items: FlatNavItem[], id: string): FlatNavItem[] {
  return items.filter((item) => item.id !== id && item.parentId !== id);
}

export function updateItem(items: FlatNavItem[], id: string, patch: Partial<Pick<FlatNavItem, "label" | "href">>): FlatNavItem[] {
  return items.map((item) => (item.id === id ? { ...item, ...patch } : item));
}

/**
 * `depth === 0` VE kendisinden önce başka bir kök öğe varsa VE kendi çocuğu yoksa aktif olur.
 * Son koşul (Karar 5.3'ün indent/outdent butonlarına uygulanmış hâli — özet madde 6):
 * çocuğu olan bir kök öğe asla başka bir öğenin altına taşınamaz, aksi halde 3. seviye
 * (torun) oluşurdu.
 */
export function canIndent(items: FlatNavItem[], id: string): boolean {
  const index = items.findIndex((item) => item.id === id);
  if (index <= 0) return false;
  const item = items[index]!;
  if (getDepth(item) !== 0) return false;
  if (hasChildren(items, id)) return false;
  // Kendisinden önce başka bir kök öğe var mı?
  return items.slice(0, index).some((prior) => getDepth(prior) === 0);
}

export function canOutdent(items: FlatNavItem[], id: string): boolean {
  const item = items.find((i) => i.id === id);
  return Boolean(item) && getDepth(item!) === 1;
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

/** Öğeyi, kendisinden önceki en yakın kök öğenin çocuk listesinin SONUNA taşır (Karar 3). */
export function indentItem(items: FlatNavItem[], id: string): FlatNavItem[] {
  if (!canIndent(items, id)) return items;
  const index = items.findIndex((item) => item.id === id);
  const item = items[index]!;
  let precedingRootIndex = -1;
  for (let i = index - 1; i >= 0; i--) {
    if (getDepth(items[i]!) === 0) {
      precedingRootIndex = i;
      break;
    }
  }
  if (precedingRootIndex === -1) return items;
  const precedingRoot = items[precedingRootIndex]!;

  const without = items.filter((i) => i.id !== id);
  const newParentIndex = without.findIndex((i) => i.id === precedingRoot.id);
  let insertAt = newParentIndex + 1;
  while (insertAt < without.length && without[insertAt]!.parentId === precedingRoot.id) insertAt++;

  const movedItem: FlatNavItem = { ...item, parentId: precedingRoot.id };
  return [...without.slice(0, insertAt), movedItem, ...without.slice(insertAt)];
}

/**
 * Öğeyi kök seviyeye taşır; eski ebeveyninin (kalan) çocuk bloğunun HEMEN ARDINDAN eklenir —
 * yani eski ebeveyninden sonraki ilk kök öğe konumuna gelir (Karar 3: "görsel sıçrama olmasın").
 */
export function outdentItem(items: FlatNavItem[], id: string): FlatNavItem[] {
  if (!canOutdent(items, id)) return items;
  const item = items.find((i) => i.id === id)!;
  const parentId = item.parentId!;

  const without = items.filter((i) => i.id !== id);
  const parentIndex = without.findIndex((i) => i.id === parentId);
  let insertAt = parentIndex + 1;
  while (insertAt < without.length && without[insertAt]!.parentId === parentId) insertAt++;

  const movedItem: FlatNavItem = { ...item, parentId: null };
  return [...without.slice(0, insertAt), movedItem, ...without.slice(insertAt)];
}

export interface DropProjection {
  depth: 0 | 1;
  parentId: string | null;
}

/**
 * Sürükleme sırasında imlecin yatay ofsetine (`offsetX`, px) ve bırakma pozisyonundan hemen
 * önceki öğeye göre projelenen derinliği/ebeveyni hesaplar (Karar 5.3). `withoutActive`,
 * aktif öğe (ve varsa çocuk bloğu) çıkarılmış, hedef konuma göre YENİDEN sıralanmış listedir;
 * `insertAt` bu liste içindeki hedef ekleme indeksidir.
 */
export function computeProjection(
  withoutActive: FlatNavItem[],
  insertAt: number,
  activeHasChildren: boolean,
  activeDepth: 0 | 1,
  offsetX: number
): DropProjection {
  const previousItem = insertAt > 0 ? withoutActive[insertAt - 1] ?? null : null;
  const previousDepth = previousItem ? getDepth(previousItem) : 0;
  const dragDepthDelta = Math.round(offsetX / INDENTATION_WIDTH);
  let projected = activeDepth + dragDepthDelta;

  const maxAllowed = activeHasChildren ? 0 : previousItem ? Math.min(previousDepth + 1, MAX_DEPTH) : 0;
  projected = Math.max(0, Math.min(projected, maxAllowed)) as 0 | 1;

  if (projected === 0) return { depth: 0, parentId: null };
  const parentId = previousItem!.parentId === null ? previousItem!.id : previousItem!.parentId;
  return { depth: 1, parentId };
}

export interface NavTreeNode {
  item: FlatNavItem;
  children: FlatNavItem[];
}

/**
 * Render için: kök öğeleri sırayla, her biri kendi çocuk listesiyle döner. `items`'in FİZİKSEL
 * dizi sırası önemli değildir — gruplama tamamen `parentId` üzerinden yapılır (kardeşler
 * arasındaki GÖRELİ sıra `Array.filter`'ın sabit/stable doğası sayesinde korunur).
 */
export function buildTree(items: FlatNavItem[]): NavTreeNode[] {
  const roots = items.filter((item) => item.parentId === null);
  return roots.map((root) => ({
    item: root,
    children: items.filter((item) => item.parentId === root.id),
  }));
}

/** `buildTree`'yi derinlik-önce (depth-first) düz bir diziye geri çevirir — kanonik gösterim sırası. */
export function flattenDepthFirst(items: FlatNavItem[]): FlatNavItem[] {
  return buildTree(items).flatMap((node) => [node.item, ...node.children]);
}

/**
 * Aktif öğeyi (kök ise, sürüklenirken kendi çocuk bloğu ADAY listesinden geçici olarak
 * çıkarılır — resmi dnd-kit "Sortable Tree" örneğindeki `removeChildrenOf` ile aynı gerekçe:
 * bir öğe kendi altına/üstüne bırakılamaz) hedef konuma taşır, projeksiyonu
 * (`computeProjection`) uygulayarak `parentId`'sini günceller. `overId === null` — pointer
 * listenin SONUNU geçtiğinde (dnd-kit `DragEndEvent.over === null`) — listenin en sonuna
 * ekleneceği anlamına gelir (bu, SON öğenin altına iç-içe geçirmenin TEK yoludur: ondan
 * sonra hover edilecek başka bir satır yoktur). Dönüş değeri HER ZAMAN kanonik derinlik-önce
 * sırada olacak şekilde yeniden düzleştirilir (`flattenDepthFirst`) — çağıranın sonraki
 * indent/outdent/render işlemleri için fiziksel diziyle uğraşmasına gerek kalmaz.
 */
interface MoveContext {
  without: FlatNavItem[];
  insertAt: number;
  activeItem: FlatNavItem;
  activeHasChildren: boolean;
  projection: DropProjection;
}

function computeMoveContext(items: FlatNavItem[], activeId: string, overId: string | null, offsetX: number): MoveContext | null {
  const flat = flattenDepthFirst(items);
  const activeIndex = flat.findIndex((i) => i.id === activeId);
  if (activeIndex === -1) return null;
  const activeItem = flat[activeIndex]!;
  const activeDepth = getDepth(activeItem);
  const activeHasChildren = hasChildren(items, activeId);

  const without = flat.filter((i) => i.id !== activeId && !(activeHasChildren && i.parentId === activeId));

  let insertAt: number;
  if (overId === null) {
    insertAt = without.length;
  } else {
    const overIndex = without.findIndex((i) => i.id === overId);
    insertAt = overIndex === -1 ? without.length : overIndex;
  }

  const projection = computeProjection(without, insertAt, activeHasChildren, activeDepth, offsetX);
  return { without, insertAt, activeItem, activeHasChildren, projection };
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
  const { without, insertAt, activeItem, activeHasChildren, projection } = ctx;

  const updatedActive: FlatNavItem = { ...activeItem, parentId: projection.parentId };
  const reordered = [...without.slice(0, insertAt), updatedActive, ...without.slice(insertAt)];

  const activeChildren = activeHasChildren ? items.filter((i) => i.parentId === activeId) : [];
  return flattenDepthFirst([...reordered, ...activeChildren]);
}

/** `PUT /admin/navigation` payload'ı — sunucunun beklediği kardeş-kapsamlı `order`'ı hesaplar. */
export function toNavigationItemsPayload(
  items: FlatNavItem[]
): { id: string; label: string; href: string; order: number; parentId: string | null }[] {
  const tree = buildTree(items);
  const result: { id: string; label: string; href: string; order: number; parentId: string | null }[] = [];
  tree.forEach((node, rootOrder) => {
    result.push({ id: node.item.id, label: node.item.label, href: node.item.href, order: rootOrder, parentId: null });
    node.children.forEach((child, childOrder) => {
      result.push({ id: child.id, label: child.label, href: child.href, order: childOrder, parentId: node.item.id });
    });
  });
  return result;
}
