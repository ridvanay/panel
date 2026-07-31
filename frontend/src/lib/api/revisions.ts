import { apiFetch, apiFetchPage } from "./client";
import type { BlogPost, ContentRevision, ContentRevisionSummary, Page, SitePage } from "./types";

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
