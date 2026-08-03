import { apiFetch, apiFetchPage } from "./client";
import type {
  BlogCategory,
  BlogPost,
  BulkContentAction,
  BulkContentActionResult,
  CreateBlogCategoryRequest,
  CreateBlogPostRequest,
  Page,
  TrashedFilter,
  UpdateBlogCategoryRequest,
  UpdateBlogPostRequest,
} from "./types";

export interface ListPostsParams {
  cursor?: string;
  /** Varsayılan: "exclude" (backend varsayılanı). */
  trashed?: TrashedFilter;
  limit?: number;
}

export function listPosts(params: ListPostsParams = {}): Promise<Page<BlogPost>> {
  return apiFetchPage<BlogPost>("/admin/blog", {
    query: { cursor: params.cursor, limit: params.limit ?? 100, trashed: params.trashed },
  });
}

export function createPost(input: CreateBlogPostRequest) {
  return apiFetch<BlogPost>("/admin/blog", { method: "POST", body: input });
}

export function getPost(postId: string) {
  return apiFetch<BlogPost>(`/admin/blog/${postId}`);
}

export function updatePost(postId: string, input: UpdateBlogPostRequest) {
  return apiFetch<BlogPost>(`/admin/blog/${postId}`, { method: "PATCH", body: input });
}

/** Artık soft-delete: `deletedAt = now()` set eder (çöpe taşır), idempotenttir. */
export function deletePost(postId: string) {
  return apiFetch<void>(`/admin/blog/${postId}`, { method: "DELETE" });
}

/** Çöpteki yazıyı geri yükler (`deletedAt = null`); status değişmez. */
export function restorePost(postId: string) {
  return apiFetch<BlogPost>(`/admin/blog/${postId}/restore`, { method: "POST" });
}

/** Kalıcı silme — yalnızca ADMIN, kayıt önce çöpte olmalıdır. */
export function permanentDeletePost(postId: string) {
  return apiFetch<void>(`/admin/blog/${postId}/permanent`, { method: "DELETE" });
}

export function bulkPostsAction(ids: string[], action: BulkContentAction) {
  return apiFetch<BulkContentActionResult>("/admin/blog/bulk", {
    method: "POST",
    body: { ids, action },
  });
}

export function listCategories() {
  return apiFetch<BlogCategory[]>("/admin/blog/categories");
}

export function createCategory(input: CreateBlogCategoryRequest) {
  return apiFetch<BlogCategory>("/admin/blog/categories", { method: "POST", body: input });
}

export function updateCategory(categoryId: string, input: UpdateBlogCategoryRequest) {
  return apiFetch<BlogCategory>(`/admin/blog/categories/${categoryId}`, { method: "PATCH", body: input });
}

export function deleteCategory(categoryId: string) {
  return apiFetch<void>(`/admin/blog/categories/${categoryId}`, { method: "DELETE" });
}
