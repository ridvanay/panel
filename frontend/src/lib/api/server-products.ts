import { toInternalMediaUrl } from "../env";
import { fetchServerJson } from "./server-fetch";
import { buildCatalogApiQuery, type CatalogFilters } from "../catalog-search-params";
import type { Product, ProductCatalogMeta, ProductListItem } from "./types";

/**
 * Sunucu bileşenlerinden çağrılır — bkz. server-blog.ts'teki apiFetch kullanılmama gerekçesi.
 * `GET /products`'ın `data`'sı artık `ProductListItem`dır (`.claude/architect-scope-products-catalog.md`
 * §3.2) — bu fonksiyonun İMZASI (parametreler + geri dönüş biçimi) KORUNDU, `sitemap.ts` ve
 * `featured-products-block.tsx` DEĞİŞMEDEN çalışmaya devam eder (ikisi de yalnızca
 * `ProductListItem`'ın kapsadığı alanları okur).
 */
export async function fetchProductsServer(locale?: string): Promise<ProductListItem[]> {
  const query = locale ? `&locale=${encodeURIComponent(locale)}` : "";
  const json = await fetchServerJson<{ data: ProductListItem[] }>(`/products?limit=50${query}`, { transformText: toInternalMediaUrl });
  return json?.data ?? [];
}

export interface ProductCatalogResult {
  items: ProductListItem[];
  meta: ProductCatalogMeta;
}

/**
 * Katalog sayfasının (`/products`) TEK veri kaynağı — filtre/sıralama/sayfalama/facet
 * `CatalogFilters`'tan `buildCatalogApiQuery` ile (TEK dönüşüm noktası) üretilir. Ağ hatası/
 * `!res.ok` durumunda `null` döner (boş `{items:[],...}` DEĞİL) — çağıran sayfa bunu "0 sonuç"
 * (geçerli, filtrelerle eşleşen ürün yok) ile "API'ye ulaşılamadı" (gerçek hata) durumlarını
 * KARIŞTIRMAMAK için ayırt eder ve ikincisinde `error.tsx` sınırına düşecek şekilde fırlatır.
 */
export async function fetchProductCatalogServer(filters: CatalogFilters, locale?: string): Promise<ProductCatalogResult | null> {
  const query = buildCatalogApiQuery(filters, locale);
  const json = await fetchServerJson<{ data: ProductListItem[]; meta: ProductCatalogMeta }>(`/products?${query}`, { transformText: toInternalMediaUrl });
  return json ? { items: json.data, meta: json.meta } : null;
}

export async function fetchProductBySlugServer(slug: string, locale?: string): Promise<Product | null> {
  const query = locale ? `?locale=${encodeURIComponent(locale)}` : "";
  const json = await fetchServerJson<{ data: Product }>(`/products/${slug}${query}`, { transformText: toInternalMediaUrl });
  return json?.data ?? null;
}
