import { describe, expect, it } from "vitest";
import { MODERN_ARCHITECTURE_TEMPLATE } from "../../src/modules/demo-templates/templates/modern-architecture";
import { PageBlockListSchema } from "../../src/modules/pages/pages.schemas";
import { SlideLayersSchema } from "../../src/modules/sliders/lib/layers";
import { resolvePageBlockTokens } from "../../src/modules/demo-templates/lib/asset-tokens";

/**
 * `.claude/architect-scope-demo-template-import.md` §12 madde 1-3 — bu test dosyası
 * `modern-architecture` şablonu HER değiştiğinde koruyucudur: şablon değişse de bu testler
 * geçmelidir, aksi hâlde şablon üretimde `422`/bozuk sayfa üretir (bkz. mimari doküman §2).
 */
describe("modern-architecture demo şablonu — şema uygunluğu (§12 madde 1-3)", () => {
  const PLACEHOLDER_UUID = "00000000-0000-0000-0000-000000000000";

  it("madde 1 — page.blocks PageBlockListSchema'dan geçer (asset/ref token'ları çözülmüş hâliyle)", () => {
    const assetMap = new Map(MODERN_ARCHITECTURE_TEMPLATE.assets.map((asset) => [asset.key, `/uploads/${asset.key}.png`]));
    const resolved = resolvePageBlockTokens(
      MODERN_ARCHITECTURE_TEMPLATE.page.blocks as unknown[],
      assetMap,
      MODERN_ARCHITECTURE_TEMPLATE.slider ? PLACEHOLDER_UUID : null
    );
    expect(resolved.unresolvedTokens).toEqual([]);

    const result = PageBlockListSchema.safeParse(resolved.blocks);
    if (!result.success) {
      // Hata mesajlarını görünür kılmak için — bu test kırılırsa hangi alanın bozuk olduğu
      // doğrudan test çıktısında görünmelidir.
      expect(result.error.issues).toEqual([]);
    }
    expect(result.success).toBe(true);
  });

  it("madde 2 — slider.slides[].layers her biri SlideLayersSchema'dan geçer", () => {
    const slider = MODERN_ARCHITECTURE_TEMPLATE.slider;
    expect(slider).not.toBeNull();
    expect(slider!.slides.length).toBeGreaterThan(0);

    for (const slide of slider!.slides) {
      const result = SlideLayersSchema.safeParse(slide.layers);
      if (!result.success) {
        expect(result.error.issues).toEqual([]);
      }
      expect(result.success).toBe(true);
    }
  });

  it("madde 3a — assets[].key benzersizdir", () => {
    const keys = MODERN_ARCHITECTURE_TEMPLATE.assets.map((asset) => asset.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("madde 3b — assets[].file yol ayracı İÇERMEZ (§4.4 güvenlik)", () => {
    for (const asset of MODERN_ARCHITECTURE_TEMPLATE.assets) {
      expect(asset.file).not.toMatch(/[\\/]/);
    }
  });

  it("madde 3c — page.blocks içindeki HER asset:/ref: token'ı çözülebilir", () => {
    const assetMap = new Map(MODERN_ARCHITECTURE_TEMPLATE.assets.map((asset) => [asset.key, `/uploads/${asset.key}.png`]));
    const resolved = resolvePageBlockTokens(
      MODERN_ARCHITECTURE_TEMPLATE.page.blocks as unknown[],
      assetMap,
      MODERN_ARCHITECTURE_TEMPLATE.slider ? PLACEHOLDER_UUID : null
    );
    expect(resolved.unresolvedTokens).toEqual([]);

    // `ref:slider` GERÇEKTEN yer değiştirmiş olmalı (hero bloğu ilk blok).
    const heroBlock = (resolved.blocks[0] as { type: string; data: { sliderId: string } })!;
    expect(heroBlock.type).toBe("advanced-slider");
    expect(heroBlock.data.sliderId).toBe(PLACEHOLDER_UUID);
  });

  it("madde 3d — portfolio.items[].coverAssetKey/galleryAssetKeys VE slider.slides[].bgAssetKey assets[]'te TANIMLI", () => {
    const definedKeys = new Set(MODERN_ARCHITECTURE_TEMPLATE.assets.map((asset) => asset.key));

    for (const item of MODERN_ARCHITECTURE_TEMPLATE.portfolio.items) {
      if (item.coverAssetKey) expect(definedKeys.has(item.coverAssetKey)).toBe(true);
      for (const galleryKey of item.galleryAssetKeys) expect(definedKeys.has(galleryKey)).toBe(true);
    }

    for (const slide of MODERN_ARCHITECTURE_TEMPLATE.slider?.slides ?? []) {
      if (slide.bgAssetKey) expect(definedKeys.has(slide.bgAssetKey)).toBe(true);
    }
  });

  it("madde 3e (ek) — portfolio.categories[].slug ile items[].categorySlug tutarlıdır", () => {
    const categorySlugs = new Set(MODERN_ARCHITECTURE_TEMPLATE.portfolio.categories.map((c) => c.slug));
    for (const item of MODERN_ARCHITECTURE_TEMPLATE.portfolio.items) {
      if (item.categorySlug) expect(categorySlugs.has(item.categorySlug)).toBe(true);
    }
  });
});
