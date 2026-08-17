import { describe, expect, it } from "vitest";
import { CreatePageRequestSchema } from "../../src/modules/pages/pages.schemas";

interface ColumnsBlockData {
  columnCount: 2 | 3;
  ratio: "1-1" | "2-1" | "1-2" | "1-1-1";
  gap: "none" | "sm" | "md" | "lg";
  verticalAlign: "top" | "center" | "bottom";
  columns: { id: string; blocks: Record<string, unknown>[] }[];
}

function columnsBlock(overrides: Partial<ColumnsBlockData> = {}, id = "cols-1") {
  return {
    id,
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
      ...overrides,
    } as ColumnsBlockData,
  };
}

describe("CreatePageRequestSchema — columns block validation (§10.17.3)", () => {
  it("accepts a well-formed 2-column block", () => {
    const result = CreatePageRequestSchema.safeParse({ title: "x", blocks: [columnsBlock()] });
    expect(result.success).toBe(true);
  });

  it("still accepts fully free-form non-columns blocks (minimum diff, unchanged behavior)", () => {
    const result = CreatePageRequestSchema.safeParse({ title: "x", blocks: [{ id: "1", type: "hero", data: { anything: "goes", nested: { ok: true } } }] });
    expect(result.success).toBe(true);
  });

  it("rejects a columns block whose columns array length does not match columnCount", () => {
    const block = columnsBlock({ columns: [{ id: "only-one", blocks: [] }] });
    const result = CreatePageRequestSchema.safeParse({ title: "x", blocks: [block] });
    expect(result.success).toBe(false);
  });

  it("rejects an incompatible ratio for columnCount=2 (e.g. '1-1-1')", () => {
    const block = columnsBlock({ ratio: "1-1-1" });
    const result = CreatePageRequestSchema.safeParse({ title: "x", blocks: [block] });
    expect(result.success).toBe(false);
  });

  it("rejects a 'columns' block nested inside a column (depth > 1 forbidden)", () => {
    const block = columnsBlock({
      columns: [
        { id: "col-0", blocks: [{ id: "nested", type: "columns", data: {} }] },
        { id: "col-1", blocks: [] },
      ],
    });
    const result = CreatePageRequestSchema.safeParse({ title: "x", blocks: [block] });
    expect(result.success).toBe(false);
  });

  it("rejects a 'hero' block nested inside a column (full-bleed banner forbidden in a narrow column)", () => {
    const block = columnsBlock({
      columns: [
        { id: "col-0", blocks: [{ id: "nested-hero", type: "hero", data: {} }] },
        { id: "col-1", blocks: [] },
      ],
    });
    const result = CreatePageRequestSchema.safeParse({ title: "x", blocks: [block] });
    expect(result.success).toBe(false);
  });

  it("rejects more than 20 blocks inside a single column", () => {
    const manyBlocks = Array.from({ length: 21 }, (_, i) => ({ id: `b${i}`, type: "text", data: { html: "x" } }));
    const block = columnsBlock({ columns: [{ id: "col-0", blocks: manyBlocks }, { id: "col-1", blocks: [] }] });
    const result = CreatePageRequestSchema.safeParse({ title: "x", blocks: [block] });
    expect(result.success).toBe(false);
  });

  it("rejects a total block count (including nested) over 200", () => {
    const manyBlocks = Array.from({ length: 20 }, (_, i) => ({ id: `b${i}`, type: "text", data: { html: "x" } }));
    // 10 columns blocks x (1 konteyner + 20 iç blok) = 210 düzleştirilmiş blok > 200.
    const blocks = Array.from({ length: 10 }, (_, index) =>
      columnsBlock({ columns: [{ id: `col-${index}-0`, blocks: manyBlocks }, { id: `col-${index}-1`, blocks: [] }] }, `cols-${index}`)
    );

    const result = CreatePageRequestSchema.safeParse({ title: "x", blocks });
    expect(result.success).toBe(false);
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
                { id: "col-0", blocks: [{ id: "nested", type: "columns", data: {} }] },
                { id: "col-1", blocks: [] },
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
      columnsBlock({ columns: [{ id: `col-${index}-0`, blocks: manyBlocks }, { id: `col-${index}-1`, blocks: [] }] }, `cols-${index}`)
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
