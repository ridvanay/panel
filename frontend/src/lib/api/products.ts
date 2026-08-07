import { apiFetch, apiFetchPage } from "./client";
import type {
  AdjustProductStockRequest,
  BulkContentAction,
  BulkContentActionResult,
  CreateProductCategoryRequest,
  CreateProductRequest,
  Page,
  Product,
  ProductCategory,
  TrashedFilter,
  UpdateProductCategoryRequest,
  UpdateProductRequest,
} from "./types";

export interface ListProductsParams {
  cursor?: string;
  /** Varsayılan: "exclude" (backend varsayılanı). */
  trashed?: TrashedFilter;
  limit?: number;
  /** Başlık/SKU üzerinde serbest metin arama — backend `ListProductsQuerySchema.search`. */
  search?: string;
}

export function listProducts(params: ListProductsParams = {}): Promise<Page<Product>> {
  return apiFetchPage<Product>("/admin/products", {
    query: { cursor: params.cursor, limit: params.limit ?? 100, trashed: params.trashed, search: params.search },
  });
}

export function createProduct(input: CreateProductRequest) {
  return apiFetch<Product>("/admin/products", { method: "POST", body: input });
}

export function getProduct(productId: string) {
  return apiFetch<Product>(`/admin/products/${productId}`);
}

export function updateProduct(productId: string, input: UpdateProductRequest) {
  return apiFetch<Product>(`/admin/products/${productId}`, { method: "PATCH", body: input });
}

/** Soft-delete: `deletedAt = now()` set eder (çöpe taşır), idempotenttir. */
export function deleteProduct(productId: string) {
  return apiFetch<void>(`/admin/products/${productId}`, { method: "DELETE" });
}

/** Çöpteki ürünü geri yükler (`deletedAt = null`); status değişmez. */
export function restoreProduct(productId: string) {
  return apiFetch<Product>(`/admin/products/${productId}/restore`, { method: "POST" });
}

/** Kalıcı silme — yalnızca ADMIN, kayıt önce çöpte olmalıdır. */
export function permanentDeleteProduct(productId: string) {
  return apiFetch<void>(`/admin/products/${productId}/permanent`, { method: "DELETE" });
}

/** Admin'in ELLE stok düzeltmesi — bu fazın düzenleme formu `updateProduct` ile stok da güncelleyebilir; bu uç ayrı/hızlı stok düzeltme ekranları için saklıdır. */
export function updateProductStock(productId: string, input: AdjustProductStockRequest) {
  return apiFetch<Product>(`/admin/products/${productId}/stock`, { method: "PATCH", body: input });
}

export function listProductCategories() {
  return apiFetch<ProductCategory[]>("/admin/products/categories");
}

export function createProductCategory(input: CreateProductCategoryRequest) {
  return apiFetch<ProductCategory>("/admin/products/categories", { method: "POST", body: input });
}

export function updateProductCategory(categoryId: string, input: UpdateProductCategoryRequest) {
  return apiFetch<ProductCategory>(`/admin/products/categories/${categoryId}`, { method: "PATCH", body: input });
}

export function deleteProductCategory(categoryId: string) {
  return apiFetch<void>(`/admin/products/categories/${categoryId}`, { method: "DELETE" });
}

/**
 * `useContentList` (bkz. components/admin/content-list/use-content-list.ts), blog/pages'teki
 * gibi TEK bir `POST .../bulk` ucu bekler — ürünler modülünde bu fazda böyle bir uç YOK (bkz.
 * backend/src/modules/products/products.routes.ts, görev notu "Backend'e DOKUNMA"). Aynı
 * `BulkContentActionResult` sözleşmesini, halihazırda var olan TEKİL uçları paralel çağırarak
 * İSTEMCİ TARAFINDA üretiyoruz — ContentList altyapısı böylece blog/pages ile BİREBİR aynı
 * kalıyor ve backend'de hiçbir değişiklik gerekmiyor.
 */
export async function bulkProductsAction(ids: string[], action: BulkContentAction): Promise<BulkContentActionResult> {
  const results = await Promise.allSettled(
    ids.map((id) => {
      switch (action) {
        case "trash":
          return deleteProduct(id);
        case "restore":
          return restoreProduct(id);
        case "publish":
          return updateProduct(id, { status: "PUBLISHED" });
        case "draft":
          return updateProduct(id, { status: "DRAFT" });
        case "permanent-delete":
          return permanentDeleteProduct(id);
      }
    })
  );

  const skippedIds: string[] = [];
  let affectedCount = 0;
  results.forEach((result, index) => {
    if (result.status === "fulfilled") affectedCount += 1;
    else skippedIds.push(ids[index]);
  });

  return { action, requestedCount: ids.length, affectedCount, skippedIds };
}
