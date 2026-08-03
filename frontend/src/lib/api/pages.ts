import { apiFetch, apiFetchPage } from "./client";
import type {
  BulkContentAction,
  BulkContentActionResult,
  CreateSitePageRequest,
  Page,
  SitePage,
  TrashedFilter,
  UpdateSitePageRequest,
} from "./types";

export interface ListPagesParams {
  cursor?: string;
  /** Varsayılan: "exclude" (backend varsayılanı). */
  trashed?: TrashedFilter;
  limit?: number;
}

export function listPages(params: ListPagesParams = {}): Promise<Page<SitePage>> {
  return apiFetchPage<SitePage>("/admin/pages", {
    query: { cursor: params.cursor, limit: params.limit ?? 100, trashed: params.trashed },
  });
}

export function createPage(input: CreateSitePageRequest) {
  return apiFetch<SitePage>("/admin/pages", { method: "POST", body: input });
}

export function getPage(pageId: string) {
  return apiFetch<SitePage>(`/admin/pages/${pageId}`);
}

export function updatePage(pageId: string, input: UpdateSitePageRequest) {
  return apiFetch<SitePage>(`/admin/pages/${pageId}`, { method: "PATCH", body: input });
}

/** Artık soft-delete: `deletedAt = now()` set eder (çöpe taşır), idempotenttir. */
export function deletePage(pageId: string) {
  return apiFetch<void>(`/admin/pages/${pageId}`, { method: "DELETE" });
}

/** Çöpteki sayfayı geri yükler (`deletedAt = null`); status değişmez. */
export function restorePage(pageId: string) {
  return apiFetch<SitePage>(`/admin/pages/${pageId}/restore`, { method: "POST" });
}

/** Kalıcı silme — yalnızca ADMIN, kayıt önce çöpte olmalıdır. */
export function permanentDeletePage(pageId: string) {
  return apiFetch<void>(`/admin/pages/${pageId}/permanent`, { method: "DELETE" });
}

export function bulkPagesAction(ids: string[], action: BulkContentAction) {
  return apiFetch<BulkContentActionResult>("/admin/pages/bulk", {
    method: "POST",
    body: { ids, action },
  });
}
