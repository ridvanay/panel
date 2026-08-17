import { describe, expect, it } from "vitest";
import { sanitizePageBlocks, sanitizePageTranslations } from "../../src/modules/pages/lib/sanitize-blocks";

/** Test yardımcısı — `unknown[]` dönen sanitize sonucundan, `any` KULLANMADAN iç içe `html` alanını okur. */
function columnBlockHtml(blocks: unknown[], blockIndex: number, columnIndex: number, innerBlockIndex: number): string {
  const block = blocks[blockIndex] as Record<string, unknown>;
  const data = block.data as Record<string, unknown>;
  const columns = data.columns as Record<string, unknown>[];
  const column = columns[columnIndex] as Record<string, unknown>;
  const innerBlocks = column.blocks as Record<string, unknown>[];
  const innerBlock = innerBlocks[innerBlockIndex] as Record<string, unknown>;
  const innerData = innerBlock.data as Record<string, unknown>;
  return innerData.html as string;
}

/**
 * GÜVENLİK REGRESYON TESTİ (§10.17.4) — `sanitizePageBlocks` ÖNCEDEN yalnızca ÜST SEVİYE
 * bloğu dolaşıyordu; bir sütun (`columns`) İÇİNE konan `text` bloğunun `data.html`'i
 * `sanitizeRichHtml`'den HİÇ GEÇMİYORDU → stored XSS. Bu test dosyası, o düzeltmenin
 * kalıcı olduğunu doğrular — regresyon olursa (özyineleme yeniden kaldırılırsa) İLK bu
 * testler kırılmalıdır.
 */
describe("sanitizePageBlocks — columns recursion (stored XSS fix)", () => {
  it("sanitizes a text block's html when it is nested inside a columns block's column", () => {
    const maliciousHtml = '<p>merhaba</p><script>alert("xss")</script><img src=x onerror="alert(1)">';

    const blocks = [
      {
        id: "cols-1",
        type: "columns",
        data: {
          columnCount: 2,
          ratio: "1-1",
          gap: "md",
          verticalAlign: "top",
          columns: [
            { id: "col-0", blocks: [{ id: "text-in-col", type: "text", data: { html: maliciousHtml } }] },
            { id: "col-1", blocks: [] },
          ],
        },
      },
    ];

    const sanitized = sanitizePageBlocks(blocks);
    const sanitizedInnerHtml = columnBlockHtml(sanitized, 0, 0, 0);

    expect(sanitizedInnerHtml).not.toContain("<script");
    expect(sanitizedInnerHtml).not.toContain("onerror");
    expect(sanitizedInnerHtml).toContain("<p>merhaba</p>");
  });

  it("sanitizes text blocks in every column, not just the first", () => {
    const blocks = [
      {
        id: "cols-1",
        type: "columns",
        data: {
          columnCount: 2,
          ratio: "1-1",
          gap: "md",
          verticalAlign: "top",
          columns: [
            { id: "col-0", blocks: [{ id: "t0", type: "text", data: { html: "<script>a()</script>col0" } }] },
            { id: "col-1", blocks: [{ id: "t1", type: "text", data: { html: "<script>b()</script>col1" } }] },
          ],
        },
      },
    ];

    const sanitized = sanitizePageBlocks(blocks);
    expect(columnBlockHtml(sanitized, 0, 0, 0)).not.toContain("<script");
    expect(columnBlockHtml(sanitized, 0, 1, 0)).not.toContain("<script");
  });

  it("leaves top-level (non-columns) blocks behaving exactly as before", () => {
    const blocks = [{ id: "t", type: "text", data: { html: '<script>alert(1)</script><p>ok</p>' } }, { id: "h", type: "hero", data: { title: "x" } }];
    const sanitized = sanitizePageBlocks(blocks) as Record<string, unknown>[];
    const firstData = sanitized[0]!.data as Record<string, unknown>;
    expect(firstData.html).not.toContain("<script");
    expect(firstData.html).toContain("<p>ok</p>");
    expect(sanitized[1]).toEqual(blocks[1]);
  });

  it("sanitizePageTranslations also sanitizes columns nested inside translated blocks", () => {
    const translations = {
      en: {
        blocks: [
          {
            id: "cols-1",
            type: "columns",
            data: {
              columnCount: 2,
              ratio: "1-1",
              gap: "md",
              verticalAlign: "top",
              columns: [
                { id: "col-0", blocks: [{ id: "text-in-col", type: "text", data: { html: "<script>x()</script>en" } }] },
                { id: "col-1", blocks: [] },
              ],
            },
          },
        ],
      },
    };

    const sanitized = sanitizePageTranslations(translations);
    const enFields = sanitized.en as Record<string, unknown>;
    expect(columnBlockHtml(enFields.blocks as unknown[], 0, 0, 0)).not.toContain("<script");
  });

  it("is defensive against malformed columns data (does not throw, does not drop the block)", () => {
    const blocks = [{ id: "cols", type: "columns", data: {} }, { id: "cols2", type: "columns" }];
    expect(() => sanitizePageBlocks(blocks)).not.toThrow();
    expect(sanitizePageBlocks(blocks)).toEqual(blocks);
  });
});
