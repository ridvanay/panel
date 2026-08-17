import { describe, expect, it } from "vitest";
import {
  changeColumnCount,
  countAllBlocks,
  findContainerId,
  findItemById,
  getContainerBlockIds,
  insertIntoContainer,
  needsConfirmToShrink,
  needsConfirmToUnwrap,
  removeFromContainer,
  totalBlocksInColumns,
  unwrapColumns,
  wrapInColumns,
} from "@/lib/page-builder/columns";
import type { Block, ColumnsBlock, TextBlock } from "@/lib/page-builder/types";

function textBlock(id: string, html = "<p>x</p>"): TextBlock {
  return { id, type: "text", data: { html } };
}

describe("wrapInColumns", () => {
  it("bir bloğu 2 sütunlu bir columns konteynerine sarmalar, ilk sütuna koyar", () => {
    const blocks: Block[] = [textBlock("a")];
    const next = wrapInColumns(blocks, "a", 2);
    expect(next).toHaveLength(1);
    const columns = next[0] as ColumnsBlock;
    expect(columns.type).toBe("columns");
    expect(columns.data.columnCount).toBe(2);
    expect(columns.data.ratio).toBe("1-1");
    expect(columns.data.columns[0]?.blocks).toEqual([textBlock("a")]);
    expect(columns.data.columns[1]?.blocks).toEqual([]);
  });

  it("3 sütun sarmalamasında ratio 1-1-1 olur", () => {
    const next = wrapInColumns([textBlock("a")], "a", 3);
    const columns = next[0] as ColumnsBlock;
    expect(columns.data.columnCount).toBe(3);
    expect(columns.data.ratio).toBe("1-1-1");
    expect(columns.data.columns).toHaveLength(3);
  });

  it("hero bloğu sarmalamaz (sütuna konulamaz)", () => {
    const blocks: Block[] = [{ id: "h", type: "hero", data: { heading: "Başlık" } }];
    const next = wrapInColumns(blocks, "h", 2);
    expect(next).toEqual(blocks);
  });
});

describe("unwrapColumns", () => {
  it("sütunlardaki tüm blokları soldan sağa düzleştirir, içerik kaybolmaz", () => {
    const columnsBlock: ColumnsBlock = {
      id: "c",
      type: "columns",
      data: {
        columnCount: 2,
        ratio: "1-1",
        gap: "md",
        verticalAlign: "top",
        columns: [
          { id: "col0", blocks: [textBlock("a"), textBlock("b")] },
          { id: "col1", blocks: [textBlock("c")] },
        ],
      },
    };
    const next = unwrapColumns([columnsBlock], "c");
    expect(next.map((b) => b.id)).toEqual(["a", "b", "c"]);
  });

  it("needsConfirmToUnwrap: en az bir blok varsa true", () => {
    const columnsBlock: ColumnsBlock = {
      id: "c",
      type: "columns",
      data: { columnCount: 2, ratio: "1-1", gap: "md", verticalAlign: "top", columns: [{ id: "col0", blocks: [textBlock("a")] }, { id: "col1", blocks: [] }] },
    };
    expect(needsConfirmToUnwrap(columnsBlock)).toBe(true);
    expect(totalBlocksInColumns(columnsBlock)).toBe(1);
  });

  it("needsConfirmToUnwrap: tüm sütunlar boşsa false", () => {
    const columnsBlock: ColumnsBlock = {
      id: "c",
      type: "columns",
      data: { columnCount: 2, ratio: "1-1", gap: "md", verticalAlign: "top", columns: [{ id: "col0", blocks: [] }, { id: "col1", blocks: [] }] },
    };
    expect(needsConfirmToUnwrap(columnsBlock)).toBe(false);
  });
});

describe("changeColumnCount", () => {
  it("2 → 3 genişlemesinde yeni boş sütun eklenir, ratio 1-1-1 olur", () => {
    const columnsBlock: ColumnsBlock = {
      id: "c",
      type: "columns",
      data: { columnCount: 2, ratio: "1-1", gap: "md", verticalAlign: "top", columns: [{ id: "col0", blocks: [textBlock("a")] }, { id: "col1", blocks: [] }] },
    };
    const next = changeColumnCount([columnsBlock], "c", 3);
    const columns = next[0] as ColumnsBlock;
    expect(columns.data.columnCount).toBe(3);
    expect(columns.data.ratio).toBe("1-1-1");
    expect(columns.data.columns).toHaveLength(3);
  });

  it("3 → 2 daralmasında son sütunun blokları yeni son sütuna taşınır (kaybolmaz)", () => {
    const columnsBlock: ColumnsBlock = {
      id: "c",
      type: "columns",
      data: {
        columnCount: 3,
        ratio: "1-1-1",
        gap: "md",
        verticalAlign: "top",
        columns: [{ id: "col0", blocks: [] }, { id: "col1", blocks: [textBlock("b")] }, { id: "col2", blocks: [textBlock("c")] }],
      },
    };
    const next = changeColumnCount([columnsBlock], "c", 2);
    const columns = next[0] as ColumnsBlock;
    expect(columns.data.columnCount).toBe(2);
    expect(columns.data.columns).toHaveLength(2);
    expect(columns.data.columns[1]?.blocks.map((b) => b.id)).toEqual(["b", "c"]);
  });

  it("needsConfirmToShrink: kaybolacak sütunda blok varsa true, yoksa false", () => {
    const withBlock: ColumnsBlock = {
      id: "c",
      type: "columns",
      data: { columnCount: 3, ratio: "1-1-1", gap: "md", verticalAlign: "top", columns: [{ id: "0", blocks: [] }, { id: "1", blocks: [] }, { id: "2", blocks: [textBlock("x")] }] },
    };
    expect(needsConfirmToShrink(withBlock, 2)).toBe(true);

    const allEmpty: ColumnsBlock = {
      ...withBlock,
      data: { ...withBlock.data, columns: [{ id: "0", blocks: [] }, { id: "1", blocks: [] }, { id: "2", blocks: [] }] },
    };
    expect(needsConfirmToShrink(allEmpty, 2)).toBe(false);
  });
});

describe("dnd konteyner yardımcıları", () => {
  const columnsBlock: ColumnsBlock = {
    id: "c",
    type: "columns",
    data: {
      columnCount: 2,
      ratio: "1-1",
      gap: "md",
      verticalAlign: "top",
      columns: [
        { id: "col0", blocks: [textBlock("a")] },
        { id: "col1", blocks: [textBlock("b")] },
      ],
    },
  };
  const blocks: Block[] = [textBlock("root1"), columnsBlock];

  it("findContainerId: kök ve sütun öğelerini doğru bulur", () => {
    expect(findContainerId(blocks, "root1")).toBe("root");
    expect(findContainerId(blocks, "a")).toBe("col:col0");
    expect(findContainerId(blocks, "b")).toBe("col:col1");
    expect(findContainerId(blocks, "yok")).toBeNull();
  });

  it("getContainerBlockIds: doğru id listesini döner", () => {
    expect(getContainerBlockIds(blocks, "root")).toEqual(["root1", "c"]);
    expect(getContainerBlockIds(blocks, "col:col0")).toEqual(["a"]);
  });

  it("removeFromContainer + insertIntoContainer: bir bloğu sütundan sütuna taşır", () => {
    const { blocks: afterRemove, removed } = removeFromContainer(blocks, "col:col0", "a");
    expect(removed?.id).toBe("a");
    expect(getContainerBlockIds(afterRemove, "col:col0")).toEqual([]);

    const afterInsert = insertIntoContainer(afterRemove, "col:col1", 0, removed!);
    expect(getContainerBlockIds(afterInsert, "col:col1")).toEqual(["a", "b"]);
  });

  it("findItemById: kök ve sütun öğelerini bulur", () => {
    expect(findItemById(blocks, "root1")?.id).toBe("root1");
    expect(findItemById(blocks, "a")?.id).toBe("a");
    expect(findItemById(blocks, "yok")).toBeNull();
  });

  it("countAllBlocks: sütun içindekiler dahil toplam sayar", () => {
    expect(countAllBlocks(blocks)).toBe(4); // root1 + columns konteyneri + a + b
  });
});
