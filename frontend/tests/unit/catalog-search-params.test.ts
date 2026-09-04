import { describe, expect, it } from "vitest";
import {
  DEFAULT_CATALOG_FILTERS,
  buildCatalogApiQuery,
  buildCatalogHref,
  buildCatalogSearchParams,
  buildClearAllHref,
  hasActiveCatalogFilters,
  parseCatalogFilters,
  toggleCatalogOption,
} from "@/lib/catalog-search-params";

/**
 * `.claude/architect-scope-products-catalog.md` §5.4 — bu modül `searchParams` ⇄ API query
 * dönüşümünün TEK yeridir; davranışı yanlış olursa TÜM filtre bileşenleri (sidebar/toolbar/
 * pagination) sessizce bozulur, bu yüzden saf fonksiyonlar burada izole test edilir.
 */
describe("parseCatalogFilters", () => {
  it("hiç parametre yokken varsayılan durumu döner", () => {
    expect(parseCatalogFilters({})).toEqual(DEFAULT_CATALOG_FILTERS);
  });

  it("geçersiz sort/perPage/view değerlerini SESSİZCE varsayılana düşürür (hata FIRLATMAZ)", () => {
    const filters = parseCatalogFilters({ sort: "not-a-sort", perPage: "999", view: "grid5" });
    expect(filters.sort).toBe("newest");
    expect(filters.perPage).toBe(12);
    expect(filters.view).toBe("grid3");
  });

  it("`option` desenine UYMAYAN token'ları filtreler (backend 422'ye düşürmeden önce istemcide temizler)", () => {
    const filters = parseCatalogFilters({ option: ["renk:antrasit", "GEÇERSİZ TOKEN", "beden:l"] });
    expect(filters.options).toEqual(["renk:antrasit", "beden:l"]);
  });

  it("tekil `option` string'i (dizi DEĞİL) de kabul eder", () => {
    const filters = parseCatalogFilters({ option: "renk:antrasit" });
    expect(filters.options).toEqual(["renk:antrasit"]);
  });

  it("minPrice > maxPrice ise SESSİZCE sıralar (çökme yerine en yakın geçerli aralık)", () => {
    const filters = parseCatalogFilters({ minPrice: "500", maxPrice: "100" });
    expect(filters.minPrice).toBe(100);
    expect(filters.maxPrice).toBe(500);
  });

  it("inStock yalnızca tam \"true\" string'inde true'dur", () => {
    expect(parseCatalogFilters({ inStock: "true" }).inStock).toBe(true);
    expect(parseCatalogFilters({ inStock: "1" }).inStock).toBe(false);
    expect(parseCatalogFilters({}).inStock).toBe(false);
  });

  it("page < 1 veya sayısal olmayan page 1'e düşer", () => {
    expect(parseCatalogFilters({ page: "0" }).page).toBe(1);
    expect(parseCatalogFilters({ page: "abc" }).page).toBe(1);
    expect(parseCatalogFilters({ page: "3" }).page).toBe(3);
  });
});

describe("hasActiveCatalogFilters", () => {
  it("hiçbir filtre aktif değilken false döner", () => {
    expect(hasActiveCatalogFilters(DEFAULT_CATALOG_FILTERS)).toBe(false);
  });

  it("yalnızca `sort`/`page`/`view` değişimi AKTİF filtre SAYILMAZ", () => {
    expect(hasActiveCatalogFilters({ ...DEFAULT_CATALOG_FILTERS, sort: "price_asc", page: 3, view: "list" })).toBe(false);
  });

  it("search/category/fiyat/option/inStock'tan HERHANGİ biri true'ya çevirir", () => {
    expect(hasActiveCatalogFilters({ ...DEFAULT_CATALOG_FILTERS, search: "masa" })).toBe(true);
    expect(hasActiveCatalogFilters({ ...DEFAULT_CATALOG_FILTERS, category: "mobilya" })).toBe(true);
    expect(hasActiveCatalogFilters({ ...DEFAULT_CATALOG_FILTERS, minPrice: 100 })).toBe(true);
    expect(hasActiveCatalogFilters({ ...DEFAULT_CATALOG_FILTERS, options: ["renk:antrasit"] })).toBe(true);
    expect(hasActiveCatalogFilters({ ...DEFAULT_CATALOG_FILTERS, inStock: true })).toBe(true);
  });
});

describe("buildCatalogSearchParams / buildCatalogHref", () => {
  it("bir filtre değişince page HER ZAMAN 1'e sıfırlanır (architect §5.4 madde 2)", () => {
    const current = { ...DEFAULT_CATALOG_FILTERS, page: 5 };
    const params = buildCatalogSearchParams(current, { category: "mobilya" });
    expect(params.get("page")).toBeNull(); // page=1 varsayılan olduğu için URL'e HİÇ yazılmaz
    expect(params.get("category")).toBe("mobilya");
  });

  it("`resetPage:false` ile sayfa numarası KORUNUR (pagination/görünüm değişimi)", () => {
    const current = { ...DEFAULT_CATALOG_FILTERS, page: 5 };
    const params = buildCatalogSearchParams(current, { view: "list" }, { resetPage: false });
    expect(params.get("page")).toBe("5");
    expect(params.get("view")).toBe("list");
  });

  it("sayfa numarası doğrudan güncellenince (`updates.page`) resetPage varsayılanına RAĞMEN korunur", () => {
    const current = { ...DEFAULT_CATALOG_FILTERS, page: 1 };
    const params = buildCatalogSearchParams(current, { page: 3 });
    expect(params.get("page")).toBe("3");
  });

  it("varsayılan değerler (sort=newest, perPage=12, view=grid3) URL'e HİÇ YAZILMAZ", () => {
    const params = buildCatalogSearchParams(DEFAULT_CATALOG_FILTERS, { search: "masa" });
    expect(params.toString()).toBe("search=masa");
  });

  it("buildCatalogHref boş sorguda YALNIZCA pathname döner (`?` son eki YOK)", () => {
    expect(buildCatalogHref("/products", DEFAULT_CATALOG_FILTERS, {})).toBe("/products");
  });

  it("çoklu `option` token'ı `&option=` olarak tekrarlanır (backend `style: form, explode: true` ile uyumlu)", () => {
    const href = buildCatalogHref("/products", DEFAULT_CATALOG_FILTERS, { options: ["renk:antrasit", "beden:l"] });
    expect(href).toBe("/products?option=renk%3Aantrasit&option=beden%3Al");
  });
});

describe("toggleCatalogOption", () => {
  it("mevcut olmayan token'ı EKLER", () => {
    expect(toggleCatalogOption([], "renk:antrasit")).toEqual(["renk:antrasit"]);
  });

  it("mevcut token'ı ÇIKARIR", () => {
    expect(toggleCatalogOption(["renk:antrasit", "beden:l"], "renk:antrasit")).toEqual(["beden:l"]);
  });
});

describe("buildClearAllHref", () => {
  it("yalnızca filtreleri temizler — sort/view/perPage KORUNUR", () => {
    const current = { ...DEFAULT_CATALOG_FILTERS, search: "masa", category: "mobilya", inStock: true, sort: "price_asc" as const, view: "list" as const };
    const href = buildClearAllHref("/products", current);
    expect(href).toBe("/products?sort=price_asc&view=list");
  });
});

describe("buildCatalogApiQuery", () => {
  it("her zaman `page`/`perPage`/`facets=true` içerir", () => {
    const query = buildCatalogApiQuery(DEFAULT_CATALOG_FILTERS);
    const params = new URLSearchParams(query);
    expect(params.get("page")).toBe("1");
    expect(params.get("perPage")).toBe("12");
    expect(params.get("facets")).toBe("true");
  });

  it("`locale` verilirse sorguya eklenir", () => {
    const query = buildCatalogApiQuery(DEFAULT_CATALOG_FILTERS, "en");
    expect(new URLSearchParams(query).get("locale")).toBe("en");
  });
});
