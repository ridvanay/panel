import { apiFetch, apiFetchPage } from "./client";
import type {
  AddPortfolioImageRequest,
  BulkContentAction,
  BulkContentActionResult,
  CreatePortfolioCategoryRequest,
  CreatePortfolioItemRequest,
  Page,
  PortfolioCategory,
  PortfolioItem,
  TrashedFilter,
  UpdatePortfolioCategoryRequest,
  UpdatePortfolioItemRequest,
} from "./types";

export interface ListPortfolioItemsParams {
  cursor?: string;
  /** Varsayılan: "exclude" (backend varsayılanı). */
  trashed?: TrashedFilter;
  limit?: number;
  /** Başlık/müşteri adı üzerinde serbest metin arama — backend `ListPortfolioItemsQuerySchema.search`. */
  search?: string;
}

export function listPortfolioItems(params: ListPortfolioItemsParams = {}): Promise<Page<PortfolioItem>> {
  return apiFetchPage<PortfolioItem>("/admin/portfolio", {
    query: { cursor: params.cursor, limit: params.limit ?? 100, trashed: params.trashed, search: params.search },
  });
}

export function createPortfolioItem(input: CreatePortfolioItemRequest) {
  return apiFetch<PortfolioItem>("/admin/portfolio", { method: "POST", body: input });
}

export function getPortfolioItem(itemId: string) {
  return apiFetch<PortfolioItem>(`/admin/portfolio/${itemId}`);
}

export function updatePortfolioItem(itemId: string, input: UpdatePortfolioItemRequest) {
  return apiFetch<PortfolioItem>(`/admin/portfolio/${itemId}`, { method: "PATCH", body: input });
}

/** Soft-delete: `deletedAt = now()` set eder (çöpe taşır), idempotenttir. */
export function deletePortfolioItem(itemId: string) {
  return apiFetch<void>(`/admin/portfolio/${itemId}`, { method: "DELETE" });
}

/** Çöpteki öğeyi geri yükler (`deletedAt = null`); status değişmez. */
export function restorePortfolioItem(itemId: string) {
  return apiFetch<PortfolioItem>(`/admin/portfolio/${itemId}/restore`, { method: "POST" });
}

/** Kalıcı silme — yalnızca ADMIN, kayıt önce çöpte olmalıdır. */
export function permanentDeletePortfolioItem(itemId: string) {
  return apiFetch<void>(`/admin/portfolio/${itemId}/permanent`, { method: "DELETE" });
}

/** `POST /admin/portfolio/:portfolioItemId/images` — güncellenmiş `PortfolioItem` DTO'sunu (`images` dahil) döner. */
export function addPortfolioImage(itemId: string, mediaId: string) {
  return apiFetch<PortfolioItem>(`/admin/portfolio/${itemId}/images`, {
    method: "POST",
    body: { mediaId } satisfies AddPortfolioImageRequest,
  });
}

/** `DELETE /admin/portfolio/:portfolioItemId/images/:imageId` — güncellenmiş `PortfolioItem` DTO'sunu döner. */
export function removePortfolioImage(itemId: string, imageId: string) {
  return apiFetch<PortfolioItem>(`/admin/portfolio/${itemId}/images/${imageId}`, { method: "DELETE" });
}

export function listPortfolioCategories() {
  return apiFetch<PortfolioCategory[]>("/admin/portfolio/categories");
}

export function createPortfolioCategory(input: CreatePortfolioCategoryRequest) {
  return apiFetch<PortfolioCategory>("/admin/portfolio/categories", { method: "POST", body: input });
}

export function updatePortfolioCategory(categoryId: string, input: UpdatePortfolioCategoryRequest) {
  return apiFetch<PortfolioCategory>(`/admin/portfolio/categories/${categoryId}`, { method: "PATCH", body: input });
}

export function deletePortfolioCategory(categoryId: string) {
  return apiFetch<void>(`/admin/portfolio/categories/${categoryId}`, { method: "DELETE" });
}

/** `POST /admin/portfolio/bulk` — `bulkProductsAction` ile BİREBİR AYNI sözleşme. */
export function bulkPortfolioItemsAction(ids: string[], action: BulkContentAction) {
  return apiFetch<BulkContentActionResult>("/admin/portfolio/bulk", {
    method: "POST",
    body: { ids, action },
  });
}

/**
 * Sessiz crash/kapatma-kurtarma güvenlik ağı — revizyon/audit ÜRETMEZ, "Kaydet" butonunun
 * YERİNİ ALMAZ (bkz. `use-autosave.ts` ve `admin/portfolio/[itemId]/page.tsx`). Gövde
 * `UpdatePortfolioItemRequest`'in DAR bir alt kümesidir — yalnızca `title`/`summary`/`contentHtml`.
 */
export function autosavePortfolioItem(itemId: string, body: { title?: string; summary?: string | null; contentHtml?: string }) {
  return apiFetch<{ savedAt: string }>(`/admin/portfolio/${itemId}/autosave`, { method: "POST", body });
}
