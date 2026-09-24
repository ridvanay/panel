import { describe, expect, it } from "vitest";
import { CreatePageRequestSchema } from "../../src/modules/pages/pages.schemas";
import { TEMPLATE_EDITABLE_FIELDS } from "../../src/lib/page-template-fields";

/**
 * "Uzmanlık Kartları" bloğu (`specialty-cards`). Dispatch dalı unutulsaydı blok doğrulanmadan
 * geçerdi — bu yüzden geçersiz değerlerin reddi açıkça test edilir.
 */
function parseBlocks(blocks: unknown[]) {
  return CreatePageRequestSchema.safeParse({ title: "Anasayfa", slug: "anasayfa", blocks });
}

function cardsBlock(data: Record<string, unknown> = {}) {
  return { id: "sp-cards", type: "specialty-cards", data };
}

describe("specialty-cards blok şeması", () => {
  it("boş data'yı varsayılanlarla doldurur (4 kolon, açıklama açık, daire)", () => {
    const result = parseBlocks([cardsBlock()]);
    expect(result.success).toBe(true);
    const block = (result.success ? result.data.blocks?.[0] : null) as { data: Record<string, unknown> };
    expect(block.data).toEqual({ content: {}, columns: 4, showDescription: true, imageShape: "circle" });
  });

  it("dil başına başlık/alt başlık ve geçerli ayarları kabul eder, boşlukları kırpar", () => {
    const result = parseBlocks([
      cardsBlock({
        content: { tr: { title: "  Uzmanlıklar ", subtitle: "Alt" }, en: { title: "Specialties", subtitle: "" } },
        columns: 6,
        showDescription: false,
        imageShape: "rounded",
      }),
    ]);
    expect(result.success).toBe(true);
    const block = (result.success ? result.data.blocks?.[0] : null) as { data: { content: Record<string, { title: string }> } };
    expect(block.data.content.tr!.title).toBe("Uzmanlıklar");
  });

  it.each([
    ["geçersiz kolon", { columns: 5 }],
    ["geçersiz şekil", { imageShape: "hexagon" }],
    ["geçersiz dil kodu", { content: { "EN!": { title: "x", subtitle: "" } } }],
    ["çok uzun başlık", { content: { en: { title: "x".repeat(121), subtitle: "" } } }],
    ["çok uzun alt başlık", { content: { en: { title: "x", subtitle: "x".repeat(301) } } }],
  ])("reddeder: %s", (_label, data) => {
    expect(parseBlocks([cardsBlock(data)]).success).toBe(false);
  });

  it("konteyner içinde de doğrulanır", () => {
    const container = {
      id: "c1",
      type: "container",
      settings: {
        layout: "boxed",
        direction: "column",
        justifyContent: "start",
        alignItems: "stretch",
        gap: 16,
        padding: { top: 0, right: 0, bottom: 0, left: 0 },
        margin: { top: 0, right: 0, bottom: 0, left: 0 },
        background: { type: "none" },
      },
      children: [cardsBlock({ columns: 7 })],
    };
    expect(parseBlocks([container]).success).toBe(false);
  });

  it("şablon modunda yalnızca başlıklar ve açıklama görünürlüğü düzenlenebilir", () => {
    expect(TEMPLATE_EDITABLE_FIELDS["specialty-cards"]).toEqual(["data.content", "data.showDescription"]);
  });
});
