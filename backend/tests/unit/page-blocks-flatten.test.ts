import { describe, expect, it } from "vitest";
import { flattenPageBlocks } from "../../src/lib/page-blocks";

describe("flattenPageBlocks", () => {
  it("returns non-columns blocks unchanged", () => {
    const blocks = [{ id: "1", type: "text", data: { html: "<p>a</p>" } }];
    expect(flattenPageBlocks(blocks)).toEqual(blocks);
  });

  it("flattens a columns block's children in document order (column 0 -> column 1) and keeps the container itself", () => {
    const child0 = { id: "c0", type: "text", data: { html: "col0" } };
    const child1 = { id: "c1", type: "image", data: { url: "https://x/y.png", alt: "x" } };
    const columnsBlock = {
      id: "cols",
      type: "columns",
      data: {
        columnCount: 2,
        ratio: "1-1",
        gap: "md",
        verticalAlign: "top",
        columns: [
          { id: "col-a", blocks: [child0] },
          { id: "col-b", blocks: [child1] },
        ],
      },
    };

    const result = flattenPageBlocks([columnsBlock]);

    expect(result).toContainEqual(columnsBlock);
    expect(result).toContainEqual(child0);
    expect(result).toContainEqual(child1);
    // Konteyner + iki çocuk = 3 satır.
    expect(result).toHaveLength(3);
    // Sütun 0 çocuğu, sütun 1 çocuğundan ÖNCE gelmelidir (doküman sırası).
    expect(result.indexOf(child0)).toBeLessThan(result.indexOf(child1));
  });

  it("is defensive against malformed/garbage block shapes (does not throw)", () => {
    expect(() => flattenPageBlocks([null, undefined, 42, "x", {}, { type: "columns" }, { type: "columns", data: {} }])).not.toThrow();
  });

  it("preserves blocks that come before/after a columns block", () => {
    const before = { id: "before", type: "hero", data: {} };
    const after = { id: "after", type: "cta", data: {} };
    const columnsBlock = {
      id: "cols",
      type: "columns",
      data: { columnCount: 2, ratio: "1-1", gap: "md", verticalAlign: "top", columns: [{ id: "a", blocks: [] }, { id: "b", blocks: [] }] },
    };

    const result = flattenPageBlocks([before, columnsBlock, after]);
    expect(result).toEqual([before, columnsBlock, after]);
  });
});
