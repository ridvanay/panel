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

/**
 * `useContentList` (bkz. components/admin/content-list/use-content-list.ts), blog/pages'teki
 * gibi TEK bir `POST .../bulk` ucu bekler — portföy modülünde bu fazda böyle bir uç YOK
 * (bkz. backend/src/modules/portfolio/portfolio.routes.ts, görev notu "Backend'e DOKUNMA").
 * `bulkProductsAction` ile BİREBİR aynı desen: mevcut TEKİL uçları paralel çağırarak
 * `BulkContentActionResult` sözleşmesini istemci tarafında üretiyoruz.
 */
export async function bulkPortfolioItemsAction(ids: string[], action: BulkContentAction): Promise<BulkContentActionResult> {
  const results = await Promise.allSettled(
    ids.map((id) => {
      switch (action) {
        case "trash":
          return deletePortfolioItem(id);
        case "restore":
          return restorePortfolioItem(id);
        case "publish":
          return updatePortfolioItem(id, { status: "PUBLISHED" });
        case "draft":
          return updatePortfolioItem(id, { status: "DRAFT" });
        case "permanent-delete":
          return permanentDeletePortfolioItem(id);
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
