import { describe, expect, it } from "vitest";
import { CreatePageRequestSchema } from "../../src/modules/pages/pages.schemas";

/**
 * §10.19 (v3) — bu dosya ÖNCEDEN v2'nin sabit `columns` şemasını (`data.columns[].width`
 * şeklinde kalan, `columns` olarak KALAN çıktı) test ediyordu. v3'te `type: "columns"` ARTIK
 * ÜRETİLMEZ — WRITE anında SESSİZCE kanonik bir `container` ağacına çevrilir (bkz.
 * `pages.schemas.ts::legacyColumnsToContainer`, tasarım notu §2.1 karar (C) ve §5.4). Bu dosya
 * bu yüzden TAMAMEN YENİDEN YAZILMIŞTIR (§10.17'nin bazı invariant'ları v3'te KASITLI OLARAK
 * geçersiz kılındı — aşağıdaki testler bunu AÇIKÇA belgeler, bkz. `columns`/`hero` iç içe
 * yasağının kaldırılması §3.4 ve konteyner başına çocuk sınırının 20/24'ten TEK bir 24'e
 * birleşmesi §4.3).
 */

interface ContainerSpacingDto {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

interface ContainerSettingsDto {
  layout: "boxed" | "full-width";
  customWidth?: number;
  direction: "row" | "column";
  justifyContent: string;
  alignItems: string;
  gap: number;
  padding: ContainerSpacingDto;
  margin: ContainerSpacingDto;
  background: { type: string };
  widthFr?: number;
}

interface ContainerNodeDto {
  id: string;
  type: "container";
  settings: ContainerSettingsDto;
  children: unknown[];
}

function legacyColumnsBlockV2(overrides: Record<string, unknown> = {}, id = "cols-1") {
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
    },
  };
}

function legacyColumnsBlockV1(ratio: string, columnCount: number, columns: Record<string, unknown>[], id = "legacy-1") {
  return {
    id,
    type: "columns",
    data: { columnCount, ratio, gap: "md", verticalAlign: "top", columns },
  };
}

function containerOf(result: ReturnType<typeof CreatePageRequestSchema.safeParse>, index = 0): ContainerNodeDto {
  if (!result.success) throw new Error("expected a successful parse");
  return result.data.blocks?.[index] as unknown as ContainerNodeDto;
}

describe("CreatePageRequestSchema — legacy `columns` → canonical `container` normalization (v3, §5.4)", () => {
  it("(a) converts a v2 (explicit per-column `width`) columns block into a `container` tree", () => {
    const block = legacyColumnsBlockV2({
      columns: [
        { id: "col-0", width: 3, blocks: [] },
        { id: "col-1", width: 1, blocks: [] },
      ],
    });
    const result = CreatePageRequestSchema.safeParse({ title: "x", blocks: [block] });
    expect(result.success).toBe(true);

    const container = containerOf(result);
    expect(container.type).toBe("container");
    expect(container.settings.direction).toBe("row");
    expect(container.settings.layout).toBe("boxed");
    expect(container.children).toHaveLength(2);

    const [col0, col1] = container.children as ContainerNodeDto[];
    expect(col0!.type).toBe("container");
    expect(col0!.settings.direction).toBe("column");
    expect(col0!.settings.widthFr).toBe(3);
    expect(col1!.settings.widthFr).toBe(1);
  });

  it("(a) converts a v1 (`ratio: '2-1'`) columns block into per-column `widthFr` weights", () => {
    const legacy = legacyColumnsBlockV1("2-1", 2, [
      { id: "col-0", blocks: [] },
      { id: "col-1", blocks: [] },
    ]);
    const result = CreatePageRequestSchema.safeParse({ title: "x", blocks: [legacy] });
    expect(result.success).toBe(true);

    const [col0, col1] = containerOf(result).children as ContainerNodeDto[];
    expect(col0!.settings.widthFr).toBe(2);
    expect(col1!.settings.widthFr).toBe(1);
  });

  it("(a) converts a v1 (`ratio: '1-2'`) columns block into per-column `widthFr` weights", () => {
    const legacy = legacyColumnsBlockV1("1-2", 2, [
      { id: "col-0", blocks: [] },
      { id: "col-1", blocks: [] },
    ]);
    const result = CreatePageRequestSchema.safeParse({ title: "x", blocks: [legacy] });
    expect(result.success).toBe(true);

    const [col0, col1] = containerOf(result).children as ContainerNodeDto[];
    expect(col0!.settings.widthFr).toBe(1);
    expect(col1!.settings.widthFr).toBe(2);
  });

  it("(a) converts a v1 3-column '1-1-1' block into equal `widthFr` weights", () => {
    const legacy = legacyColumnsBlockV1("1-1-1", 3, [
      { id: "col-0", blocks: [] },
      { id: "col-1", blocks: [] },
      { id: "col-2", blocks: [] },
    ]);
    const result = CreatePageRequestSchema.safeParse({ title: "x", blocks: [legacy] });
    expect(result.success).toBe(true);

    const children = containerOf(result).children as ContainerNodeDto[];
    expect(children.map((c) => c.settings.widthFr)).toEqual([1, 1, 1]);
  });

  it("(a) defaults equal `widthFr` (1) when neither an explicit `width` nor a recognized `ratio` is present", () => {
    const legacy = legacyColumnsBlockV1("unknown-ratio", 2, [
      { id: "col-0", blocks: [] },
      { id: "col-1", blocks: [] },
    ]);
    const result = CreatePageRequestSchema.safeParse({ title: "x", blocks: [legacy] });
    expect(result.success).toBe(true);

    const children = containerOf(result).children as ContainerNodeDto[];
    expect(children.map((c) => c.settings.widthFr)).toEqual([1, 1]);
  });

  it("moves a nested `text` block from `data.columns[].blocks` into `container.children` (round-trip content preservation)", () => {
    const result = CreatePageRequestSchema.safeParse({ title: "x", blocks: [legacyColumnsBlockV2()] });
    expect(result.success).toBe(true);

    const col0 = (containerOf(result).children as ContainerNodeDto[])[0]!;
    expect(col0.children).toHaveLength(1);
    expect((col0.children[0] as Record<string, unknown>).type).toBe("text");
    expect(((col0.children[0] as Record<string, unknown>).data as Record<string, unknown>).html).toBe("<p>a</p>");
  });

  it("still accepts fully free-form non-columns/non-container blocks (minimum diff, unchanged behavior)", () => {
    const result = CreatePageRequestSchema.safeParse({
      title: "x",
      blocks: [{ id: "1", type: "hero", data: { anything: "goes", nested: { ok: true } } }],
    });
    expect(result.success).toBe(true);
  });

  it("accepts an arbitrary column count (4) with no fixed 2/3 cap", () => {
    const block = legacyColumnsBlockV2({
      columns: Array.from({ length: 4 }, (_, i) => ({ id: `col-${i}`, width: 1, blocks: [] })),
    });
    const result = CreatePageRequestSchema.safeParse({ title: "x", blocks: [block] });
    expect(result.success).toBe(true);
  });

  it("now accepts a single-column legacy block (v2's min-2-columns rule is NOT part of the v3 container schema)", () => {
    const block = legacyColumnsBlockV2({ columns: [{ id: "only-one", width: 1, blocks: [] }] });
    const result = CreatePageRequestSchema.safeParse({ title: "x", blocks: [block] });
    expect(result.success).toBe(true);
  });
});

describe("CreatePageRequestSchema — v2 restrictions LIFTED by v3 (§3.4, §4.3 — documented behavior changes)", () => {
  it("a 'columns' block nested inside a legacy column is now ALLOWED up to MAX_CONTAINER_DEPTH (v2's depth<=1 ban is gone)", () => {
    const block = legacyColumnsBlockV2({
      columns: [
        { id: "col-0", width: 1, blocks: [legacyColumnsBlockV2({}, "nested-cols")] },
        { id: "col-1", width: 1, blocks: [] },
      ],
    });
    const result = CreatePageRequestSchema.safeParse({ title: "x", blocks: [block] });
    expect(result.success).toBe(true);
  });

  it("a 'hero' block nested inside a legacy column is now ALLOWED (v2's hero-in-column ban is gone, §3.4)", () => {
    const block = legacyColumnsBlockV2({
      columns: [
        { id: "col-0", width: 1, blocks: [{ id: "nested-hero", type: "hero", data: {} }] },
        { id: "col-1", width: 1, blocks: [] },
      ],
    });
    const result = CreatePageRequestSchema.safeParse({ title: "x", blocks: [block] });
    expect(result.success).toBe(true);
  });

  it("accepts exactly MAX_CHILDREN_PER_CONTAINER (24) blocks inside a single column (v2's 20-block-per-column cap is gone, unified at 24)", () => {
    const manyBlocks = Array.from({ length: 24 }, (_, i) => ({ id: `b${i}`, type: "text", data: { html: "x" } }));
    const block = legacyColumnsBlockV2({
      columns: [
        { id: "col-0", width: 1, blocks: manyBlocks },
        { id: "col-1", width: 1, blocks: [] },
      ],
    });
    const result = CreatePageRequestSchema.safeParse({ title: "x", blocks: [block] });
    expect(result.success).toBe(true);
  });

  it("rejects 25 blocks inside a single column (MAX_CHILDREN_PER_CONTAINER — DoS guard, not a UX limit)", () => {
    const manyBlocks = Array.from({ length: 25 }, (_, i) => ({ id: `b${i}`, type: "text", data: { html: "x" } }));
    const block = legacyColumnsBlockV2({
      columns: [
        { id: "col-0", width: 1, blocks: manyBlocks },
        { id: "col-1", width: 1, blocks: [] },
      ],
    });
    const result = CreatePageRequestSchema.safeParse({ title: "x", blocks: [block] });
    expect(result.success).toBe(false);
  });

  it("rejects a row exceeding MAX_CHILDREN_PER_CONTAINER (24) columns", () => {
    const block = legacyColumnsBlockV2({
      columns: Array.from({ length: 25 }, (_, i) => ({ id: `col-${i}`, width: 1, blocks: [] })),
    });
    const result = CreatePageRequestSchema.safeParse({ title: "x", blocks: [block] });
    expect(result.success).toBe(false);
  });
});

describe("CreatePageRequestSchema — translations.<LOCALE>.blocks obey the same legacy-columns normalization rules", () => {
  it("a 'columns' block nested inside a column is ALLOWED when it only appears in translations.EN.blocks (v3 lifts the depth<=1 ban everywhere)", () => {
    const nestedColumnsInTranslation = {
      title: "x",
      translations: {
        EN: {
          blocks: [
            legacyColumnsBlockV2({
              columns: [
                { id: "col-0", width: 1, blocks: [legacyColumnsBlockV2({}, "nested")] },
                { id: "col-1", width: 1, blocks: [] },
              ],
            }),
          ],
        },
      },
    };

    const result = CreatePageRequestSchema.safeParse(nestedColumnsInTranslation);
    expect(result.success).toBe(true);
  });

  it("rejects translations.EN.blocks exceeding MAX_CHILDREN_PER_CONTAINER even though the primary blocks field is empty", () => {
    const manyBlocks = Array.from({ length: 25 }, (_, i) => ({ id: `b${i}`, type: "text", data: { html: "x" } }));
    const blocks = [
      legacyColumnsBlockV2({
        columns: [
          { id: "col-0", width: 1, blocks: manyBlocks },
          { id: "col-1", width: 1, blocks: [] },
        ],
      }),
    ];

    const result = CreatePageRequestSchema.safeParse({ title: "x", translations: { EN: { blocks } } });
    expect(result.success).toBe(false);
  });

  it("still accepts a well-formed translations.EN.blocks (locale=null delete semantics unaffected)", () => {
    const result = CreatePageRequestSchema.safeParse({
      title: "x",
      translations: { EN: { blocks: [legacyColumnsBlockV2()] }, DE: null },
    });
    expect(result.success).toBe(true);
  });
});
