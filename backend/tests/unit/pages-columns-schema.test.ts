import { describe, expect, it } from "vitest";
import { CreatePageRequestSchema } from "../../src/modules/pages/pages.schemas";

interface ColumnsBlockDataV2 {
  gap: "none" | "sm" | "md" | "lg";
  verticalAlign: "top" | "center" | "bottom";
  columns: { id: string; width?: number; blocks: Record<string, unknown>[] }[];
}

function columnsBlock(overrides: Partial<ColumnsBlockDataV2> = {}, id = "cols-1") {
  return {
    id,
    type: "columns",
    data: {
      gap: "md",
      verticalAlign: "top",
      columns: [
        { id: "col-0", width: 1, blocks: [{ id: "t0", type: "text", data: { html: "<p>a</p>" } }] },
        { id: "col-1", width: 1, blocks: [] },
      ],
      ...overrides,
    } as ColumnsBlockDataV2,
  };
}

describe("CreatePageRequestSchema — columns block validation (§10.17.3 v2, esnek N-sütun)", () => {
  it("accepts a well-formed 2-column block", () => {
    const result = CreatePageRequestSchema.safeParse({ title: "x", blocks: [columnsBlock()] });
    expect(result.success).toBe(true);
  });

  it("still accepts fully free-form non-columns blocks (minimum diff, unchanged behavior)", () => {
    const result = CreatePageRequestSchema.safeParse({ title: "x", blocks: [{ id: "1", type: "hero", data: { anything: "goes", nested: { ok: true } } }] });
    expect(result.success).toBe(true);
  });

  it("accepts an arbitrary column count (4) with no fixed 2/3 cap", () => {
    const block = columnsBlock({
      columns: Array.from({ length: 4 }, (_, i) => ({ id: `col-${i}`, width: 1, blocks: [] })),
    });
    const result = CreatePageRequestSchema.safeParse({ title: "x", blocks: [block] });
    expect(result.success).toBe(true);
  });

  it("accepts 6 columns (UX-only readability warning, no backend cap at 6)", () => {
    const block = columnsBlock({
      columns: Array.from({ length: 6 }, (_, i) => ({ id: `col-${i}`, width: 1, blocks: [] })),
    });
    const result = CreatePageRequestSchema.safeParse({ title: "x", blocks: [block] });
    expect(result.success).toBe(true);
  });

  it("rejects a row exceeding MAX_COLUMNS_PER_ROW (24) — DoS guard, not a UX limit", () => {
    const block = columnsBlock({
      columns: Array.from({ length: 25 }, (_, i) => ({ id: `col-${i}`, width: 1, blocks: [] })),
    });
    const result = CreatePageRequestSchema.safeParse({ title: "x", blocks: [block] });
    expect(result.success).toBe(false);
  });

  it("rejects fewer than 2 columns", () => {
    const block = columnsBlock({ columns: [{ id: "only-one", width: 1, blocks: [] }] });
    const result = CreatePageRequestSchema.safeParse({ title: "x", blocks: [block] });
    expect(result.success).toBe(false);
  });

  it("defaults a missing per-column width to 1", () => {
    const block = columnsBlock({
      columns: [
        { id: "col-0", blocks: [] },
        { id: "col-1", blocks: [] },
      ] as ColumnsBlockDataV2["columns"],
    });
    const result = CreatePageRequestSchema.safeParse({ title: "x", blocks: [block] });
    expect(result.success).toBe(true);
  });

  it("rejects a 'columns' block nested inside a column (depth > 1 forbidden)", () => {
    const block = columnsBlock({
      columns: [
        { id: "col-0", width: 1, blocks: [{ id: "nested", type: "columns", data: {} }] },
        { id: "col-1", width: 1, blocks: [] },
      ],
    });
    const result = CreatePageRequestSchema.safeParse({ title: "x", blocks: [block] });
    expect(result.success).toBe(false);
  });

  it("rejects a 'hero' block nested inside a column (full-bleed banner forbidden in a narrow column)", () => {
    const block = columnsBlock({
      columns: [
        { id: "col-0", width: 1, blocks: [{ id: "nested-hero", type: "hero", data: {} }] },
        { id: "col-1", width: 1, blocks: [] },
      ],
    });
    const result = CreatePageRequestSchema.safeParse({ title: "x", blocks: [block] });
    expect(result.success).toBe(false);
  });

  it("rejects more than 20 blocks inside a single column", () => {
    const manyBlocks = Array.from({ length: 21 }, (_, i) => ({ id: `b${i}`, type: "text", data: { html: "x" } }));
    const block = columnsBlock({ columns: [{ id: "col-0", width: 1, blocks: manyBlocks }, { id: "col-1", width: 1, blocks: [] }] });
    const result = CreatePageRequestSchema.safeParse({ title: "x", blocks: [block] });
    expect(result.success).toBe(false);
  });

  it("rejects a total block count (including nested) over 200", () => {
    const manyBlocks = Array.from({ length: 20 }, (_, i) => ({ id: `b${i}`, type: "text", data: { html: "x" } }));
    // 10 columns blocks x (1 konteyner + 20 iç blok) = 210 düzleştirilmiş blok > 200.
    const blocks = Array.from({ length: 10 }, (_, index) =>
      columnsBlock({ columns: [{ id: `col-${index}-0`, width: 1, blocks: manyBlocks }, { id: `col-${index}-1`, width: 1, blocks: [] }] }, `cols-${index}`)
    );

    const result = CreatePageRequestSchema.safeParse({ title: "x", blocks });
    expect(result.success).toBe(false);
  });
});

describe("CreatePageRequestSchema — legacy (v1, fixed columnCount/ratio) shape backward compatibility", () => {
  it("accepts a legacy 2-column '1-1' block and converts it to equal per-column widths", () => {
    const legacy = {
      id: "legacy-1",
      type: "columns",
      data: {
        columnCount: 2,
        ratio: "1-1",
        gap: "md",
        verticalAlign: "top",
        columns: [
          { id: "col-0", blocks: [{ id: "t0", type: "text", data: { html: "<p>a</p>" } }] },
          { id: "col-1", blocks: [] },
        ],
      },
    };
    const result = CreatePageRequestSchema.safeParse({ title: "x", blocks: [legacy] });
    expect(result.success).toBe(true);
    if (result.success) {
      const block = result.data.blocks?.[0] as unknown as { data: ColumnsBlockDataV2 & Record<string, unknown> };
      expect(block.data.columns.map((c) => c.width)).toEqual([1, 1]);
      expect(block.data.columnCount).toBeUndefined();
      expect(block.data.ratio).toBeUndefined();
    }
  });

  it("accepts a legacy 2-column '1-2' block and converts ratio into [1,2] per-column widths", () => {
    const legacy = {
      id: "legacy-2",
      type: "columns",
      data: {
        columnCount: 2,
        ratio: "1-2",
        gap: "md",
        verticalAlign: "top",
        columns: [
          { id: "col-0", blocks: [] },
          { id: "col-1", blocks: [{ id: "t1", type: "text", data: { html: "<p>b</p>" } }] },
        ],
      },
    };
    const result = CreatePageRequestSchema.safeParse({ title: "x", blocks: [legacy] });
    expect(result.success).toBe(true);
    if (result.success) {
      const block = result.data.blocks?.[0] as unknown as { data: ColumnsBlockDataV2 };
      expect(block.data.columns.map((c) => c.width)).toEqual([1, 2]);
    }
  });

  it("accepts a legacy 3-column '1-1-1' block and converts to equal widths", () => {
    const legacy = {
      id: "legacy-3",
      type: "columns",
      data: {
        columnCount: 3,
        ratio: "1-1-1",
        gap: "md",
        verticalAlign: "top",
        columns: [
          { id: "col-0", blocks: [] },
          { id: "col-1", blocks: [] },
          { id: "col-2", blocks: [] },
        ],
      },
    };
    const result = CreatePageRequestSchema.safeParse({ title: "x", blocks: [legacy] });
    expect(result.success).toBe(true);
    if (result.success) {
      const block = result.data.blocks?.[0] as unknown as { data: ColumnsBlockDataV2 };
      expect(block.data.columns.map((c) => c.width)).toEqual([1, 1, 1]);
    }
  });
});

describe("CreatePageRequestSchema — translations.<LOCALE>.blocks obey the same columns rules (security-agent fix)", () => {
  it("rejects a 'columns' block nested inside a column when it only appears in translations.EN.blocks", () => {
    const nestedColumnsInTranslation = {
      title: "x",
      translations: {
        EN: {
          blocks: [
            columnsBlock({
              columns: [
                { id: "col-0", width: 1, blocks: [{ id: "nested", type: "columns", data: {} }] },
                { id: "col-1", width: 1, blocks: [] },
              ],
            }),
          ],
        },
      },
    };

    const result = CreatePageRequestSchema.safeParse(nestedColumnsInTranslation);
    expect(result.success).toBe(false);
  });

  it("rejects translations.EN.blocks exceeding the 200 total-block cap even though the primary blocks field is empty", () => {
    const manyBlocks = Array.from({ length: 20 }, (_, i) => ({ id: `b${i}`, type: "text", data: { html: "x" } }));
    const blocks = Array.from({ length: 10 }, (_, index) =>
      columnsBlock({ columns: [{ id: `col-${index}-0`, width: 1, blocks: manyBlocks }, { id: `col-${index}-1`, width: 1, blocks: [] }] }, `cols-${index}`)
    );

    const result = CreatePageRequestSchema.safeParse({ title: "x", translations: { EN: { blocks } } });
    expect(result.success).toBe(false);
  });

  it("still accepts a well-formed translations.EN.blocks (locale=null delete semantics unaffected)", () => {
    const result = CreatePageRequestSchema.safeParse({
      title: "x",
      translations: { EN: { blocks: [columnsBlock()] }, DE: null },
    });
    expect(result.success).toBe(true);
  });
});
