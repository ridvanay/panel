import { describe, expect, it } from "vitest";
import { normalizePageNodes } from "@/lib/page-builder/normalize";
import type { ContainerNode } from "@/lib/page-builder/types";
import { DEFAULT_CONTAINER_SETTINGS } from "@/lib/page-builder/types";

describe("normalizePageNodes — v3 (container) girdisi", () => {
  it("tam ayarlı bir container düğümünü olduğu gibi geçirir", () => {
    const raw = [
      {
        id: "c1",
        type: "container",
        settings: {
          layout: "full-width",
          direction: "row",
          justifyContent: "center",
          alignItems: "center",
          gap: 24,
          padding: { top: 1, right: 2, bottom: 3, left: 4 },
          margin: { top: 5, right: 6, bottom: 7, left: 8 },
          background: { type: "color", value: "#ff0000" },
          widthFr: 2,
        },
        children: [{ id: "t1", type: "text", data: { html: "<p>x</p>" } }],
      },
    ];

    const result = normalizePageNodes(raw);
    expect(result).toHaveLength(1);
    const node = result[0] as ContainerNode;
    expect(node.type).toBe("container");
    expect(node.id).toBe("c1");
    expect(node.settings).toEqual({
      layout: "full-width",
      direction: "row",
      justifyContent: "center",
      alignItems: "center",
      gap: 24,
      padding: { top: 1, right: 2, bottom: 3, left: 4 },
      margin: { top: 5, right: 6, bottom: 7, left: 8 },
      background: { type: "color", value: "#ff0000" },
      widthFr: 2,
    });
    expect(node.children).toEqual([{ id: "t1", type: "text", data: { html: "<p>x</p>" } }]);
  });

  it("eksik/geçersiz settings alanlarını DEFAULT_CONTAINER_SETTINGS'ten tamamlar", () => {
    const raw = [{ id: "c1", type: "container", settings: { gap: "geçersiz", direction: "diagonal" }, children: [] }];
    const result = normalizePageNodes(raw) as ContainerNode[];
    expect(result[0]!.settings).toEqual(DEFAULT_CONTAINER_SETTINGS);
  });

  it("settings tamamen eksikse (undefined) DEFAULT_CONTAINER_SETTINGS'e düşer", () => {
    const raw = [{ id: "c1", type: "container", children: [] }];
    const result = normalizePageNodes(raw) as ContainerNode[];
    expect(result[0]!.settings).toEqual(DEFAULT_CONTAINER_SETTINGS);
  });

  it("geçersiz minHeight/customWidth/widthFr değerlerini yok sayar (undefined)", () => {
    const raw = [
      {
        id: "c1",
        type: "container",
        settings: { minHeight: { value: "yanlış" }, customWidth: "1200px", widthFr: -1 },
        children: [],
      },
    ];
    const result = normalizePageNodes(raw) as ContainerNode[];
    expect(result[0]!.settings.minHeight).toBeUndefined();
    expect(result[0]!.settings.customWidth).toBeUndefined();
    expect(result[0]!.settings.widthFr).toBeUndefined();
  });

  it("negatif padding/margin değerlerini 0'a düşürür (negatif margin YASAK)", () => {
    const raw = [
      { id: "c1", type: "container", settings: { padding: { top: -5, right: 2, bottom: 3, left: 4 } }, children: [] },
    ];
    const result = normalizePageNodes(raw) as ContainerNode[];
    expect(result[0]!.settings.padding.top).toBe(0);
  });

  it("çocukları özyinelemeli olarak normalize eder (iç içe container)", () => {
    const raw = [
      {
        id: "outer",
        type: "container",
        children: [{ id: "inner", type: "container", children: [{ id: "t1", type: "text", data: { html: "x" } }] }],
      },
    ];
    const result = normalizePageNodes(raw) as ContainerNode[];
    const inner = result[0]!.children[0] as ContainerNode;
    expect(inner.type).toBe("container");
    expect(inner.settings).toEqual(DEFAULT_CONTAINER_SETTINGS);
    expect(inner.children).toEqual([{ id: "t1", type: "text", data: { html: "x" } }]);
  });
});

describe("normalizePageNodes — legacy `columns` (v1/v2) → `container`", () => {
  it("v2 (width alanlı) sütunları widthFr'ye birebir taşır", () => {
    const raw = [
      {
        id: "row1",
        type: "columns",
        data: {
          gap: "lg",
          verticalAlign: "center",
          columns: [
            { id: "col0", width: 3, blocks: [{ id: "a", type: "text", data: { html: "a" } }] },
            { id: "col1", width: 1, blocks: [] },
          ],
        },
      },
    ];

    const result = normalizePageNodes(raw) as ContainerNode[];
    const outer = result[0]!;
    expect(outer.type).toBe("container");
    expect(outer.id).toBe("row1");
    expect(outer.settings.direction).toBe("row");
    expect(outer.settings.layout).toBe("boxed");
    expect(outer.settings.customWidth).toBe(1024);
    expect(outer.settings.gap).toBe(32); // lg → 32px
    expect(outer.settings.alignItems).toBe("center"); // verticalAlign: center → alignItems: center
    expect(outer.settings.padding).toEqual({ top: 16, right: 0, bottom: 16, left: 0 });

    const [col0, col1] = outer.children as ContainerNode[];
    expect(col0!.id).toBe("col0");
    expect(col0!.settings.direction).toBe("column");
    expect(col0!.settings.widthFr).toBe(3);
    expect(col0!.children).toEqual([{ id: "a", type: "text", data: { html: "a" } }]);
    expect(col1!.settings.widthFr).toBe(1);
  });

  it("v1 (ratio='2-1', width YOK) görsel oranı [2,1] olarak korur", () => {
    const raw = [
      {
        id: "row1",
        type: "columns",
        data: { ratio: "2-1", columns: [{ id: "col0", blocks: [] }, { id: "col1", blocks: [] }] },
      },
    ];
    const result = normalizePageNodes(raw) as ContainerNode[];
    const [col0, col1] = result[0]!.children as ContainerNode[];
    expect(col0!.settings.widthFr).toBe(2);
    expect(col1!.settings.widthFr).toBe(1);
  });

  it("v1 (ratio='1-2') görsel oranı [1,2] olarak korur", () => {
    const raw = [
      { id: "row1", type: "columns", data: { ratio: "1-2", columns: [{ id: "c0", blocks: [] }, { id: "c1", blocks: [] }] } },
    ];
    const result = normalizePageNodes(raw) as ContainerNode[];
    const [c0, c1] = result[0]!.children as ContainerNode[];
    expect(c0!.settings.widthFr).toBe(1);
    expect(c1!.settings.widthFr).toBe(2);
  });

  it("ne width ne ratio varsa (v2 3+ sütun varsayılanı) eşit (1) ağırlık verir", () => {
    const raw = [
      {
        id: "row1",
        type: "columns",
        data: { columns: [{ id: "c0", blocks: [] }, { id: "c1", blocks: [] }, { id: "c2", blocks: [] }] },
      },
    ];
    const result = normalizePageNodes(raw) as ContainerNode[];
    const widths = (result[0]!.children as ContainerNode[]).map((c) => c.settings.widthFr);
    expect(widths).toEqual([1, 1, 1]);
  });

  it("gap token → px eşlemesi (none/sm/md/lg → 0/8/16/32)", () => {
    const gapCases: [string, number][] = [
      ["none", 0],
      ["sm", 8],
      ["md", 16],
      ["lg", 32],
    ];
    for (const [gap, px] of gapCases) {
      const raw = [{ id: "r", type: "columns", data: { gap, columns: [] } }];
      const result = normalizePageNodes(raw) as ContainerNode[];
      expect(result[0]!.settings.gap).toBe(px);
    }
  });

  it("verticalAlign eşlemesi (top/center/bottom → start/center/end)", () => {
    const cases: [string, string][] = [
      ["top", "start"],
      ["center", "center"],
      ["bottom", "end"],
    ];
    for (const [verticalAlign, alignItems] of cases) {
      const raw = [{ id: "r", type: "columns", data: { verticalAlign, columns: [] } }];
      const result = normalizePageNodes(raw) as ContainerNode[];
      expect(result[0]!.settings.alignItems).toBe(alignItems);
    }
  });

  it("sütun içindeki blokları da özyinelemeli normalize eder (iç içe legacy → container)", () => {
    const raw = [
      {
        id: "outer",
        type: "columns",
        data: {
          columns: [
            {
              id: "col0",
              blocks: [{ id: "inner-row", type: "columns", data: { columns: [{ id: "c0", blocks: [] }] } }],
            },
          ],
        },
      },
    ];
    const result = normalizePageNodes(raw) as ContainerNode[];
    const innerColumn = result[0]!.children[0] as ContainerNode;
    const innerRow = innerColumn.children[0] as ContainerNode;
    expect(innerRow.type).toBe("container");
    expect(innerRow.id).toBe("inner-row");
  });
});

describe("normalizePageNodes — bozuk/eksik veri", () => {
  it("dizi olmayan girdi için boş dizi döner", () => {
    expect(normalizePageNodes(null)).toEqual([]);
    expect(normalizePageNodes(undefined)).toEqual([]);
    expect(normalizePageNodes("not-an-array")).toEqual([]);
    expect(normalizePageNodes({})).toEqual([]);
  });

  it("eksik id'ye stabil, index tabanlı bir fallback (`__n{n}`) atar — newId() DEĞİL", () => {
    const raw = [{ type: "text", data: { html: "a" } }, { type: "text", data: { html: "b" } }];
    const result = normalizePageNodes(raw);
    expect(result[0]!.id).toBe("__n0");
    expect(result[1]!.id).toBe("__n1");

    // Aynı girdi → aynı fallback id'ler (deterministik, React key kararlılığı için KRİTİK).
    const again = normalizePageNodes(raw);
    expect(again[0]!.id).toBe("__n0");
    expect(again[1]!.id).toBe("__n1");
  });

  it("dizi elemanı obje değilse görünmez boş bir metin bloğuna düşer, ağaç kırılmaz", () => {
    const raw = [null, 42, "string", { id: "ok", type: "text", data: { html: "x" } }];
    const result = normalizePageNodes(raw);
    expect(result).toHaveLength(4);
    expect(result[3]).toEqual({ id: "ok", type: "text", data: { html: "x" } });
    expect(result[0]!.type).toBe("text");
  });

  it("tanınmayan `type` düğümü olduğu gibi (id normalize edilmiş halde) geçirir", () => {
    const raw = [{ id: "x1", type: "future-block-type", data: { anything: true } }];
    const result = normalizePageNodes(raw);
    expect(result[0]).toEqual({ id: "x1", type: "future-block-type", data: { anything: true } });
  });
});
