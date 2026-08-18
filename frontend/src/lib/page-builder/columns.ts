import { newId } from "./registry";
import type { Block, BuilderContainerId, ColumnsBlock, LeafBlock, PageColumn } from "./types";

export function isColumnsBlock(block: Block): block is ColumnsBlock {
  return block.type === "columns";
}

/**
 * §10.17.8 (geriye dönük uyumluluk) — eski (v1, sabit `columnCount`/`ratio`) şeklinde
 * kaydedilmiş bir sayfa bir sonraki WRITE'ta backend tarafından v2'ye çevrilir (bkz.
 * `pages.schemas.ts::ColumnsBlockDataPreprocessed`), ama `GET` yanıtı ARA DÖNEMDE hâlâ eski
 * şekli (her sütunda `width` YOK, üst seviyede `ratio` VAR) döndürebilir. Bu durumda salt
 * `width ?? 1` ile hepsini eşit varsaymak, kaydedilmiş "2-1"/"1-2" oranını görsel olarak
 * SESSİZCE BOZAR (bir sonraki kayda kadar). Bu fonksiyon aynı `ratio → width` çevrimini
 * OKUMA tarafında da uygular ki eski bir sayfa dokunulmadan görüntülendiğinde bile orijinal
 * görünümü KORUNSUN — hem admin editör önizlemesi (`builder-canvas.tsx`) hem public render
 * (`components/site/blocks/columns-block.tsx`) bunu kullanır (WYSIWYG parite).
 */
export function resolveColumnWidth(data: { ratio?: unknown; columns: { width?: unknown }[] }, index: number): number {
  const raw = data.columns[index]?.width;
  if (typeof raw === "number" && raw > 0) return raw;
  if (data.ratio === "2-1") return index === 0 ? 2 : 1;
  if (data.ratio === "1-2") return index === 1 ? 2 : 1;
  return 1;
}

function emptyColumn(): PageColumn {
  return { id: newId(), width: 1, blocks: [] };
}

/** Bir satırdaki tüm sütunları eşit ağırlığa (1) sıfırlar — otomatik yeniden dengeleme (§10.17.3 v2). */
function rebalanceEqual(columns: PageColumn[]): PageColumn[] {
  return columns.map((c) => ({ ...c, width: 1 }));
}

/**
 * Sarmalama (`full → satır`, §10.17.3): blok, 0. sütunu kendisi olan yeni bir `ColumnsBlock` ile
 * değiştirilir; diğer sütun(lar) boş başlar. `initialCount` her zaman 2'dir (v2'de büyüme "+"
 * butonuyla `addColumnToRow` üzerinden yapılır, sabit bir 2/3 seçici YOKTUR).
 */
export function wrapInColumns(blocks: Block[], blockId: string, initialCount = 2): Block[] {
  const index = blocks.findIndex((b) => b.id === blockId);
  if (index === -1) return blocks;
  const target = blocks[index]!;
  if (target.type === "columns" || target.type === "hero") return blocks; // 422'lik durumu istemci tarafında engelle

  const columns: PageColumn[] = [{ id: newId(), width: 1, blocks: [target as LeafBlock] }];
  for (let i = 1; i < initialCount; i += 1) columns.push(emptyColumn());

  const wrapped: ColumnsBlock = {
    id: newId(),
    type: "columns",
    data: { gap: "md", verticalAlign: "top", columns },
  };

  return [...blocks.slice(0, index), wrapped, ...blocks.slice(index + 1)];
}

/**
 * "+" — satırın sağına yeni bir sütun (verilen bloğu içeren) ekler. Sütun sayısı arttığı için
 * TÜM sütunlar otomatik olarak eşit genişliğe sıfırlanır (§10.17.3 v2 madde 1).
 */
export function addColumnToRow(blocks: Block[], columnsBlockId: string, newBlock: LeafBlock): Block[] {
  return blocks.map((b) => {
    if (b.id !== columnsBlockId || b.type !== "columns") return b;
    const columns = rebalanceEqual([...b.data.columns, { id: newId(), width: 1, blocks: [newBlock] }]);
    return { ...b, data: { ...b.data, columns } };
  });
}

/**
 * Bir sütunun genişlik ağırlığını manuel ayarlar (kullanıcının manuel oranlama seçeneği,
 * §10.17.3 v2 madde 1 "veya"). Yapısal bir değişiklik OLMADIĞI için diğer sütunları etkilemez.
 */
export function setColumnWidth(blocks: Block[], columnsBlockId: string, columnId: string, width: number): Block[] {
  return blocks.map((b) => {
    if (b.id !== columnsBlockId || b.type !== "columns") return b;
    const columns = b.data.columns.map((c) => (c.id === columnId ? { ...c, width } : c));
    return { ...b, data: { ...b.data, columns } };
  });
}

/** Bir sütunun hangi `columns` konteynerine ait olduğunu bulur (dnd-kit'in `col:<id>` konteyner kimliğinden). */
export function findColumnsBlockIdForColumn(blocks: Block[], columnId: string): string | null {
  for (const b of blocks) {
    if (b.type === "columns" && b.data.columns.some((c) => c.id === columnId)) return b.id;
  }
  return null;
}

/**
 * Bir bloğun bir sütundan çıkarılması (silme VEYA sürükleyerek başka yere taşıma) sonrası çağrılır.
 * YALNIZCA belirtilen `columnId` bu işlemle BOŞALDIYSA o sütunu satırdan kaldırır, kalanları eşit
 * genişliğe yeniden dengeler ve tek sütuna düşerse satırı otomatik "Tam Genişlik"e döndürür
 * (§10.17.3 v2 madde 3) — hiçbir onay DİYALOĞU gerekmez, içerik kaybı YOKTUR. Satırdaki BAŞKA,
 * bu işlemden ÖNCE de zaten boş olan sütunlara (ör. henüz hiç doldurulmamış bir sürükle-bırak
 * yer tutucusu, §10.17.6 "boş sütun tuzağı") KASITLI OLARAK dokunmaz — aksi halde ilgisiz bir
 * kardeş bloğun silinmesi, kullanıcının doldurmayı beklediği boş bir sütunu sessizce yutardı.
 */
export function collapseColumnIfEmpty(blocks: Block[], columnsBlockId: string, columnId: string): Block[] {
  const item = blocks.find((b) => b.id === columnsBlockId);
  if (!item || item.type !== "columns") return blocks;
  const target = item.data.columns.find((c) => c.id === columnId);
  if (!target || target.blocks.length > 0) return blocks;

  const remaining = rebalanceEqual(item.data.columns.filter((c) => c.id !== columnId));
  let next = blocks.map((b) => (b.id === columnsBlockId && b.type === "columns" ? { ...b, data: { ...b.data, columns: remaining } } : b));
  if (remaining.length <= 1) next = unwrapColumns(next, columnsBlockId);
  return next;
}

/** Bir `ColumnsBlock`'un TÜM sütunlarındaki blok sayısı — onay diyaloğu metni için. */
export function totalBlocksInColumns(block: ColumnsBlock): number {
  return block.data.columns.reduce((sum, col) => sum + col.blocks.length, 0);
}

/** Unwrap/daralma onayı gerekip gerekmediği — yalnızca "kaybolacak" sütunlarda blok varsa. */
export function needsConfirmToUnwrap(block: ColumnsBlock): boolean {
  return totalBlocksInColumns(block) > 0;
}

/**
 * Kaldırma (`satır → full`, VERİ KAYBI TUZAĞI — §10.17.3): sütun bloklarının hepsi soldan sağa,
 * sütun içi sırayla düzleştirilip konteynerin yerine konur. Sessizce silmek YASAK — çağıran
 * taraf (bkz. builder-canvas.tsx) `needsConfirmToUnwrap` doğruysa önce onay diyaloğu gösterir.
 * (`collapseEmptyColumns`'un tek-sütuna-otomatik-düşme dalı da bunu çağırır — o durumda içerik
 * zaten kaybolmadığı için onay GEREKMEZ.)
 */
export function unwrapColumns(blocks: Block[], columnsBlockId: string): Block[] {
  const index = blocks.findIndex((b) => b.id === columnsBlockId);
  if (index === -1) return blocks;
  const target = blocks[index]!;
  if (target.type !== "columns") return blocks;

  const flattened: Block[] = target.data.columns.flatMap((col) => col.blocks as Block[]);
  return [...blocks.slice(0, index), ...flattened, ...blocks.slice(index + 1)];
}

export function updateColumnsData(blocks: Block[], columnsBlockId: string, patch: Partial<ColumnsBlock["data"]>): Block[] {
  return blocks.map((b) => (b.id === columnsBlockId && b.type === "columns" ? { ...b, data: { ...b.data, ...patch } } : b));
}

// ---------------------------------------------------------------------------
// dnd-kit çok-konteynerli sürükleme yardımcıları — konteyner kimliği sözleşmesi:
// kök liste "root", her sütun "col:<column.id>" (§10.17.6).
// ---------------------------------------------------------------------------

export function findContainerId(blocks: Block[], itemId: string): BuilderContainerId | null {
  if (itemId === "root") return "root";
  if (blocks.some((b) => b.id === itemId)) return "root";
  for (const b of blocks) {
    if (b.type === "columns") {
      for (const col of b.data.columns) {
        if (col.id === itemId || col.blocks.some((leaf) => leaf.id === itemId)) return `col:${col.id}`;
      }
    }
  }
  return null;
}

export function getContainerBlockIds(blocks: Block[], containerId: BuilderContainerId): string[] {
  if (containerId === "root") return blocks.map((b) => b.id);
  const colId = containerId.slice(4);
  for (const b of blocks) {
    if (b.type === "columns") {
      const col = b.data.columns.find((c) => c.id === colId);
      if (col) return col.blocks.map((l) => l.id);
    }
  }
  return [];
}

export function getContainerBlocks(blocks: Block[], containerId: BuilderContainerId): (Block | LeafBlock)[] {
  if (containerId === "root") return blocks;
  const colId = containerId.slice(4);
  for (const b of blocks) {
    if (b.type === "columns") {
      const col = b.data.columns.find((c) => c.id === colId);
      if (col) return col.blocks;
    }
  }
  return [];
}

export function removeFromContainer(
  blocks: Block[],
  containerId: BuilderContainerId,
  itemId: string
): { blocks: Block[]; removed: Block | LeafBlock | null } {
  if (containerId === "root") {
    const idx = blocks.findIndex((b) => b.id === itemId);
    if (idx === -1) return { blocks, removed: null };
    const removed = blocks[idx]!;
    return { blocks: [...blocks.slice(0, idx), ...blocks.slice(idx + 1)], removed };
  }
  const colId = containerId.slice(4);
  let removed: LeafBlock | null = null;
  const next = blocks.map((b) => {
    if (b.type !== "columns") return b;
    const columns = b.data.columns.map((col) => {
      if (col.id !== colId) return col;
      const idx = col.blocks.findIndex((l) => l.id === itemId);
      if (idx === -1) return col;
      removed = col.blocks[idx]!;
      return { ...col, blocks: [...col.blocks.slice(0, idx), ...col.blocks.slice(idx + 1)] };
    });
    return { ...b, data: { ...b.data, columns } };
  });
  return { blocks: next, removed };
}

export function insertIntoContainer(
  blocks: Block[],
  containerId: BuilderContainerId,
  index: number,
  item: Block | LeafBlock
): Block[] {
  if (containerId === "root") {
    const next = [...blocks];
    next.splice(Math.max(0, Math.min(index, next.length)), 0, item as Block);
    return next;
  }
  const colId = containerId.slice(4);
  return blocks.map((b) => {
    if (b.type !== "columns") return b;
    const columns = b.data.columns.map((col) => {
      if (col.id !== colId) return col;
      const nextItems = [...col.blocks];
      nextItems.splice(Math.max(0, Math.min(index, nextItems.length)), 0, item as LeafBlock);
      return { ...col, blocks: nextItems };
    });
    return { ...b, data: { ...b.data, columns } };
  });
}

export function findItemById(blocks: Block[], itemId: string): Block | LeafBlock | null {
  const direct = blocks.find((b) => b.id === itemId);
  if (direct) return direct;
  for (const b of blocks) {
    if (b.type === "columns") {
      for (const col of b.data.columns) {
        const found = col.blocks.find((leaf) => leaf.id === itemId);
        if (found) return found;
      }
    }
  }
  return null;
}

export function countAllBlocks(blocks: Block[]): number {
  let count = 0;
  for (const b of blocks) {
    count += 1;
    if (b.type === "columns") {
      for (const col of b.data.columns) count += col.blocks.length;
    }
  }
  return count;
}
