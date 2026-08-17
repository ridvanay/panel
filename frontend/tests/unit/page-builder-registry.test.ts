import { describe, expect, it } from "vitest";
import { blockRegistry, createBlock, type PaletteBlockType } from "@/lib/page-builder/registry";

describe("blockRegistry", () => {
  it("has a label for every block type", () => {
    const types: PaletteBlockType[] = ["hero", "text", "image", "gallery", "cta", "featured-products", "featured-portfolio"];
    for (const type of types) {
      expect(blockRegistry[type].label).toEqual(expect.any(String));
      expect(blockRegistry[type].label.length).toBeGreaterThan(0);
    }
  });
});

describe("createBlock", () => {
  it("creates a hero block with default heading data", () => {
    const block = createBlock("hero");
    expect(block.type).toBe("hero");
    if (block.type === "hero") {
      expect(block.data.heading).toBeTruthy();
    }
  });

  it("creates a gallery block with an empty images array", () => {
    const block = createBlock("gallery");
    expect(block.type).toBe("gallery");
    if (block.type === "gallery") {
      expect(block.data.images).toEqual([]);
    }
  });

  it("creates a cta block with a default button href", () => {
    const block = createBlock("cta");
    expect(block.type).toBe("cta");
    if (block.type === "cta") {
      expect(block.data.buttonHref).toBe("/");
    }
  });

  it("assigns a unique id to each created block", () => {
    const a = createBlock("text");
    const b = createBlock("text");
    expect(a.id).not.toBe(b.id);
  });

  // §Faz 4 Site Şablonu — "Öne Çıkan Ürünler"/"Öne Çıkan Projeler" blokları.
  it("creates a featured-products block with a default limit and no categoryId", () => {
    const block = createBlock("featured-products");
    expect(block.type).toBe("featured-products");
    if (block.type === "featured-products") {
      expect(block.data.limit).toBe(4);
      expect(block.data.categoryId).toBeUndefined();
    }
  });

  it("creates a featured-portfolio block with a default limit and no categoryId", () => {
    const block = createBlock("featured-portfolio");
    expect(block.type).toBe("featured-portfolio");
    if (block.type === "featured-portfolio") {
      expect(block.data.limit).toBe(4);
      expect(block.data.categoryId).toBeUndefined();
    }
  });
});
