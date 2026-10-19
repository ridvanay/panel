import { describe, expect, it } from "vitest";
import { CreatePageRequestSchema } from "../../src/modules/pages/pages.schemas";
import { TEMPLATE_EDITABLE_FIELDS } from "../../src/lib/page-template-fields";

/**
 * Paket A3 (2026-10-18) — `featured-doctors` blok şeması, `text.align`, `image`/`heading` `href`.
 * Dispatch dalı unutulursa blok doğrulanmadan geçerdi — geçersiz değerlerin reddi açıkça test edilir.
 */
function parseBlocks(blocks: unknown[]) {
  return CreatePageRequestSchema.safeParse({ title: "Anasayfa", slug: "anasayfa", blocks });
}

function firstData(result: ReturnType<typeof parseBlocks>) {
  return (result.success ? result.data.blocks?.[0] : null) as { data: Record<string, unknown> } | null;
}

const ID = (n: number) => `0000000${n}-0000-4000-8000-000000000000`;

describe("featured-doctors blok şeması", () => {
  it("boş data'yı varsayılanlarla doldurur (4 sütun, oval, buton açık)", () => {
    const result = parseBlocks([{ id: "fd", type: "featured-doctors", data: {} }]);
    expect(result.success).toBe(true);
    expect(firstData(result)!.data).toEqual({ content: {}, doctorIds: [], columns: 4, imageShape: "oval", showAllButton: true });
  });

  it("TR/EN içerik ve sıralı doktor id'lerini kabul eder, boşlukları kırpar", () => {
    const result = parseBlocks([
      {
        id: "fd",
        type: "featured-doctors",
        data: {
          content: { tr: { title: " Doktorlarımız ", subtitle: "", buttonLabel: "Tümü" }, en: { title: "Our Doctors" } },
          doctorIds: [ID(2), ID(1)],
          columns: 3,
          imageShape: "square",
          showAllButton: false,
        },
      },
    ]);
    expect(result.success).toBe(true);
    const data = firstData(result)!.data as { content: Record<string, { title: string; buttonLabel: string }>; doctorIds: string[] };
    expect(data.content.tr!.title).toBe("Doktorlarımız");
    expect(data.content.en!.buttonLabel).toBe("");
    expect(data.doctorIds).toEqual([ID(2), ID(1)]);
  });

  it.each([
    ["8'den fazla doktor", { doctorIds: Array.from({ length: 9 }, (_, i) => ID(i)) }],
    ["tekrarlanan doktor", { doctorIds: [ID(1), ID(1)] }],
    ["uuid olmayan id", { doctorIds: ["ayse-yilmaz"] }],
    ["geçersiz sütun", { columns: 6 }],
    ["geçersiz şekil", { imageShape: "rounded" }],
    ["çok uzun başlık", { content: { tr: { title: "x".repeat(121) } } }],
    ["geçersiz dil kodu", { content: { TR_tr: { title: "x" } } }],
  ])("%s reddedilir", (_label, data) => {
    expect(parseBlocks([{ id: "fd", type: "featured-doctors", data }]).success).toBe(false);
  });

  it("konteyner içinde de doğrulanır", () => {
    const result = parseBlocks([
      { id: "c", type: "container", settings: {}, children: [{ id: "fd", type: "featured-doctors", data: { columns: 5 } }] },
    ]);
    expect(result.success).toBe(false);
  });

  it("Paket D — layout/source/autoplay opsiyonel: verilmezse çıktıya eklenmez, verilirse korunur", () => {
    const legacy = parseBlocks([{ id: "fd", type: "featured-doctors", data: { doctorIds: [ID(1)] } }]);
    expect(firstData(legacy)!.data).not.toHaveProperty("layout");
    expect(firstData(legacy)!.data).not.toHaveProperty("source");
    expect(firstData(legacy)!.data).not.toHaveProperty("autoplay");

    const carousel = parseBlocks([{ id: "fd", type: "featured-doctors", data: { layout: "carousel", source: "all", autoplay: true } }]);
    expect(carousel.success).toBe(true);
    expect(firstData(carousel)!.data).toMatchObject({ layout: "carousel", source: "all", autoplay: true });
  });

  it("Paket D — carousel düzeninde 24 doktora kadar kabul edilir, 25 reddedilir; ızgarada 8 sınırı sürer", () => {
    const ids = (n: number) => Array.from({ length: n }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
    expect(parseBlocks([{ id: "fd", type: "featured-doctors", data: { layout: "carousel", doctorIds: ids(24) } }]).success).toBe(true);
    expect(parseBlocks([{ id: "fd", type: "featured-doctors", data: { layout: "carousel", doctorIds: ids(25) } }]).success).toBe(false);
    expect(parseBlocks([{ id: "fd", type: "featured-doctors", data: { layout: "grid", doctorIds: ids(9) } }]).success).toBe(false);
    expect(parseBlocks([{ id: "fd", type: "featured-doctors", data: { doctorIds: ids(8) } }]).success).toBe(true);
  });

  it.each([
    ["geçersiz layout", { layout: "slider" }],
    ["geçersiz source", { source: "featured" }],
    ["boolean olmayan autoplay", { autoplay: "yes" }],
  ])("Paket D — %s reddedilir", (_label, data) => {
    expect(parseBlocks([{ id: "fd", type: "featured-doctors", data }]).success).toBe(false);
  });

  it("şablon modunda başlıklar/seçim/buton düzenlenebilir, düzen kilitli", () => {
    expect(TEMPLATE_EDITABLE_FIELDS["featured-doctors"]).toEqual(["data.content", "data.doctorIds", "data.showAllButton"]);
  });
});

describe("text.align, image/heading href", () => {
  it("metin bloğu align kabul eder, eski kayıt (align yok) bozulmaz, bilinmeyen alanlar korunur", () => {
    const ok = parseBlocks([{ id: "t", type: "text", data: { html: "<p>x</p>", align: "center" } }]);
    expect(firstData(ok)!.data).toEqual({ html: "<p>x</p>", align: "center" });
    const legacy = parseBlocks([{ id: "t", type: "text", data: { html: "<p>x</p>", legacyFlag: true } }]);
    expect(firstData(legacy)!.data).toEqual({ html: "<p>x</p>", legacyFlag: true });
    expect(parseBlocks([{ id: "t", type: "text", data: { html: "x", align: "justify" } }]).success).toBe(false);
  });

  it.each(["image", "heading"] as const)("%s bloğu güvenli href kabul eder, javascript: reddeder", (type) => {
    const base = type === "image" ? { url: "/x.png", alt: "" } : { text: "Başlık" };
    for (const href of ["/doctors/ayse", "https://example.com/a"]) {
      const result = parseBlocks([{ id: "b", type, data: { ...base, href } }]);
      expect(result.success).toBe(true);
      expect(firstData(result)!.data.href).toBe(href);
    }
    expect(parseBlocks([{ id: "b", type, data: { ...base, href: "javascript:alert(1)" } }]).success).toBe(false);
    expect(parseBlocks([{ id: "b", type, data: base }]).success).toBe(true);
  });
});
