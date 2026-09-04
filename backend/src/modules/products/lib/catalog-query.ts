import type { FastifyInstance } from "fastify";
import { Prisma } from "@prisma/client";
import { env } from "../../../config/env";
import { slugify } from "../../../lib/slug";
import type { ProductCatalogFacetsDto, ProductCategoryFacetDto, ProductOptionFacetDto } from "../../../schemas/entities";
import type { ProductVariantOption } from "./variants";

/**
 * `GET /products` (public katalog) filtre/sıralama/facet sorgu inşası — `.claude/architect-
 * scope-products-catalog.md` §3.3/§3.4 (bağlayıcı). Route handler'ın şişmemesi için TEK yer
 * (bkz. görev notu §5.2). Prisma `orderBy` bir `COALESCE`/oran ifadesi kabul ETMEZ; bu yüzden
 * fiyat/indirim/çok-satan sıralaması `Product.effectivePriceCents`/`discountPercent`/
 * `salesCount` denormalize kolonlarına dayanır (bkz. `lib/product-pricing.ts::derivePriceColumns`).
 */

export const CATALOG_SORT_VALUES = ["newest", "price_asc", "price_desc", "bestselling", "discount"] as const;
export type CatalogSort = (typeof CATALOG_SORT_VALUES)[number];

/** `GET /products` liste sorgusunun ihtiyaç duyduğu ilişkiler — admin `WITH_RELATIONS`'ın
 * dar bir alt kümesi: `author`/`documents` `ProductListItem`'da HİÇ dönmediği için çekilmez
 * (bkz. §3.2 — mapper zaten bu alanları sonradan da eler, ama sorguyu şişirmemek daha doğru). */
export const CATALOG_LIST_RELATIONS = {
  category: true,
  coverMedia: true,
  images: { include: { media: true }, orderBy: { order: "asc" as const } },
  variants: { include: { media: true }, orderBy: { order: "asc" as const } },
} as const;

export interface CatalogQueryParams {
  search?: string;
  category?: string;
  minPrice?: number;
  maxPrice?: number;
  option?: string[];
  inStock?: boolean;
  sort: CatalogSort;
  page: number;
  perPage: number;
  withFacets: boolean;
}

export interface CatalogFilterState {
  search?: string;
  categoryIds: string[] | null;
  minPrice?: number;
  maxPrice?: number;
  optionTokens?: string[];
  inStock?: boolean;
}

/**
 * Kategori **slug**'ını id'ye çözer — kendisi + ÇOCUKLARI dahil (en fazla 2 seviye, bkz. §2.1).
 * Bilinmeyen slug → `[]` (boş dizi = `categoryId: { in: [] }` ile HİÇ eşleşmez, `404` DEĞİL,
 * §3.3). `slug` verilmemişse `null` (filtre yok).
 */
async function resolveCategoryIds(app: FastifyInstance, categorySlug: string | undefined): Promise<string[] | null> {
  if (!categorySlug) return null;

  const category = await app.prisma.productCategory.findUnique({
    where: { slug: categorySlug },
    include: { children: { select: { id: true } } },
  });
  if (!category) return [];

  return [category.id, ...category.children.map((child) => child.id)];
}

function buildSearchWhere(search: string | undefined): Prisma.ProductWhereInput | undefined {
  if (!search) return undefined;
  // §3.3 — yalnızca kanonik (varsayılan dil) kolonlar taranır, `translations` JSON'u TARANMAZ.
  return {
    OR: [
      { title: { contains: search, mode: "insensitive" } },
      { excerpt: { contains: search, mode: "insensitive" } },
      { sku: { contains: search, mode: "insensitive" } },
    ],
  };
}

function buildPriceWhere(minPrice: number | undefined, maxPrice: number | undefined): Prisma.ProductWhereInput | undefined {
  if (minPrice === undefined && maxPrice === undefined) return undefined;
  return {
    effectivePriceCents: {
      ...(minPrice !== undefined ? { gte: minPrice } : {}),
      ...(maxPrice !== undefined ? { lte: maxPrice } : {}),
    },
  };
}

/**
 * §3.3 — eksen bazında grupla (aynı eksenden birden çok token → OR/`hasSome`), eksenler arası
 * AND (Prisma'da ayrı `some` blokları olarak). Token biçimi `<eksenSlug>:<değerSlug>`.
 */
export function buildOptionWhere(tokens: string[] | undefined): Prisma.ProductWhereInput | undefined {
  if (!tokens || tokens.length === 0) return undefined;

  const tokensByAxis = new Map<string, string[]>();
  for (const token of tokens) {
    const axisSlug = token.split(":")[0]!;
    const list = tokensByAxis.get(axisSlug) ?? [];
    list.push(token);
    tokensByAxis.set(axisSlug, list);
  }

  const axisFilters: Prisma.ProductWhereInput[] = Array.from(tokensByAxis.values()).map((axisTokens) => ({
    variants: { some: { isActive: true, optionValueSlugs: { hasSome: axisTokens } } },
  }));

  return { AND: axisFilters };
}

/**
 * §3.3 `inStock=true` — "stokta" tanımı SATILAN SEVİYEDE: varyasyonlu üründe `isActive:true` VE
 * `stockQuantity>0` olan EN AZ BİR varyasyon; varyasyonsuz üründe `Product.stockQuantity>0`.
 */
export function buildInStockWhere(): Prisma.ProductWhereInput {
  return {
    OR: [
      { variants: { some: { isActive: true, stockQuantity: { gt: 0 } } } },
      { AND: [{ variants: { none: {} } }, { stockQuantity: { gt: 0 } }] },
    ],
  };
}

/** Taban filtre — HER ZAMAN uygulanır: yalnızca yayınlanmış VE çöpte olmayan ürünler. */
function buildBaseWhere(): Prisma.ProductWhereInput {
  return { status: "PUBLISHED", deletedAt: null };
}

export function buildCatalogWhere(state: CatalogFilterState): Prisma.ProductWhereInput {
  const clauses: Prisma.ProductWhereInput[] = [];

  const searchWhere = buildSearchWhere(state.search);
  if (searchWhere) clauses.push(searchWhere);

  const priceWhere = buildPriceWhere(state.minPrice, state.maxPrice);
  if (priceWhere) clauses.push(priceWhere);

  const optionWhere = buildOptionWhere(state.optionTokens);
  if (optionWhere) clauses.push(optionWhere);

  if (state.categoryIds !== null) clauses.push({ categoryId: { in: state.categoryIds } });
  if (state.inStock) clauses.push(buildInStockWhere());

  return { ...buildBaseWhere(), ...(clauses.length > 0 ? { AND: clauses } : {}) };
}

/**
 * `sort` → `orderBy` eşlemesi. HER seçenekte `seq DESC` ZORUNLU eş-değer kırıcı olarak eklenir —
 * aksi halde PostgreSQL sıralamayı garanti etmez ve offset sayfalamada aynı ürün iki sayfada
 * görünebilir (§3.3, bağlayıcı — qa-agent regresyon testi).
 */
export function buildCatalogOrderBy(sort: CatalogSort): Prisma.ProductOrderByWithRelationInput[] {
  switch (sort) {
    case "price_asc":
      return [{ effectivePriceCents: "asc" }, { seq: "desc" }];
    case "price_desc":
      return [{ effectivePriceCents: "desc" }, { seq: "desc" }];
    case "bestselling":
      return [{ salesCount: "desc" }, { seq: "desc" }];
    case "discount":
      return [{ discountPercent: "desc" }, { seq: "desc" }];
    case "newest":
    default:
      return [{ publishedAt: { sort: "desc", nulls: "last" } }, { seq: "desc" }];
  }
}

function excludeDimension(
  state: CatalogFilterState,
  dimension: "category" | "price" | "options" | "availability"
): CatalogFilterState {
  return {
    search: state.search,
    categoryIds: dimension === "category" ? null : state.categoryIds,
    minPrice: dimension === "price" ? undefined : state.minPrice,
    maxPrice: dimension === "price" ? undefined : state.maxPrice,
    optionTokens: dimension === "options" ? undefined : state.optionTokens,
    inStock: dimension === "availability" ? undefined : state.inStock,
  };
}

type CategoryRow = { id: string; name: string; slug: string; parentId: string | null; seq: number };

/** §3.4 madde 1 — kategori facet'i: kök sayacı = kendi + çocuklar. 0 ürünlü dallar/kökler DÜŞÜRÜLÜR. */
async function computeCategoryFacet(app: FastifyInstance, where: Prisma.ProductWhereInput): Promise<ProductCategoryFacetDto[]> {
  const [counts, categories] = await Promise.all([
    app.prisma.product.groupBy({ by: ["categoryId"], where, _count: { _all: true } }),
    app.prisma.productCategory.findMany({ orderBy: { seq: "asc" } }) as Promise<CategoryRow[]>,
  ]);

  const countByCategoryId = new Map<string, number>();
  for (const row of counts) {
    if (row.categoryId) countByCategoryId.set(row.categoryId, row._count._all);
  }

  const childrenByParentId = new Map<string, CategoryRow[]>();
  for (const category of categories) {
    if (!category.parentId) continue;
    const list = childrenByParentId.get(category.parentId) ?? [];
    list.push(category);
    childrenByParentId.set(category.parentId, list);
  }

  const facets: ProductCategoryFacetDto[] = [];
  for (const root of categories.filter((c) => c.parentId === null)) {
    const children = (childrenByParentId.get(root.id) ?? [])
      .map((child) => ({
        id: child.id,
        name: child.name,
        slug: child.slug,
        productCount: countByCategoryId.get(child.id) ?? 0,
        children: [] as ProductCategoryFacetDto[],
      }))
      .filter((child) => child.productCount > 0);

    const ownCount = countByCategoryId.get(root.id) ?? 0;
    const totalCount = ownCount + children.reduce((sum, child) => sum + child.productCount, 0);
    if (totalCount === 0) continue;

    facets.push({ id: root.id, name: root.name, slug: root.slug, productCount: totalCount, children });
  }

  return facets;
}

/** §3.4 madde 2 — fiyat aralığı facet'i, fiyat filtresi ÇIKARILMIŞ küme üzerinde. */
async function computePriceFacet(
  app: FastifyInstance,
  where: Prisma.ProductWhereInput
): Promise<{ minCents: number | null; maxCents: number | null }> {
  const result = await app.prisma.product.aggregate({
    where,
    _min: { effectivePriceCents: true },
    _max: { effectivePriceCents: true },
  });
  return { minCents: result._min.effectivePriceCents ?? null, maxCents: result._max.effectivePriceCents ?? null };
}

interface OptionFacetAccumulatorValue {
  value: string;
  swatchHex: string | null;
  productIds: Set<string>;
}

interface OptionFacetAccumulator {
  type: "SWATCH" | "TEXT";
  axisNameCounts: Map<string, number>;
  values: Map<string, OptionFacetAccumulatorValue>;
  productIds: Set<string>;
}

/**
 * §3.4 madde 3 — varyasyon (option) facet'i, `option` filtresi ÇIKARILMIŞ küme üzerinde.
 * Sunucu tavanı `PRODUCT_FACET_SCAN_LIMIT` ürünü AŞARSA `truncated: true` döner (kategori/fiyat/
 * stok facet'leri SQL toplama olduğu için bundan ETKİLENMEZ).
 */
async function computeOptionsFacet(
  app: FastifyInstance,
  where: Prisma.ProductWhereInput
): Promise<{ options: ProductOptionFacetDto[]; truncated: boolean }> {
  const scanLimit = env.PRODUCT_FACET_SCAN_LIMIT;

  const rows = await app.prisma.product.findMany({
    where,
    select: {
      id: true,
      variantOptions: true,
      variants: { where: { isActive: true }, select: { optionValueSlugs: true } },
    },
    take: scanLimit + 1,
  });

  const truncated = rows.length > scanLimit;
  const scannedRows = truncated ? rows.slice(0, scanLimit) : rows;

  const accumulatorByAxisSlug = new Map<string, OptionFacetAccumulator>();

  for (const row of scannedRows) {
    const axes = (row.variantOptions as ProductVariantOption[] | null) ?? [];
    // token -> eksen/değer/tip meta'sı (bu ürüne özgü, `deriveVariantKey` ile AYNI türetim).
    const tokenMeta = new Map<string, { axisSlug: string; axisName: string; type: "SWATCH" | "TEXT"; value: string; swatchHex: string | null }>();
    for (const axis of axes) {
      const axisSlug = slugify(axis.name);
      for (const value of axis.values) {
        const token = `${axisSlug}:${slugify(value.value)}`;
        tokenMeta.set(token, { axisSlug, axisName: axis.name, type: axis.type, value: value.value, swatchHex: value.swatchHex ?? null });
      }
    }
    if (tokenMeta.size === 0) continue;

    // Bu ürünün AKTİF varyasyonlarındaki BENZERSİZ token'lar — bir üründe aynı token birden
    // çok varyasyonda tekrar etse (mümkün değil ama savunmacı) dahi TEK sayılır (§3.4 "ürün
    // sayısı" semantiği — token BAŞINA sayaç, varyasyon BAŞINA değil).
    const productTokens = new Set<string>();
    for (const variant of row.variants) {
      for (const token of variant.optionValueSlugs) productTokens.add(token);
    }

    for (const token of productTokens) {
      const meta = tokenMeta.get(token);
      if (!meta) continue; // savunma derinliği — üründe tanımsız bir eksen/değer.

      let acc = accumulatorByAxisSlug.get(meta.axisSlug);
      if (!acc) {
        acc = { type: meta.type, axisNameCounts: new Map(), values: new Map(), productIds: new Set() };
        accumulatorByAxisSlug.set(meta.axisSlug, acc);
      }
      acc.axisNameCounts.set(meta.axisName, (acc.axisNameCounts.get(meta.axisName) ?? 0) + 1);
      acc.productIds.add(row.id);

      let valueAcc = acc.values.get(token);
      if (!valueAcc) {
        valueAcc = { value: meta.value, swatchHex: meta.swatchHex, productIds: new Set() };
        acc.values.set(token, valueAcc);
      }
      valueAcc.productIds.add(row.id);
    }
  }

  const options: ProductOptionFacetDto[] = Array.from(accumulatorByAxisSlug.entries())
    .map(([axisSlug, acc]) => {
      // EN SIK kullanılan yazım (bkz. ProductOptionFacet.axisName notu).
      const axisName = Array.from(acc.axisNameCounts.entries()).sort((a, b) => b[1] - a[1])[0]![0];
      const values = Array.from(acc.values.entries())
        .map(([token, valueAcc]) => ({ token, value: valueAcc.value, swatchHex: valueAcc.swatchHex, count: valueAcc.productIds.size }))
        .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
      return { axisSlug, axisName, type: acc.type, values, __frequency: acc.productIds.size };
    })
    // Eksen sırası: görülme sıklığına göre azalan; eşitlikte axisSlug alfabetik (§3.4).
    .sort((a, b) => b.__frequency - a.__frequency || a.axisSlug.localeCompare(b.axisSlug))
    .map(({ __frequency: _frequency, ...rest }) => rest);

  return { options, truncated };
}

/** §3.4 madde 4 — stok durumu facet'i: iki `count` (`inStock` uygulanmış / uygulanmamış). */
async function computeAvailabilityFacet(
  app: FastifyInstance,
  where: Prisma.ProductWhereInput
): Promise<{ inStockCount: number; totalCount: number }> {
  const [inStockCount, totalCount] = await Promise.all([
    app.prisma.product.count({ where: { AND: [where, buildInStockWhere()] } }),
    app.prisma.product.count({ where }),
  ]);
  return { inStockCount, totalCount };
}

/**
 * Dört bağımsız facet sorgusu, TEK `Promise.all` içinde (§3.4, bağlayıcı — sıralı `await`
 * zinciri YASAK). Her boyut, KENDİ filtresi kaldırılmış küme üzerinde hesaplanır (disjunctive
 * faceting).
 */
async function computeCatalogFacets(app: FastifyInstance, state: CatalogFilterState): Promise<ProductCatalogFacetsDto> {
  const [categories, price, optionsResult, availability] = await Promise.all([
    computeCategoryFacet(app, buildCatalogWhere(excludeDimension(state, "category"))),
    computePriceFacet(app, buildCatalogWhere(excludeDimension(state, "price"))),
    computeOptionsFacet(app, buildCatalogWhere(excludeDimension(state, "options"))),
    computeAvailabilityFacet(app, buildCatalogWhere(excludeDimension(state, "availability"))),
  ]);

  return {
    categories,
    price,
    options: optionsResult.options,
    availability,
    ...(optionsResult.truncated ? { truncated: true } : {}),
  };
}

export type CatalogProductRow = Prisma.ProductGetPayload<{ include: typeof CATALOG_LIST_RELATIONS }>;

export interface CatalogQueryResult {
  rows: CatalogProductRow[];
  total: number;
  facets?: ProductCatalogFacetsDto;
}

/**
 * `GET /products` ana sorgu inşacısı — `where`/`orderBy`/sayfalama/facet'i birleştirir. Route
 * handler yalnızca bunu çağırır; §3.4 gereği facet hesabı yalnızca `withFacets: true` iken
 * (dört ek sorgu) çalışır.
 */
export async function queryCatalog(app: FastifyInstance, params: CatalogQueryParams): Promise<CatalogQueryResult> {
  const categoryIds = await resolveCategoryIds(app, params.category);
  const state: CatalogFilterState = {
    search: params.search,
    categoryIds,
    minPrice: params.minPrice,
    maxPrice: params.maxPrice,
    optionTokens: params.option,
    inStock: params.inStock,
  };

  const where = buildCatalogWhere(state);
  const orderBy = buildCatalogOrderBy(params.sort);
  const skip = (params.page - 1) * params.perPage;

  const [rows, total, facets] = await Promise.all([
    app.prisma.product.findMany({ where, orderBy, skip, take: params.perPage, include: CATALOG_LIST_RELATIONS }),
    app.prisma.product.count({ where }),
    params.withFacets ? computeCatalogFacets(app, state) : Promise.resolve(undefined),
  ]);

  return { rows, total, facets };
}
