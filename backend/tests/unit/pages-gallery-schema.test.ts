import { describe, expect, it } from "vitest";
import { CreatePageRequestSchema } from "../../src/modules/pages/pages.schemas";

interface GalleryBlockDataV1 {
  images: { url: string; alt: string }[];
  layout?: "grid" | "carousel" | "masonry";
}

function galleryBlock(overrides: Partial<GalleryBlockDataV1> = {}, id = "gallery-1") {
  return {
    id,
    type: "gallery",
    data: {
      images: [
        { url: "/uploads/a.jpg", alt: "a" },
        { url: "/uploads/b.jpg", alt: "" },
      ],
      ...overrides,
    } as GalleryBlockDataV1,
  };
}

describe("CreatePageRequestSchema — gallery block validation", () => {
  it("accepts a well-formed gallery block with images and layout", () => {
    const block = galleryBlock({ layout: "carousel" });
    const result = CreatePageRequestSchema.safeParse({ title: "x", blocks: [block] });
    expect(result.success).toBe(true);
  });

  it("accepts an empty images array (not-yet-filled block)", () => {
    const block = galleryBlock({ images: [] });
    const result = CreatePageRequestSchema.safeParse({ title: "x", blocks: [block] });
    expect(result.success).toBe(true);
  });

  it("defaults a missing 'layout' field to 'grid' (legacy record backward compatibility)", () => {
    const legacy = { id: "gallery-legacy", type: "gallery", data: { images: [{ url: "/a.jpg", alt: "" }] } };
    const result = CreatePageRequestSchema.safeParse({ title: "x", blocks: [legacy] });
    expect(result.success).toBe(true);
    if (result.success) {
      const block = result.data.blocks?.[0] as unknown as { data: GalleryBlockDataV1 };
      expect(block.data.layout).toBe("grid");
    }
  });

  it("allows an empty 'alt' string (missing alt text is a UI warning, not a blocking error)", () => {
    const block = galleryBlock({ images: [{ url: "/uploads/c.jpg", alt: "" }] });
    const result = CreatePageRequestSchema.safeParse({ title: "x", blocks: [block] });
    expect(result.success).toBe(true);
  });

  it("rejects an image with an empty 'url'", () => {
    const block = galleryBlock({ images: [{ url: "", alt: "x" }] });
    const result = CreatePageRequestSchema.safeParse({ title: "x", blocks: [block] });
    expect(result.success).toBe(false);
  });

  it("rejects an invalid 'layout' value", () => {
    const block = { ...galleryBlock(), data: { images: [], layout: "slideshow" } };
    const result = CreatePageRequestSchema.safeParse({ title: "x", blocks: [block] });
    expect(result.success).toBe(false);
  });

  it("accepts exactly 30 images (GALLERY_MAX_IMAGES boundary)", () => {
    const images = Array.from({ length: 30 }, (_, i) => ({ url: `/img-${i}.jpg`, alt: `img ${i}` }));
    const block = galleryBlock({ images });
    const result = CreatePageRequestSchema.safeParse({ title: "x", blocks: [block] });
    expect(result.success).toBe(true);
  });

  it("rejects 31 images (over the GALLERY_MAX_IMAGES cap — DoS guard)", () => {
    const images = Array.from({ length: 31 }, (_, i) => ({ url: `/img-${i}.jpg`, alt: `img ${i}` }));
    const block = galleryBlock({ images });
    const result = CreatePageRequestSchema.safeParse({ title: "x", blocks: [block] });
    expect(result.success).toBe(false);
  });

  it("still accepts fully free-form non-gallery blocks (minimum diff, unchanged behavior)", () => {
    const result = CreatePageRequestSchema.safeParse({
      title: "x",
      blocks: [{ id: "1", type: "hero", data: { anything: "goes" } }],
    });
    expect(result.success).toBe(true);
  });
});

describe("CreatePageRequestSchema — translations.<LOCALE>.blocks obey the same gallery rules", () => {
  it("rejects translations.EN.blocks with a gallery image count over the cap", () => {
    const images = Array.from({ length: 31 }, (_, i) => ({ url: `/img-${i}.jpg`, alt: `img ${i}` }));
    const result = CreatePageRequestSchema.safeParse({
      title: "x",
      translations: { EN: { blocks: [galleryBlock({ images })] } },
    });
    expect(result.success).toBe(false);
  });

  it("still accepts a well-formed translations.EN.blocks gallery block (locale=null delete semantics unaffected)", () => {
    // NOT: `TranslationsSchema` (bkz. pages.schemas.ts) yalnızca `superRefine` ile DOĞRULAR,
    // `columns`'un legacy-normalize davranışı gibi `transform` UYGULAMAZ — bu üst seviye `blocks`
    // alanından (ki o `BlockSchema.transform` ile normalize edilir) FARKLI, ÖNCEDEN VAR OLAN bir
    // davranış (bkz. TranslationsSchema tanımı). Bu yüzden burada yalnızca kabul edildiğini
    // doğruluyoruz, `layout` varsayılanının çıktıya yansıdığını DEĞİL.
    const result = CreatePageRequestSchema.safeParse({
      title: "x",
      translations: { EN: { blocks: [galleryBlock()] }, DE: null },
    });
    expect(result.success).toBe(true);
  });
});
