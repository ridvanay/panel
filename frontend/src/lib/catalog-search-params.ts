/**
 * `searchParams` ⇄ backend API sorgusu dönüşümünün TEK yeri — `.claude/architect-scope-products-catalog.md`
 * §5.4 "Her bileşenin kendi query birleştirme mantığını yazması YASAK". URL TEK durum
 * kaynağıdır: `products/page.tsx` (sunucu) burada `parseCatalogFilters` ile okur,
 * `components/site/catalog/*` (istemci) filtre değiştiğinde `buildCatalogHref` ile yeni URL'i
 * üretip `router.replace`/`router.push` çağırır — hiçbir bileşen `useSearchParams()` KULLANMAZ
 * (bkz. `[slug]/page.tsx`'in `?variant=` deseni, AYNI ilke).
 */

export const CATALOG_SORT_VALUES = ["newest", "price_asc", "price_desc", "bestselling", "discount"] as const;
export type CatalogSort = (typeof CATALOG_SORT_VALUES)[number];
export const DEFAULT_CATALOG_SORT: CatalogSort = "newest";

export const CATALOG_PER_PAGE_VALUES = [12, 24, 48] as const;
export type CatalogPerPage = (typeof CATALOG_PER_PAGE_VALUES)[number];
export const DEFAULT_CATALOG_PER_PAGE: CatalogPerPage = 12;

export const CATALOG_VIEW_VALUES = ["grid3", "grid4", "list"] as const;
export type CatalogView = (typeof CATALOG_VIEW_VALUES)[number];
export const DEFAULT_CATALOG_VIEW: CatalogView = "grid3";

/** `?option=<eksenSlug>:<değerSlug>` — backend `CatalogOption` deseniyle BİREBİR aynı regex. */
const OPTION_TOKEN_PATTERN = /^[a-z0-9-]+:[a-z0-9-]+$/;

export interface CatalogFilters {
  search: string;
  category: string | null;
  /** Kuruş — `null` = alt sınır YOK. */
  minPrice: number | null;
  /** Kuruş — `null` = üst sınır YOK. */
  maxPrice: number | null;
  options: string[];
  inStock: boolean;
  sort: CatalogSort;
  page: number;
  perPage: CatalogPerPage;
  view: CatalogView;
}

export const DEFAULT_CATALOG_FILTERS: CatalogFilters = {
  search: "",
  category: null,
  minPrice: null,
  maxPrice: null,
  options: [],
  inStock: false,
  sort: DEFAULT_CATALOG_SORT,
  page: 1,
  perPage: DEFAULT_CATALOG_PER_PAGE,
  view: DEFAULT_CATALOG_VIEW,
};

export type RawSearchParams = Record<string, string | string[] | undefined>;

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function allValues(value: string | string[] | undefined): string[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function parsePositiveInt(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.round(parsed);
}

/** Next.js `page.tsx`'in aldığı ham `searchParams`'ı tipli/doğrulanmış filtre durumuna çevirir. */
export function parseCatalogFilters(raw: RawSearchParams): CatalogFilters {
  const sortRaw = firstValue(raw.sort);
  const viewRaw = firstValue(raw.view);
  const pageRaw = Number(firstValue(raw.page));
  const perPageRaw = Number(firstValue(raw.perPage));
  const minPrice = parsePositiveInt(firstValue(raw.minPrice));
  const maxPrice = parsePositiveInt(firstValue(raw.maxPrice));

  return {
    search: firstValue(raw.search)?.trim() || "",
    category: firstValue(raw.category)?.trim() || null,
    // Kullanıcı elle URL'e `minPrice > maxPrice` yazarsa backend zaten 422 döner; burada
    // sessizce SIRALARIZ — çökme yerine en yakın geçerli aralığı göstermek daha iyi bir UX'tir.
    minPrice: minPrice !== null && maxPrice !== null && minPrice > maxPrice ? maxPrice : minPrice,
    maxPrice: minPrice !== null && maxPrice !== null && minPrice > maxPrice ? minPrice : maxPrice,
    options: allValues(raw.option).filter((token) => OPTION_TOKEN_PATTERN.test(token)),
    inStock: firstValue(raw.inStock) === "true",
    sort: (CATALOG_SORT_VALUES as readonly string[]).includes(sortRaw ?? "") ? (sortRaw as CatalogSort) : DEFAULT_CATALOG_SORT,
    page: Number.isFinite(pageRaw) && pageRaw >= 1 ? Math.floor(pageRaw) : 1,
    perPage: (CATALOG_PER_PAGE_VALUES as readonly number[]).includes(perPageRaw)
      ? (perPageRaw as CatalogPerPage)
      : DEFAULT_CATALOG_PER_PAGE,
    view: (CATALOG_VIEW_VALUES as readonly string[]).includes(viewRaw ?? "") ? (viewRaw as CatalogView) : DEFAULT_CATALOG_VIEW,
  };
}

export function hasActiveCatalogFilters(filters: CatalogFilters): boolean {
  return Boolean(
    filters.search || filters.category || filters.minPrice !== null || filters.maxPrice !== null || filters.options.length > 0 || filters.inStock
  );
}

/** Backend `GET /products` sorgu dizesi — kenar çubuğu her zaman facet ister. */
export function buildCatalogApiQuery(filters: CatalogFilters, locale?: string): string {
  const params = new URLSearchParams();
  params.set("page", String(filters.page));
  params.set("perPage", String(filters.perPage));
  if (filters.search) params.set("search", filters.search);
  if (filters.category) params.set("category", filters.category);
  if (filters.minPrice !== null) params.set("minPrice", String(filters.minPrice));
  if (filters.maxPrice !== null) params.set("maxPrice", String(filters.maxPrice));
  for (const token of filters.options) params.append("option", token);
  if (filters.inStock) params.set("inStock", "true");
  if (filters.sort !== DEFAULT_CATALOG_SORT) params.set("sort", filters.sort);
  params.set("facets", "true");
  if (locale) params.set("locale", locale);
  return params.toString();
}

/**
 * Yeni bir filtre/sıralama/görünüm durumunu URL sorgu dizesine çevirir. `resetPage: false`
 * VERİLMEDİKÇE sayfa 1'e sıfırlanır (architect §5.4 madde 2 — yalnızca sayfa numarası
 * değişiminde `resetPage: false` geçirilir). Varsayılan değerler URL'i KİRLETMEMEK için
 * hiç yazılmaz (`?sort=newest` yerine parametre TAMAMEN yok).
 */
export function buildCatalogSearchParams(
  current: CatalogFilters,
  updates: Partial<CatalogFilters>,
  options: { resetPage?: boolean } = {}
): URLSearchParams {
  const resetPage = options.resetPage ?? true;
  const next: CatalogFilters = { ...current, ...updates };
  if (resetPage && updates.page === undefined) next.page = 1;

  const params = new URLSearchParams();
  if (next.search) params.set("search", next.search);
  if (next.category) params.set("category", next.category);
  if (next.minPrice !== null) params.set("minPrice", String(next.minPrice));
  if (next.maxPrice !== null) params.set("maxPrice", String(next.maxPrice));
  for (const token of next.options) params.append("option", token);
  if (next.inStock) params.set("inStock", "true");
  if (next.sort !== DEFAULT_CATALOG_SORT) params.set("sort", next.sort);
  if (next.perPage !== DEFAULT_CATALOG_PER_PAGE) params.set("perPage", String(next.perPage));
  if (next.page > 1) params.set("page", String(next.page));
  if (next.view !== DEFAULT_CATALOG_VIEW) params.set("view", next.view);
  return params;
}

/** `buildCatalogSearchParams` + `pathname` — doğrudan `router.replace`/`href`'e verilebilir string. */
export function buildCatalogHref(
  pathname: string,
  current: CatalogFilters,
  updates: Partial<CatalogFilters>,
  options: { resetPage?: boolean } = {}
): string {
  const qs = buildCatalogSearchParams(current, updates, options).toString();
  return qs ? `${pathname}?${qs}` : pathname;
}

/** Bir `option` token'ını AÇ/KAPAT — `options` dizisinin yeni hâlini döner (ekleme/çıkarma). */
export function toggleCatalogOption(options: string[], token: string): string[] {
  return options.includes(token) ? options.filter((value) => value !== token) : [...options, token];
}

/**
 * "Filtreleri Temizle" — `catalog-sidebar.tsx` (masaüstü) ve `catalog-mobile-filters.tsx` (Sheet
 * footer) AYNI bu fonksiyonu çağırır (`.claude/design-notes-products-catalog.md` §1.6 "iki farklı
 * davranışlı 'temizle' YAZILMAZ" kuralı). Sıralama/görünüm KORUNUR — yalnızca filtreler temizlenir.
 */
export function buildClearAllHref(pathname: string, filters: CatalogFilters): string {
  return buildCatalogHref(pathname, filters, {
    search: "",
    category: null,
    minPrice: null,
    maxPrice: null,
    options: [],
    inStock: false,
  });
}
