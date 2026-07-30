import { apiFetch, apiFetchPage } from "./client";
import type { CreateSitePageRequest, Page, SitePage, UpdateSitePageRequest } from "./types";

export function listPages(cursor?: string): Promise<Page<SitePage>> {
  return apiFetchPage<SitePage>("/admin/pages", { query: { cursor, limit: 100 } });
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

export function deletePage(pageId: string) {
  return apiFetch<void>(`/admin/pages/${pageId}`, { method: "DELETE" });
}
