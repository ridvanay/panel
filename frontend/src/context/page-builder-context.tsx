"use client";

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import type { Block, ColumnsBlock, LeafBlock } from "@/lib/page-builder/types";
import {
  changeColumnCount,
  needsConfirmToShrink,
  needsConfirmToUnwrap,
  totalBlocksInColumns,
  unwrapColumns,
  updateColumnsData,
  wrapInColumns,
} from "@/lib/page-builder/columns";

interface PendingLayoutConfirm {
  kind: "unwrap" | "shrink";
  columnsBlockId: string;
  blockCount: number;
}

interface PageBuilderContextValue {
  blocks: Block[];
  setBlocks: (blocks: Block[]) => void;
  selectedBlockId: string | null;
  selectBlock: (id: string | null) => void;

  /**
   * §10.17.6 — Sarmalama/kaldırma (`full ↔ 2 ↔ 3`, §10.17.3). Onay gerektiren bir durumla
   * (boş olmayan sütun kaybı) karşılaşılırsa DOĞRUDAN uygulamaz; `pendingConfirm`'i doldurur —
   * çağıran taraf `ConfirmDialog` ile onay aldıktan sonra `resolvePendingConfirm()` çağırır.
   */
  setBlockLayout: (blockId: string, layout: "full" | 2 | 3) => void;
  pendingConfirm: PendingLayoutConfirm | null;
  resolvePendingConfirm: (confirmed: boolean) => void;
  updateColumnsMeta: (columnsBlockId: string, patch: Partial<ColumnsBlock["data"]>) => void;
  updateBlockIn: (containerId: "root" | `col:${string}`, blockId: string, next: Block | LeafBlock) => void;
  removeBlockIn: (containerId: "root" | `col:${string}`, blockId: string) => void;
}

const PageBuilderContext = createContext<PageBuilderContextValue | null>(null);

export function PageBuilderProvider({ children, initialBlocks = [] }: { children: ReactNode; initialBlocks?: Block[] }) {
  const [blocks, setBlocks] = useState<Block[]>(initialBlocks);
  const [selectedBlockId, selectBlock] = useState<string | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState<PendingLayoutConfirm | null>(null);

  const setBlockLayout = useCallback(
    (blockId: string, layout: "full" | 2 | 3) => {
      const item = blocks.find((b) => b.id === blockId);
      if (!item) return;

      if (item.type !== "columns") {
        if (layout === "full") return;
        setBlocks(wrapInColumns(blocks, blockId, layout));
        return;
      }

      if (layout === "full") {
        if (needsConfirmToUnwrap(item)) {
          setPendingConfirm({ kind: "unwrap", columnsBlockId: item.id, blockCount: totalBlocksInColumns(item) });
          return;
        }
        setBlocks(unwrapColumns(blocks, item.id));
        return;
      }

      if (layout === item.data.columnCount) return;
      if (needsConfirmToShrink(item, layout)) {
        const movedCount = item.data.columns.slice(layout).reduce((sum, col) => sum + col.blocks.length, 0);
        setPendingConfirm({ kind: "shrink", columnsBlockId: item.id, blockCount: movedCount });
        return;
      }
      setBlocks(changeColumnCount(blocks, item.id, layout));
    },
    [blocks]
  );

  const resolvePendingConfirm = useCallback(
    (confirmed: boolean) => {
      if (!confirmed || !pendingConfirm) {
        setPendingConfirm(null);
        return;
      }
      if (pendingConfirm.kind === "unwrap") {
        setBlocks(unwrapColumns(blocks, pendingConfirm.columnsBlockId));
      }
      setPendingConfirm(null);
    },
    [blocks, pendingConfirm]
  );

  const updateColumnsMeta = useCallback(
    (columnsBlockId: string, patch: Partial<ColumnsBlock["data"]>) => {
      setBlocks(updateColumnsData(blocks, columnsBlockId, patch));
    },
    [blocks]
  );

  const updateBlockIn = useCallback(
    (containerId: "root" | `col:${string}`, blockId: string, next: Block | LeafBlock) => {
      if (containerId === "root") {
        setBlocks(blocks.map((b) => (b.id === blockId ? (next as Block) : b)));
        return;
      }
      const colId = containerId.slice(4);
      setBlocks(
        blocks.map((b) => {
          if (b.type !== "columns") return b;
          const columns = b.data.columns.map((col) =>
            col.id === colId ? { ...col, blocks: col.blocks.map((l) => (l.id === blockId ? (next as LeafBlock) : l)) } : col
          );
          return { ...b, data: { ...b.data, columns } };
        })
      );
    },
    [blocks]
  );

  const removeBlockIn = useCallback(
    (containerId: "root" | `col:${string}`, blockId: string) => {
      if (containerId === "root") {
        setBlocks(blocks.filter((b) => b.id !== blockId));
        return;
      }
      const colId = containerId.slice(4);
      setBlocks(
        blocks.map((b) => {
          if (b.type !== "columns") return b;
          const columns = b.data.columns.map((col) =>
            col.id === colId ? { ...col, blocks: col.blocks.filter((l) => l.id !== blockId) } : col
          );
          return { ...b, data: { ...b.data, columns } };
        })
      );
    },
    [blocks]
  );

  return (
    <PageBuilderContext.Provider
      value={{
        blocks,
        setBlocks,
        selectedBlockId,
        selectBlock,
        setBlockLayout,
        pendingConfirm,
        resolvePendingConfirm,
        updateColumnsMeta,
        updateBlockIn,
        removeBlockIn,
      }}
    >
      {children}
    </PageBuilderContext.Provider>
  );
}

export function usePageBuilder() {
  const ctx = useContext(PageBuilderContext);
  if (!ctx) throw new Error("usePageBuilder, PageBuilderProvider içinde kullanılmalı");
  return ctx;
}
