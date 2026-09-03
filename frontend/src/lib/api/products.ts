import { apiFetch, apiFetchPage } from "./client";
import type {
  AddProductDocumentRequest,
  AddProductImageRequest,
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
  UpsertProductVariantRequest,
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

/** `POST /admin/products/:productId/images` — güncellenmiş `Product` DTO'sunu (`images` dahil) döner. */
export function addProductImage(productId: string, mediaId: string) {
  return apiFetch<Product>(`/admin/products/${productId}/images`, {
    method: "POST",
    body: { mediaId } satisfies AddProductImageRequest,
  });
}

/** `DELETE /admin/products/:productId/images/:imageId` — güncellenmiş `Product` DTO'sunu döner. */
export function removeProductImage(productId: string, imageId: string) {
  return apiFetch<Product>(`/admin/products/${productId}/images/${imageId}`, { method: "DELETE" });
}

/** `POST /admin/products/:productId/variants` — güncellenmiş `Product` DTO'sunu (`variants` dahil) döner. */
export function addProductVariant(productId: string, input: UpsertProductVariantRequest) {
  return apiFetch<Product>(`/admin/products/${productId}/variants`, { method: "POST", body: input });
}

/** `PATCH /admin/products/:productId/variants/:variantId` — `optionValues` BURADAN değiştirilemez. */
export function updateProductVariant(productId: string, variantId: string, input: UpsertProductVariantRequest) {
  return apiFetch<Product>(`/admin/products/${productId}/variants/${variantId}`, { method: "PATCH", body: input });
}

/** `DELETE /admin/products/:productId/variants/:variantId` — sepet satırları Cascade ile silinir. */
export function deleteProductVariant(productId: string, variantId: string) {
  return apiFetch<Product>(`/admin/products/${productId}/variants/${variantId}`, { method: "DELETE" });
}

/** `POST /admin/products/:productId/documents` — `mediaId` zaten ekliyse 409. */
export function addProductDocument(productId: string, input: AddProductDocumentRequest) {
  return apiFetch<Product>(`/admin/products/${productId}/documents`, { method: "POST", body: input });
}

/** `DELETE /admin/products/:productId/documents/:documentId` — yalnızca BAĞ kaldırılır, `Media` silinmez. */
export function removeProductDocument(productId: string, documentId: string) {
  return apiFetch<Product>(`/admin/products/${productId}/documents/${documentId}`, { method: "DELETE" });
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

/** `POST /admin/products/bulk` — `bulkPagesAction`/`bulkPostsAction` ile BİREBİR AYNI sözleşme. */
export function bulkProductsAction(ids: string[], action: BulkContentAction) {
  return apiFetch<BulkContentActionResult>("/admin/products/bulk", {
    method: "POST",
    body: { ids, action },
  });
}

/**
 * Sessiz crash/kapatma-kurtarma güvenlik ağı — revizyon/audit ÜRETMEZ, "Kaydet" butonunun
 * YERİNİ ALMAZ (bkz. `use-autosave.ts` ve `admin/products/[productId]/page.tsx`). Gövde
 * `UpdateProductRequest`'in DAR bir alt kümesidir — yalnızca `title`/`excerpt`/`descriptionHtml`.
 */
export function autosaveProduct(productId: string, body: { title?: string; excerpt?: string | null; descriptionHtml?: string }) {
  return apiFetch<{ savedAt: string }>(`/admin/products/${productId}/autosave`, { method: "POST", body });
}
