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

  // §10.19 (v3) — `container.children`'ı da dolaşır (imza değişmez, gövde iteratif).
  it("flattens a container's children in document order and keeps the container itself", () => {
    const child0 = { id: "c0", type: "text", data: { html: "col0" } };
    const child1 = { id: "c1", type: "image", data: { url: "https://x/y.png", alt: "x" } };
    const containerBlock = { id: "container-1", type: "container", settings: {}, children: [child0, child1] };

    const result = flattenPageBlocks([containerBlock]);

    expect(result).toEqual([containerBlock, child0, child1]);
  });

  it("flattens DEEPLY nested containers (container within container) in document order", () => {
    const leaf = { id: "leaf", type: "text", data: { html: "x" } };
    const inner = { id: "inner", type: "container", settings: {}, children: [leaf] };
    const outer = { id: "outer", type: "container", settings: {}, children: [inner] };

    const result = flattenPageBlocks([outer]);

    expect(result).toEqual([outer, inner, leaf]);
  });

  it("is defensive against malformed/garbage container shapes (does not throw)", () => {
    expect(() =>
      flattenPageBlocks([{ type: "container" }, { type: "container", children: "not-an-array" }, { type: "container", children: null }])
    ).not.toThrow();
  });

  it("does not hang/crash on a pathologically deep (100,000-level) container chain — mutlak visit tavanı (ABSOLUTE_VISIT_CAP)", () => {
    let node: unknown = { id: "leaf", type: "text", data: {} };
    for (let i = 0; i < 150_000; i++) {
      node = { id: `c${i}`, type: "container", settings: {}, children: [node] };
    }

    expect(() => flattenPageBlocks([node])).not.toThrow();
  });
});
