import { describe, expect, it } from "vitest";
import {
  buildCatalogOrderBy,
  buildCatalogWhere,
  buildInStockWhere,
  buildOptionWhere,
  type CatalogFilterState,
} from "../../src/modules/products/lib/catalog-query";

const EMPTY_STATE: CatalogFilterState = { categoryIds: null };

/**
 * §3.3 (.claude/architect-scope-products-catalog.md, bağlayıcı) — filtre semantiği: taban HER
 * ZAMAN `status: PUBLISHED, deletedAt: null`; `inStock=true` "satılan seviyede" OR koşulu;
 * `option` eksen içi OR (`hasSome`), eksenler arası AND (ayrı `some` blokları).
 */
describe("buildCatalogWhere — taban filtre", () => {
  it("her zaman status: PUBLISHED ve deletedAt: null içerir", () => {
    const where = buildCatalogWhere(EMPTY_STATE);
    expect(where).toMatchObject({ status: "PUBLISHED", deletedAt: null });
  });

  it("hiçbir filtre yoksa AND dalı EKLENMEZ (gereksiz sarmalama yok)", () => {
    const where = buildCatalogWhere(EMPTY_STATE);
    expect(where).not.toHaveProperty("AND");
  });

  it("categoryIds null iken categoryId filtresi UYGULANMAZ", () => {
    const where = buildCatalogWhere(EMPTY_STATE) as { AND?: unknown[] };
    expect(JSON.stringify(where)).not.toContain("categoryId");
  });

  it("categoryIds boş dizi iken `categoryId: { in: [] }` üretir (bilinmeyen kategori slug'ı → boş sonuç, 404 DEĞİL)", () => {
    const where = buildCatalogWhere({ ...EMPTY_STATE, categoryIds: [] }) as { AND: Array<Record<string, unknown>> };
    expect(where.AND).toContainEqual({ categoryId: { in: [] } });
  });

  it("minPrice/maxPrice effectivePriceCents üzerinde gte/lte üretir", () => {
    const where = buildCatalogWhere({ ...EMPTY_STATE, minPrice: 1000, maxPrice: 5000 }) as {
      AND: Array<Record<string, unknown>>;
    };
    expect(where.AND).toContainEqual({ effectivePriceCents: { gte: 1000, lte: 5000 } });
  });

  it("search title/excerpt/sku üzerinde insensitive contains OR üretir", () => {
    const where = buildCatalogWhere({ ...EMPTY_STATE, search: "tişört" }) as { AND: Array<Record<string, unknown>> };
    expect(where.AND).toContainEqual({
      OR: [
        { title: { contains: "tişört", mode: "insensitive" } },
        { excerpt: { contains: "tişört", mode: "insensitive" } },
        { sku: { contains: "tişört", mode: "insensitive" } },
      ],
    });
  });
});

describe("buildCatalogWhere — inStock (§1.2 satılan seviye kuralı)", () => {
  it("inStock: true iken varyasyonlu/varyasyonsuz iki dallı OR koşulu ekler", () => {
    const where = buildCatalogWhere({ ...EMPTY_STATE, inStock: true }) as { AND: Array<Record<string, unknown>> };
    expect(where.AND).toContainEqual(buildInStockWhere());
  });

  it("buildInStockWhere varyasyonlu ürün için `isActive:true, stockQuantity>0` olan EN AZ BİR varyasyon arar", () => {
    const clause = buildInStockWhere() as { OR: Array<Record<string, unknown>> };
    expect(clause.OR[0]).toEqual({ variants: { some: { isActive: true, stockQuantity: { gt: 0 } } } });
  });

  it("buildInStockWhere varyasyonsuz ürün için `variants: none` VE `Product.stockQuantity>0` arar", () => {
    const clause = buildInStockWhere() as { OR: Array<Record<string, unknown>> };
    expect(clause.OR[1]).toEqual({ AND: [{ variants: { none: {} } }, { stockQuantity: { gt: 0 } }] });
  });

  it("inStock: false (varsayılan) iken HİÇBİR koşul eklenmez", () => {
    const where = buildCatalogWhere({ ...EMPTY_STATE, inStock: false });
    expect(where).not.toHaveProperty("AND");
  });
});

describe("buildOptionWhere / buildCatalogWhere — option filtresi AND/OR matrisi (§3.3)", () => {
  it("token yoksa undefined döner", () => {
    expect(buildOptionWhere(undefined)).toBeUndefined();
    expect(buildOptionWhere([])).toBeUndefined();
  });

  it("AYNI eksenden iki token → tek `some` bloğunda OR (`hasSome` iki değerle)", () => {
    const where = buildOptionWhere(["renk:antrasit", "renk:bej"]) as { AND: Array<Record<string, unknown>> };
    expect(where.AND).toHaveLength(1);
    expect(where.AND[0]).toEqual({
      variants: { some: { isActive: true, optionValueSlugs: { hasSome: ["renk:antrasit", "renk:bej"] } } },
    });
  });

  it("FARKLI eksenlerden token'lar → AYRI `some` blokları AND ile birleşir", () => {
    const where = buildOptionWhere(["renk:antrasit", "beden:l"]) as { AND: Array<Record<string, unknown>> };
    expect(where.AND).toHaveLength(2);
    expect(where.AND).toContainEqual({
      variants: { some: { isActive: true, optionValueSlugs: { hasSome: ["renk:antrasit"] } } },
    });
    expect(where.AND).toContainEqual({
      variants: { some: { isActive: true, optionValueSlugs: { hasSome: ["beden:l"] } } },
    });
  });

  it("karışık: 2 eksenden biri çok değerli (OR), diğeri tek değerli — eksenler arası AND korunur", () => {
    const where = buildOptionWhere(["renk:antrasit", "renk:bej", "beden:l"]) as { AND: Array<Record<string, unknown>> };
    expect(where.AND).toHaveLength(2);
    expect(where.AND).toContainEqual({
      variants: { some: { isActive: true, optionValueSlugs: { hasSome: ["renk:antrasit", "renk:bej"] } } },
    });
    expect(where.AND).toContainEqual({
      variants: { some: { isActive: true, optionValueSlugs: { hasSome: ["beden:l"] } } },
    });
  });
});

describe("buildCatalogOrderBy — sort → orderBy eşlemesi + ZORUNLU seq DESC eş-değer kırıcı (§3.3)", () => {
  it("her seçenek İKİNCİ eleman olarak { seq: 'desc' } içerir", () => {
    for (const sort of ["newest", "price_asc", "price_desc", "bestselling", "discount"] as const) {
      const orderBy = buildCatalogOrderBy(sort);
      expect(orderBy[orderBy.length - 1]).toEqual({ seq: "desc" });
    }
  });

  it("newest → publishedAt DESC NULLS LAST", () => {
    expect(buildCatalogOrderBy("newest")[0]).toEqual({ publishedAt: { sort: "desc", nulls: "last" } });
  });

  it("price_asc/price_desc → effectivePriceCents (indirimli fiyat dahil)", () => {
    expect(buildCatalogOrderBy("price_asc")[0]).toEqual({ effectivePriceCents: "asc" });
    expect(buildCatalogOrderBy("price_desc")[0]).toEqual({ effectivePriceCents: "desc" });
  });

  it("bestselling → salesCount DESC", () => {
    expect(buildCatalogOrderBy("bestselling")[0]).toEqual({ salesCount: "desc" });
  });

  it("discount → discountPercent DESC (indirimsiz ürünler 0 olduğu için sona düşer)", () => {
    expect(buildCatalogOrderBy("discount")[0]).toEqual({ discountPercent: "desc" });
  });
});
