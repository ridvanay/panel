import { apiFetch, apiFetchPage } from "./client";
import type { BlogPost, ContentRevision, ContentRevisionSummary, Page, PortfolioItem, Product, SitePage } from "./types";

export function listPageRevisions(pageId: string, cursor?: string): Promise<Page<ContentRevisionSummary>> {
  return apiFetchPage<ContentRevisionSummary>(`/admin/pages/${pageId}/revisions`, { query: { cursor, limit: 50 } });
}

export function getPageRevision(pageId: string, revisionId: string) {
  return apiFetch<ContentRevision>(`/admin/pages/${pageId}/revisions/${revisionId}`);
}

export function restorePageRevision(pageId: string, revisionId: string) {
  return apiFetch<SitePage>(`/admin/pages/${pageId}/revisions/${revisionId}/restore`, { method: "POST" });
}

export function listPostRevisions(postId: string, cursor?: string): Promise<Page<ContentRevisionSummary>> {
  return apiFetchPage<ContentRevisionSummary>(`/admin/blog/${postId}/revisions`, { query: { cursor, limit: 50 } });
}

export function getPostRevision(postId: string, revisionId: string) {
  return apiFetch<ContentRevision>(`/admin/blog/${postId}/revisions/${revisionId}`);
}

export function restorePostRevision(postId: string, revisionId: string) {
  return apiFetch<BlogPost>(`/admin/blog/${postId}/revisions/${revisionId}/restore`, { method: "POST" });
}

/**
 * `Product`/`PortfolioItem` artık revizyon uçlarında `Page`/`BlogPost` ile TAM PARİTEDİR
 * (bkz. ARCHITECTURE.md §10.1 — faz sınırı KALDIRILDI). Sözleşme birebir aynı.
 */
export function listProductRevisions(productId: string, cursor?: string): Promise<Page<ContentRevisionSummary>> {
  return apiFetchPage<ContentRevisionSummary>(`/admin/products/${productId}/revisions`, { query: { cursor, limit: 50 } });
}

export function getProductRevision(productId: string, revisionId: string) {
  return apiFetch<ContentRevision>(`/admin/products/${productId}/revisions/${revisionId}`);
}

export function restoreProductRevision(productId: string, revisionId: string) {
  return apiFetch<Product>(`/admin/products/${productId}/revisions/${revisionId}/restore`, { method: "POST" });
}

export function listPortfolioItemRevisions(itemId: string, cursor?: string): Promise<Page<ContentRevisionSummary>> {
  return apiFetchPage<ContentRevisionSummary>(`/admin/portfolio/${itemId}/revisions`, { query: { cursor, limit: 50 } });
}

export function getPortfolioItemRevision(itemId: string, revisionId: string) {
  return apiFetch<ContentRevision>(`/admin/portfolio/${itemId}/revisions/${revisionId}`);
}

export function restorePortfolioItemRevision(itemId: string, revisionId: string) {
  return apiFetch<PortfolioItem>(`/admin/portfolio/${itemId}/revisions/${revisionId}/restore`, { method: "POST" });
}
