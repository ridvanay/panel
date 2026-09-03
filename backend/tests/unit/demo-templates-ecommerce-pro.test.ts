import { describe, expect, it, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { ECOMMERCE_PRO_TEMPLATE } from "../../src/modules/demo-templates/templates/ecommerce-pro";
import { PageBlockListSchema } from "../../src/modules/pages/pages.schemas";
import { SlideLayersSchema } from "../../src/modules/sliders/lib/layers";
import { resolvePageBlockTokens } from "../../src/modules/demo-templates/lib/asset-tokens";
import { buildTestApp } from "../helpers/build-test-app";
import { resetDatabase } from "../helpers/reset-db";
import { registerTestUser } from "../helpers/auth";

/**
 * `.claude/architect-scope-ecommerce-pro-template.md` §9.3 kabul kriterleri — `modern-architecture`
 * için `demo-templates-schema.test.ts`nin AYNI disiplini, `ecommerce-pro`'ya uygulanır + gerçek
 * bir import ile §4.5'in ("örnek sipariş üretilmez") kodda fiilen doğru olduğu doğrulanır.
 */
describe("ecommerce-pro demo şablonu — şema uygunluğu", () => {
  const PLACEHOLDER_UUID = "00000000-0000-0000-0000-000000000000";

  function resolveWithPlaceholders() {
    const assetMap = new Map(ECOMMERCE_PRO_TEMPLATE.assets.map((asset) => [asset.key, `/uploads/${asset.key}.png`]));
    const categoryMap = new Map((ECOMMERCE_PRO_TEMPLATE.commerce?.categories ?? []).map((c) => [c.slug, PLACEHOLDER_UUID]));
    return resolvePageBlockTokens(
      ECOMMERCE_PRO_TEMPLATE.page.blocks as unknown[],
      assetMap,
      ECOMMERCE_PRO_TEMPLATE.slider ? PLACEHOLDER_UUID : null,
      categoryMap
    );
  }

  it("page.blocks PageBlockListSchema'dan geçer (asset/ref/ref:product-category token'ları çözülmüş hâliyle)", () => {
    const resolved = resolveWithPlaceholders();
    expect(resolved.unresolvedTokens).toEqual([]);

    const result = PageBlockListSchema.safeParse(resolved.blocks);
    if (!result.success) {
      expect(result.error.issues).toEqual([]);
    }
    expect(result.success).toBe(true);
  });

  it("slider.slides[].layers her biri SlideLayersSchema'dan geçer", () => {
    const slider = ECOMMERCE_PRO_TEMPLATE.slider;
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

  it("extraPages[].blocks her biri PageBlockListSchema'dan geçer", () => {
    for (const extraPage of ECOMMERCE_PRO_TEMPLATE.extraPages) {
      const result = PageBlockListSchema.safeParse(extraPage.blocks);
      if (!result.success) {
        expect(result.error.issues).toEqual([]);
      }
      expect(result.success).toBe(true);
    }
  });

  it("assets[].key benzersizdir ve assets[].file yol ayracı içermez", () => {
    const keys = ECOMMERCE_PRO_TEMPLATE.assets.map((asset) => asset.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const asset of ECOMMERCE_PRO_TEMPLATE.assets) {
      expect(asset.file).not.toMatch(/[\\/]/);
    }
  });

  it("HER asset:/ref:/ref:product-category token'ı çözülebilir", () => {
    const resolved = resolveWithPlaceholders();
    expect(resolved.unresolvedTokens).toEqual([]);
  });

  it("ürünlerin coverAssetKey/galleryAssetKeys/documents[].assetKey referansları assets[]'te tanımlı", () => {
    const definedKeys = new Set(ECOMMERCE_PRO_TEMPLATE.assets.map((asset) => asset.key));
    const documentKeys = new Set(ECOMMERCE_PRO_TEMPLATE.assets.filter((a) => a.kind === "document").map((a) => a.key));

    for (const product of ECOMMERCE_PRO_TEMPLATE.commerce?.products ?? []) {
      if (product.coverAssetKey) expect(definedKeys.has(product.coverAssetKey)).toBe(true);
      for (const key of product.galleryAssetKeys) expect(definedKeys.has(key)).toBe(true);
      for (const variant of product.variants) {
        if (variant.imageAssetKey) expect(definedKeys.has(variant.imageAssetKey)).toBe(true);
      }
      for (const doc of product.documents) {
        expect(documentKeys.has(doc.assetKey)).toBe(true);
      }
    }
  });

  it("ürünlerin categorySlug'ı commerce.categories'te tanımlı", () => {
    const categorySlugs = new Set((ECOMMERCE_PRO_TEMPLATE.commerce?.categories ?? []).map((c) => c.slug));
    for (const product of ECOMMERCE_PRO_TEMPLATE.commerce?.products ?? []) {
      if (product.categorySlug) expect(categorySlugs.has(product.categorySlug)).toBe(true);
    }
  });

  it("§4.6 tavanları: 8 ürün ≤ 12, kategori başına ≤ 12 varyasyon, ≤ 3 döküman, 4 ek sayfa ≤ 8", () => {
    const products = ECOMMERCE_PRO_TEMPLATE.commerce?.products ?? [];
    expect(products.length).toBeLessThanOrEqual(12);
    for (const product of products) {
      expect(product.variants.length).toBeLessThanOrEqual(12);
      expect(product.documents.length).toBeLessThanOrEqual(3);
    }
    expect(ECOMMERCE_PRO_TEMPLATE.extraPages.length).toBeLessThanOrEqual(8);
  });

  it("§4.5 — hiçbir sipariş/sepet/kullanıcı verisi TANIMLANMAMIŞ (statik veri denetimi)", () => {
    const serialized = JSON.stringify(ECOMMERCE_PRO_TEMPLATE);
    expect(serialized).not.toMatch(/"customerEmail"/);
    expect(serialized).not.toMatch(/"stripePaymentIntentId"/);
  });
});

/**
 * Gerçek import — §4.5 kabul kriteri: 8 ürün + 4 kategori + varyasyonlar + dökümanlar oluşur,
 * 4 yasal sayfa `isLegalDocument: true` ile oluşur, hiçbir `Order`/`CartItem`/ek `User` satırı
 * YARATILMAZ.
 */
describe("ecommerce-pro demo şablonu — gerçek import (§4.4/§4.5 kabul kriteri)", () => {
  let app: FastifyInstance;
  let actorId: string;
  let actorEmail: string;

  beforeAll(async () => {
    app = await buildTestApp();
    await resetDatabase(app.prisma);
    const admin = await registerTestUser(app, { email: "ecommerce-pro-import-admin@example.com" });
    actorId = admin.userId;
    actorEmail = "ecommerce-pro-import-admin@example.com";
  });

  afterAll(async () => {
    await resetDatabase(app.prisma);
    await app.close();
  });

  it("ADMIN olarak uygula → 8 ürün + 4 kategori + 11 varyasyon + dökümanlar + 4 yasal sayfa oluşur, hiçbir Order satırı YARATILMAZ", async () => {
    const { importDemoTemplate } = await import("../../src/modules/demo-templates/importer");

    const result = await importDemoTemplate(app, {
      templateKey: "ecommerce-pro",
      body: { confirm: true, force: false, setAsHomePage: true },
      actorId,
      actorEmail,
    });

    expect(result.templateKey).toBe("ecommerce-pro");
    // §4.3 — 4 yasal yer tutucu sayfa oluştuğu için importer bunu warnings[]'te bildirmek
    // ZORUNDADIR (compliance-agent denetimi).
    expect(result.warnings).toEqual(["4 yasal sayfa YER TUTUCU olarak oluşturuldu; yayına almadan önce içeriklerini doldurun."]);

    const productCount = await app.prisma.product.count();
    const categoryCount = await app.prisma.productCategory.count();
    const variantCount = await app.prisma.productVariant.count();
    const documentCount = await app.prisma.productDocument.count();
    const legalPageCount = await app.prisma.page.count({ where: { isLegalDocument: true } });

    expect(productCount).toBe(8);
    expect(categoryCount).toBe(4);
    // 5 varyasyonlu ürün: 2 (silindirik-metal-masa-lambasi) + 3 (kadife-dosemeli-berjer-koltuk)
    // + 2 (katlanabilir-bahce-sandalyesi) + 4 (moduler-raf-sistemi) + 3 (desenli-dekoratif-yastik-seti) = 14.
    expect(variantCount).toBe(14);
    expect(documentCount).toBeGreaterThanOrEqual(2);
    expect(legalPageCount).toBe(4);

    // §4.5 — bilinçli KAPSAM DIŞI: örnek sipariş/sepet YOK.
    expect(await app.prisma.order.count()).toBe(0);
    expect(await app.prisma.cartItem.count()).toBe(0);

    // Kargo alanları §3.2 — commerce != null olduğu için SiteSettings'e yazılmış olmalı.
    const settings = await app.prisma.siteSettings.findUnique({ where: { id: "singleton" } });
    expect(settings?.shippingFlatFeeCents).toBe(4990);
    expect(settings?.freeShippingThresholdCents).toBe(150000);
  });

  it("importer.ts kaynak kodunda order/orderItem/siteUser yazan hiçbir Prisma çağrısı yok (statik denetim)", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const source = await fs.readFile(path.join(__dirname, "../../src/modules/demo-templates/importer.ts"), "utf8");
    expect(source).not.toMatch(/tx\.order\.(create|createMany|upsert)/);
    expect(source).not.toMatch(/tx\.orderItem\.(create|createMany|upsert)/);
    expect(source).not.toMatch(/tx\.cartItem\.(create|createMany|upsert)/);
  });
});
