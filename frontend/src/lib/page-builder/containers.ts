import { newId } from "./registry";
import {
  DEFAULT_CONTAINER_SETTINGS,
  MAX_CHILDREN_PER_CONTAINER,
  MAX_CONTAINER_DEPTH,
  type BuilderContainerId,
  type ContainerNode,
  type ContainerSettings,
  type PageNode,
} from "./types";

/**
 * Ağaç işlemleri (§7.2/§10 mimar dokümanı, `containers.ts`). Tüm fonksiyonlar SAF'tır (girdi
 * ağacını mutasyona uğratmaz, yeni bir ağaç döner). dnd-kit konteyner kimliği sözleşmesi (v3):
 * kök liste `"root"`, her konteyner `"container:<node.id>"` (bkz. `types.ts::BuilderContainerId`).
 */

export function containerIdOf(containerId: BuilderContainerId): string | null {
  return containerId === "root" ? null : containerId.slice("container:".length);
}

export function toContainerId(id: string): BuilderContainerId {
  return `container:${id}`;
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(n, max));
}

/** Bir düğümü id'sine göre ağaçta (herhangi bir derinlikte) bulur. */
export function findNode(nodes: PageNode[], id: string): PageNode | null {
  for (const node of nodes) {
    if (node.id === id) return node;
    if (node.type === "container") {
      const found = findNode(node.children, id);
      if (found) return found;
    }
  }
  return null;
}

/** Bir düğümün DOĞRUDAN ebeveyninin konteyner kimliğini döner (`"root"` | `"container:<id>"` | bulunamazsa `null`). */
export function findParentId(nodes: PageNode[], id: string): BuilderContainerId | null {
  if (nodes.some((n) => n.id === id)) return "root";
  for (const node of nodes) {
    if (node.type !== "container") continue;
    const found = findParentIdInContainer(node, id);
    if (found) return found;
  }
  return null;
}

function findParentIdInContainer(container: ContainerNode, id: string): BuilderContainerId | null {
  if (container.children.some((c) => c.id === id)) return toContainerId(container.id);
  for (const child of container.children) {
    if (child.type !== "container") continue;
    const found = findParentIdInContainer(child, id);
    if (found) return found;
  }
  return null;
}

/** Verilen konteyner kimliğinin (kök dahil) doğrudan çocuk düğümlerini döner. */
export function getContainerChildren(nodes: PageNode[], containerId: BuilderContainerId): PageNode[] {
  if (containerId === "root") return nodes;
  const id = containerIdOf(containerId)!;
  const container = findNode(nodes, id);
  return container && container.type === "container" ? container.children : [];
}

export function getContainerChildIds(nodes: PageNode[], containerId: BuilderContainerId): string[] {
  return getContainerChildren(nodes, containerId).map((n) => n.id);
}

/**
 * `containerId`'nin, `MAX_CHILDREN_PER_CONTAINER` sınırına ULAŞTIĞINI (yeni eklemeye kapalı)
 * bildirir. Kök (`"root"`) bu sınıra TABİ DEĞİLDİR (bkz. `types.ts` — yalnızca gerçek
 * `container.children` dizileri tabidir), bu yüzden kök için her zaman `false` döner.
 */
export function isContainerAtCapacity(nodes: PageNode[], containerId: BuilderContainerId): boolean {
  if (containerId === "root") return false;
  return getContainerChildren(nodes, containerId).length >= MAX_CHILDREN_PER_CONTAINER;
}

/**
 * `ancestorId`'nin kendisi VEYA `candidateId`'nin `ancestorId`'nin alt ağacında (herhangi bir
 * derinlikte) bulunup bulunmadığını söyler — bir konteyneri kendi torununun (veya kendisinin)
 * içine bırakmayı engellemek için KRİTİK guard (`moveNode` bunu dahili olarak kullanır).
 */
export function isDescendant(nodes: PageNode[], ancestorId: string, candidateId: string): boolean {
  if (ancestorId === candidateId) return true;
  const ancestor = findNode(nodes, ancestorId);
  if (!ancestor || ancestor.type !== "container") return false;
  return containsId(ancestor.children, candidateId);
}

function containsId(nodes: PageNode[], id: string): boolean {
  for (const node of nodes) {
    if (node.id === id) return true;
    if (node.type === "container" && containsId(node.children, id)) return true;
  }
  return false;
}

/** Bir düğümün ağaçtaki derinliği (kök seviyesi = 1). Bulunamazsa 0. */
export function containerDepth(nodes: PageNode[], id: string, depth = 1): number {
  for (const node of nodes) {
    if (node.id === id) return depth;
    if (node.type === "container") {
      const found = containerDepth(node.children, id, depth + 1);
      if (found > 0) return found;
    }
  }
  return 0;
}

/**
 * Bir düğümün KENDİ alt ağacının `MAX_CONTAINER_DEPTH` bütçesine katkısı — YALNIZCA konteyner
 * seviyeleri sayılır, yaprak (içerik) bloklar KATKI YAPMAZ (`0` döner). Bir konteyner, hiç iç
 * içe konteyner taşımıyorsa (yalnızca yaprak çocukları veya hiç çocuğu olmasa da) `1` döner —
 * yani kendisi tek başına bir "seviye"dir. Bu ayrım KRİTİKTİR: mimarın kararı gereği konteynerler
 * en fazla 4. seviyede olabilir, ama yaprak bloklar 5. seviyede (bir konteynerin İÇİNDE) tamamen
 * GEÇERLİDİR — yaprakları da konteynermiş gibi sayan bir ölçüm, geçerli bir "wrap"/"moveNode"
 * işlemini YANLIŞLIKLA reddederdi.
 */
export function subtreeDepth(node: PageNode): number {
  if (node.type !== "container") return 0;
  const containerChildren = node.children.filter((child): child is ContainerNode => child.type === "container");
  if (containerChildren.length === 0) return 1;
  return 1 + Math.max(...containerChildren.map(subtreeDepth));
}

/** Verilen düğüm listesindeki TÜM düğümleri (iç içe konteynerler DAHİL) sayar. */
export function countNodes(nodes: PageNode[]): number {
  let total = 0;
  for (const node of nodes) {
    total += 1;
    if (node.type === "container") total += countNodes(node.children);
  }
  return total;
}

/** Bir düğümü ağaçtan kaldırır. Bulunamazsa `removed: null`, ağaç DEĞİŞMEDEN döner. */
export function removeNode(nodes: PageNode[], id: string): { nodes: PageNode[]; removed: PageNode | null } {
  const idx = nodes.findIndex((n) => n.id === id);
  if (idx !== -1) {
    const removed = nodes[idx]!;
    return { nodes: [...nodes.slice(0, idx), ...nodes.slice(idx + 1)], removed };
  }
  let removed: PageNode | null = null;
  const next = nodes.map((n) => {
    if (removed || n.type !== "container") return n;
    const result = removeNode(n.children, id);
    if (result.removed) {
      removed = result.removed;
      return { ...n, children: result.nodes };
    }
    return n;
  });
  return removed ? { nodes: next, removed } : { nodes, removed: null };
}

function mapContainer(nodes: PageNode[], id: string, fn: (container: ContainerNode) => ContainerNode): PageNode[] {
  return nodes.map((n) => {
    if (n.id === id && n.type === "container") return fn(n);
    if (n.type === "container") return { ...n, children: mapContainer(n.children, id, fn) };
    return n;
  });
}

/**
 * Bir düğümü verilen konteynerin (veya köke) belirtilen indekse ekler. `parentId === "root"`
 * iken sınır kontrolü YAPILMAZ (§types.ts açıklaması); gerçek bir konteyner hedefteyse
 * `MAX_CHILDREN_PER_CONTAINER` doluysa SESSİZCE no-op (girdi ağacı değişmeden döner) — bu,
 * dahili bir güvenlik ağıdır, çağıran taraf (`builder-canvas.tsx`) yine de kendi UI kontrolünü
 * (buton `disabled` vb.) uygular.
 */
export function insertNode(nodes: PageNode[], parentId: BuilderContainerId, index: number, node: PageNode): PageNode[] {
  if (parentId === "root") {
    const next = [...nodes];
    next.splice(clamp(index, 0, next.length), 0, node);
    return next;
  }
  const targetId = containerIdOf(parentId)!;
  return mapContainer(nodes, targetId, (container) => {
    if (container.children.length >= MAX_CHILDREN_PER_CONTAINER) return container;
    const children = [...container.children];
    children.splice(clamp(index, 0, children.length), 0, node);
    return { ...container, children };
  });
}

/**
 * Bir düğümü ağaçtaki başka bir konumdaki konteynere (veya köke) taşır — dnd-kit `onDragEnd`
 * ana kullanım yeridir. Guard'lar:
 *   1. `isDescendant` — konteyner kendi çocuğunun/torununun içine bırakılamaz.
 *   2. `MAX_CHILDREN_PER_CONTAINER` — hedef konteyner doluysa taşıma İPTAL edilir (no-op).
 *   3. `MAX_CONTAINER_DEPTH` — taşınan alt-ağaç, hedef derinlikte sınırı aşacaksa İPTAL edilir.
 * Üç durumda da orijinal `nodes` DEĞİŞMEDEN döner — düğüm asla "kaybolmaz".
 */
export function moveNode(nodes: PageNode[], id: string, toParentId: BuilderContainerId, toIndex: number): PageNode[] {
  if (toParentId !== "root") {
    const targetContainerId = containerIdOf(toParentId)!;
    if (isDescendant(nodes, id, targetContainerId)) return nodes;
  }

  const node = findNode(nodes, id);
  if (!node) return nodes;

  const fromParentId = findParentId(nodes, id);
  if (fromParentId === null) return nodes;

  if (toParentId !== "root" && toParentId !== fromParentId) {
    const targetContainer = findNode(nodes, containerIdOf(toParentId)!);
    if (targetContainer?.type === "container" && targetContainer.children.length >= MAX_CHILDREN_PER_CONTAINER) {
      return nodes;
    }
  }

  if (fromParentId !== toParentId) {
    const parentDepthAfterMove = toParentId === "root" ? 0 : containerDepth(nodes, containerIdOf(toParentId)!);
    if (parentDepthAfterMove + subtreeDepth(node) > MAX_CONTAINER_DEPTH) return nodes;
  }

  const { nodes: afterRemove, removed } = removeNode(nodes, id);
  if (!removed) return nodes;
  return insertNode(afterRemove, toParentId, toIndex, removed);
}

/** Bir konteynerin `settings`'ini kısmi olarak günceller (diğer alanlara dokunmaz). */
export function updateContainerSettings(nodes: PageNode[], id: string, patch: Partial<ContainerSettings>): PageNode[] {
  return mapContainer(nodes, id, (container) => ({ ...container, settings: { ...container.settings, ...patch } }));
}

/** Bir düğümün ait olduğu listeyi (kök VEYA bir konteynerin `children`'ı) DOĞRUDAN değiştirir —
 *  aynı ebeveyn içi yeniden sıralama (yukarı/aşağı taşı, dnd-kit) için `moveNode`'dan daha basit
 *  ve ucuzdur (indeks kaymalarıyla uğraşmaz). */
export function setContainerChildren(nodes: PageNode[], containerId: BuilderContainerId, children: PageNode[]): PageNode[] {
  if (containerId === "root") return children;
  const id = containerIdOf(containerId)!;
  return mapContainer(nodes, id, (container) => ({ ...container, children }));
}

/** Herhangi bir düğümü (id'sine göre, herhangi bir derinlikte) tamamen değiştirir. */
export function updateNode(nodes: PageNode[], id: string, fn: (node: PageNode) => PageNode): PageNode[] {
  return nodes.map((n) => {
    if (n.id === id) return fn(n);
    if (n.type === "container") return { ...n, children: updateNode(n.children, id, fn) };
    return n;
  });
}

/**
 * "Konteynere Sar" (§8.4 mimar dokümanı) — var olan bir düğümü, YENİ bir konteynerin tek çocuğu
 * yapar (konteyner varsayılan `DEFAULT_CONTAINER_SETTINGS` ile oluşturulur, düğüm kendi konumunu
 * korur). Çoklu-sütun düzeni artık Layout Picker'ın işidir (`presets.ts`); bu fonksiyon yalnızca
 * TEK bir sarmalama adımıdır.
 */
export function wrapInContainer(nodes: PageNode[], targetId: string): PageNode[] {
  return updateNode(nodes, targetId, (target) => {
    const wrapped: ContainerNode = {
      id: newId(),
      type: "container",
      settings: { ...DEFAULT_CONTAINER_SETTINGS },
      children: [target],
    };
    return wrapped;
  });
}

/**
 * Bir konteynerin çocuklarının ONUN YERİNE geçmesi (kaldırma/unwrap, TEK seviye — torun
 * konteynerlere DOKUNMAZ). Sessizce silmek YASAK (§8.4) — çağıran taraf (`builder-canvas.tsx`)
 * `needsConfirmToUnwrap` doğruysa önce onay diyaloğu göstermelidir.
 */
export function unwrapContainer(nodes: PageNode[], containerId: string): PageNode[] {
  const idx = nodes.findIndex((n) => n.id === containerId);
  if (idx !== -1) {
    const target = nodes[idx];
    if (!target || target.type !== "container") return nodes;
    return [...nodes.slice(0, idx), ...target.children, ...nodes.slice(idx + 1)];
  }
  return nodes.map((n) => {
    if (n.type !== "container") return n;
    return { ...n, children: unwrapContainer(n.children, containerId) };
  });
}

/** Unwrap onayı gerekip gerekmediği — yalnızca konteynerin en az bir çocuğu varsa (içerik "yeniden akar"). */
export function needsConfirmToUnwrap(node: PageNode): boolean {
  return node.type === "container" && node.children.length > 0;
}
