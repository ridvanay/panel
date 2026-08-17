import { newId } from "./registry";
import type {
  Block,
  BuilderContainerId,
  ColumnsBlock,
  LeafBlock,
  PageColumn,
  PageColumnCount,
  PageColumnRatio,
} from "./types";

/** columnCount=2 → "1-1"; columnCount=3 → yalnızca "1-1-1" (§10.17.3 uyum kuralı). */
export function defaultRatioFor(count: PageColumnCount): PageColumnRatio {
  return count === 3 ? "1-1-1" : "1-1";
}

export function isColumnsBlock(block: Block): block is ColumnsBlock {
  return block.type === "columns";
}

function emptyColumn(): PageColumn {
  return { id: newId(), blocks: [] };
}

/**
 * Sarmalama (`full → 2|3`, §10.17.3): blok, 0. sütunu kendisi olan yeni bir `ColumnsBlock` ile
 * değiştirilir; diğer sütun(lar) boş başlar.
 */
export function wrapInColumns(blocks: Block[], blockId: string, columnCount: PageColumnCount): Block[] {
  const index = blocks.findIndex((b) => b.id === blockId);
  if (index === -1) return blocks;
  const target = blocks[index]!;
  if (target.type === "columns" || target.type === "hero") return blocks; // 422'lik durumu istemci tarafında engelle

  const columns: PageColumn[] = [{ id: newId(), blocks: [target as LeafBlock] }];
  for (let i = 1; i < columnCount; i += 1) columns.push(emptyColumn());

  const wrapped: ColumnsBlock = {
    id: newId(),
    type: "columns",
    data: {
      columnCount,
      ratio: defaultRatioFor(columnCount),
      gap: "md",
      verticalAlign: "top",
      columns,
    },
  };

  return [...blocks.slice(0, index), wrapped, ...blocks.slice(index + 1)];
}

/** Bir `ColumnsBlock`'un TÜM sütunlarındaki blok sayısı — onay diyaloğu metni için. */
export function totalBlocksInColumns(block: ColumnsBlock): number {
  return block.data.columns.reduce((sum, col) => sum + col.blocks.length, 0);
}

/** Unwrap/daralma onayı gerekip gerekmediği — yalnızca "kaybolacak" sütunlarda blok varsa. */
export function needsConfirmToUnwrap(block: ColumnsBlock): boolean {
  return totalBlocksInColumns(block) > 0;
}

export function needsConfirmToShrink(block: ColumnsBlock, newCount: PageColumnCount): boolean {
  if (newCount >= block.data.columnCount) return false;
  return block.data.columns.slice(newCount).some((col) => col.blocks.length > 0);
}

/**
 * Kaldırma (`2|3 → full`, VERİ KAYBI TUZAĞI — §10.17.3): sütun bloklarının hepsi soldan sağa,
 * sütun içi sırayla düzleştirilip konteynerin yerine konur. Sessizce silmek YASAK — çağıran
 * taraf (bkz. builder-canvas.tsx) `needsConfirmToUnwrap` doğruysa önce onay diyaloğu gösterir.
 */
export function unwrapColumns(blocks: Block[], columnsBlockId: string): Block[] {
  const index = blocks.findIndex((b) => b.id === columnsBlockId);
  if (index === -1) return blocks;
  const target = blocks[index]!;
  if (target.type !== "columns") return blocks;

  const flattened: Block[] = target.data.columns.flatMap((col) => col.blocks as Block[]);
  return [...blocks.slice(0, index), ...flattened, ...blocks.slice(index + 1)];
}

/**
 * Sütun sayısını değiştirir. Genişleme (`2 → 3`): yeni boş sütun eklenir, `ratio` varsayılana
 * döner. Daralma (`3 → 2`): son sütunun blokları yeni son sütunun sonuna eklenir (VERİ KAYBI
 * TUZAĞI — çağıran taraf `needsConfirmToShrink` doğruysa önce onay diyaloğu gösterir).
 */
export function changeColumnCount(blocks: Block[], columnsBlockId: string, newCount: PageColumnCount): Block[] {
  return blocks.map((b) => {
    if (b.id !== columnsBlockId || b.type !== "columns") return b;
    const current = b.data.columns;
    let nextColumns: PageColumn[];
    if (newCount > current.length) {
      nextColumns = [...current];
      while (nextColumns.length < newCount) nextColumns.push(emptyColumn());
    } else if (newCount < current.length) {
      const kept = current.slice(0, newCount);
      const overflow = current.slice(newCount).flatMap((col) => col.blocks);
      const lastIndex = kept.length - 1;
      nextColumns = kept.map((col, i) => (i === lastIndex ? { ...col, blocks: [...col.blocks, ...overflow] } : col));
    } else {
      nextColumns = current;
    }
    return { ...b, data: { ...b.data, columnCount: newCount, ratio: defaultRatioFor(newCount), columns: nextColumns } };
  });
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
