import { describe, expect, it } from "vitest";
import {
  addColumnToRow,
  collapseColumnIfEmpty,
  countAllBlocks,
  findColumnsBlockIdForColumn,
  findContainerId,
  findItemById,
  getContainerBlockIds,
  insertIntoContainer,
  needsConfirmToUnwrap,
  removeFromContainer,
  resolveColumnWidth,
  setColumnWidth,
  totalBlocksInColumns,
  unwrapColumns,
  wrapInColumns,
} from "@/lib/page-builder/columns";
import type { Block, ColumnsBlock, TextBlock } from "@/lib/page-builder/types";

function textBlock(id: string, html = "<p>x</p>"): TextBlock {
  return { id, type: "text", data: { html } };
}

function col(id: string, blocks: TextBlock[], width = 1) {
  return { id, width, blocks };
}

describe("wrapInColumns", () => {
  it("bir bloğu 2 sütunlu bir columns konteynerine sarmalar, ilk sütuna koyar, eşit genişlik", () => {
    const blocks: Block[] = [textBlock("a")];
    const next = wrapInColumns(blocks, "a", 2);
    expect(next).toHaveLength(1);
    const columns = next[0] as ColumnsBlock;
    expect(columns.type).toBe("columns");
    expect(columns.data.columns).toHaveLength(2);
    expect(columns.data.columns[0]?.blocks).toEqual([textBlock("a")]);
    expect(columns.data.columns[0]?.width).toBe(1);
    expect(columns.data.columns[1]?.blocks).toEqual([]);
    expect(columns.data.columns[1]?.width).toBe(1);
  });

  it("initialCount verilmezse varsayılan 2'dir", () => {
    const next = wrapInColumns([textBlock("a")], "a");
    const columns = next[0] as ColumnsBlock;
    expect(columns.data.columns).toHaveLength(2);
  });

  it("hero bloğu sarmalamaz (sütuna konulamaz)", () => {
    const blocks: Block[] = [{ id: "h", type: "hero", data: { heading: "Başlık" } }];
    const next = wrapInColumns(blocks, "h", 2);
    expect(next).toEqual(blocks);
  });
});

describe("addColumnToRow — §10.17.3 v2 madde 1: sınırsız sütun + otomatik eşit paylaşım", () => {
  it("satıra yeni bir sütun ekler, TÜM sütunları eşit genişliğe sıfırlar", () => {
    const columnsBlock: ColumnsBlock = {
      id: "c",
      type: "columns",
      data: { gap: "md", verticalAlign: "top", columns: [col("col0", [textBlock("a")], 2), col("col1", [], 3)] },
    };
    const next = addColumnToRow([columnsBlock], "c", textBlock("new"));
    const columns = (next[0] as ColumnsBlock).data.columns;
    expect(columns).toHaveLength(3);
    expect(columns.map((c) => c.width)).toEqual([1, 1, 1]);
    expect(columns[2]?.blocks).toEqual([textBlock("new")]);
  });

  it("3 sütunlu bir satıra tekrar eklenince 4 sütun olur (sabit üst sınır YOK)", () => {
    const columnsBlock: ColumnsBlock = {
      id: "c",
      type: "columns",
      data: { gap: "md", verticalAlign: "top", columns: [col("c0", []), col("c1", []), col("c2", [])] },
    };
    const next = addColumnToRow([columnsBlock], "c", textBlock("d"));
    expect((next[0] as ColumnsBlock).data.columns).toHaveLength(4);
  });

  it("6 sütuna kadar büyütülebilir (okunabilirlik uyarısı yalnızca UI'da, veri modelinde engel YOK)", () => {
    let blocks: Block[] = [{ id: "c", type: "columns", data: { gap: "md", verticalAlign: "top", columns: [col("c0", [])] } }];
    for (let i = 1; i < 6; i += 1) blocks = addColumnToRow(blocks, "c", textBlock(`b${i}`));
    expect((blocks[0] as ColumnsBlock).data.columns).toHaveLength(6);
  });
});

describe("setColumnWidth — manuel oranlama", () => {
  it("yalnızca hedef sütunun genişliğini değiştirir, diğerlerine dokunmaz", () => {
    const columnsBlock: ColumnsBlock = {
      id: "c",
      type: "columns",
      data: { gap: "md", verticalAlign: "top", columns: [col("c0", []), col("c1", [])] },
    };
    const next = setColumnWidth([columnsBlock], "c", "c1", 3);
    const columns = (next[0] as ColumnsBlock).data.columns;
    expect(columns[0]?.width).toBe(1);
    expect(columns[1]?.width).toBe(3);
  });
});

describe("resolveColumnWidth — §10.17.8 geriye dönük uyumluluk (eski `ratio` şeklini okurken)", () => {
  it("width mevcutsa doğrudan onu kullanır (ratio'yu YOK SAYAR)", () => {
    const data = { ratio: "2-1", columns: [{ width: 5 }, { width: 5 }] };
    expect(resolveColumnWidth(data, 0)).toBe(5);
    expect(resolveColumnWidth(data, 1)).toBe(5);
  });

  it("width YOKSA ve ratio='2-1' ise [2,1] döner (v1 görsel oranı korunur)", () => {
    const data = { ratio: "2-1", columns: [{}, {}] };
    expect(resolveColumnWidth(data, 0)).toBe(2);
    expect(resolveColumnWidth(data, 1)).toBe(1);
  });

  it("width YOKSA ve ratio='1-2' ise [1,2] döner", () => {
    const data = { ratio: "1-2", columns: [{}, {}] };
    expect(resolveColumnWidth(data, 0)).toBe(1);
    expect(resolveColumnWidth(data, 1)).toBe(2);
  });

  it("ne width ne ratio varsa (v2 varsayılan/3+ sütun) eşit (1) döner", () => {
    const data = { columns: [{}, {}, {}] };
    expect(resolveColumnWidth(data, 0)).toBe(1);
    expect(resolveColumnWidth(data, 2)).toBe(1);
  });
});

describe("collapseColumnIfEmpty — §10.17.3 v2 madde 3: sütun sil → boşalan sütun kalkar, kalan eşitlenir", () => {
  it("belirtilen sütun boşaldıysa kaldırır ve kalan sütunları eşit genişliğe sıfırlar", () => {
    const columnsBlock: ColumnsBlock = {
      id: "c",
      type: "columns",
      data: {
        gap: "md",
        verticalAlign: "top",
        columns: [col("c0", [textBlock("a")], 2), col("c1", [], 1), col("c2", [textBlock("b")], 3)],
      },
    };
    const next = collapseColumnIfEmpty([columnsBlock], "c", "c1");
    const columns = (next[0] as ColumnsBlock).data.columns;
    expect(columns.map((c) => c.id)).toEqual(["c0", "c2"]);
    expect(columns.map((c) => c.width)).toEqual([1, 1]);
  });

  it("tek sütuna düşen bir satırı otomatik olarak Tam Genişliğe (unwrap) döndürür, içerik korunur", () => {
    const columnsBlock: ColumnsBlock = {
      id: "c",
      type: "columns",
      data: { gap: "md", verticalAlign: "top", columns: [col("c0", [textBlock("a"), textBlock("b")]), col("c1", [])] },
    };
    const next = collapseColumnIfEmpty([columnsBlock], "c", "c1");
    expect(next.map((b) => b.id)).toEqual(["a", "b"]);
  });

  it("belirtilen sütun boş DEĞİLSE değişiklik yapmaz (no-op)", () => {
    const columnsBlock: ColumnsBlock = {
      id: "c",
      type: "columns",
      data: { gap: "md", verticalAlign: "top", columns: [col("c0", [textBlock("a")], 2), col("c1", [textBlock("b")], 1)] },
    };
    const next = collapseColumnIfEmpty([columnsBlock], "c", "c0");
    expect((next[0] as ColumnsBlock).data.columns.map((c) => c.width)).toEqual([2, 1]);
  });

  it("İLGİSİZ, önceden zaten boş olan bir kardeş sütuna (sürükle-bırak yer tutucusu) DOKUNMAZ", () => {
    // 3 sütun: c0 dolu, c1 HİÇ doldurulmamış boş yer tutucu, c2 dolu. c2'deki blok silinir —
    // c1'in bu işlemle bir ilgisi yok, o yüzden silinmemeli (aksi halde ilgisiz bir kardeş bloğun
    // silinmesi, kullanıcının doldurmayı beklediği boş sütunu sessizce yutar).
    const columnsBlock: ColumnsBlock = {
      id: "c",
      type: "columns",
      data: {
        gap: "md",
        verticalAlign: "top",
        columns: [col("c0", [textBlock("a")]), col("c1", []), col("c2", [textBlock("b")])],
      },
    };
    const afterRemovingB = {
      ...columnsBlock,
      data: { ...columnsBlock.data, columns: [col("c0", [textBlock("a")]), col("c1", []), col("c2", [])] },
    };
    const next = collapseColumnIfEmpty([afterRemovingB], "c", "c2");
    const columns = (next[0] as ColumnsBlock).data.columns;
    expect(columns.map((c) => c.id)).toEqual(["c0", "c1"]);
  });

  it("findColumnsBlockIdForColumn: bir sütunun ait olduğu columns konteynerini bulur", () => {
    const columnsBlock: ColumnsBlock = {
      id: "c",
      type: "columns",
      data: { gap: "md", verticalAlign: "top", columns: [col("c0", []), col("c1", [])] },
    };
    expect(findColumnsBlockIdForColumn([columnsBlock], "c1")).toBe("c");
    expect(findColumnsBlockIdForColumn([columnsBlock], "yok")).toBeNull();
  });
});

describe("unwrapColumns", () => {
  it("sütunlardaki tüm blokları soldan sağa düzleştirir, içerik kaybolmaz", () => {
    const columnsBlock: ColumnsBlock = {
      id: "c",
      type: "columns",
      data: { gap: "md", verticalAlign: "top", columns: [col("col0", [textBlock("a"), textBlock("b")]), col("col1", [textBlock("c")])] },
    };
    const next = unwrapColumns([columnsBlock], "c");
    expect(next.map((b) => b.id)).toEqual(["a", "b", "c"]);
  });

  it("needsConfirmToUnwrap: en az bir blok varsa true", () => {
    const columnsBlock: ColumnsBlock = {
      id: "c",
      type: "columns",
      data: { gap: "md", verticalAlign: "top", columns: [col("col0", [textBlock("a")]), col("col1", [])] },
    };
    expect(needsConfirmToUnwrap(columnsBlock)).toBe(true);
    expect(totalBlocksInColumns(columnsBlock)).toBe(1);
  });

  it("needsConfirmToUnwrap: tüm sütunlar boşsa false", () => {
    const columnsBlock: ColumnsBlock = {
      id: "c",
      type: "columns",
      data: { gap: "md", verticalAlign: "top", columns: [col("col0", []), col("col1", [])] },
    };
    expect(needsConfirmToUnwrap(columnsBlock)).toBe(false);
  });
});

describe("dnd konteyner yardımcıları", () => {
  const columnsBlock: ColumnsBlock = {
    id: "c",
    type: "columns",
    data: { gap: "md", verticalAlign: "top", columns: [col("col0", [textBlock("a")]), col("col1", [textBlock("b")])] },
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
