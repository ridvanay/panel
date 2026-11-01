import { apiFetch, apiFetchPage } from "./client";
import type {
  BlogCategory,
  BlogPost,
  BlogTag,
  BulkContentAction,
  BulkContentActionResult,
  CreateBlogCategoryRequest,
  CreateBlogPostRequest,
  CreateBlogTagRequest,
  DoctorBlogReviewItem,
  Page,
  TrashedFilter,
  UpdateBlogCategoryRequest,
  UpdateBlogPostRequest,
  UpdateBlogTagRequest,
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

/** §10.14.3 — sayfalanmaz, arama parametresi almaz. `seq ASC` sırasında döner. */
export function listTags() {
  return apiFetch<BlogTag[]>("/admin/blog/tags");
}

/** Etiket yönetim ekranı VE editördeki satır-içi "yeni etiket" akışı aynı ucu kullanır. */
export function createTag(input: CreateBlogTagRequest) {
  return apiFetch<BlogTag>("/admin/blog/tags", { method: "POST", body: input });
}

export function updateTag(tagId: string, input: UpdateBlogTagRequest) {
  return apiFetch<BlogTag>(`/admin/blog/tags/${tagId}`, { method: "PATCH", body: input });
}

/** Yalnızca ADMIN. */
export function deleteTag(tagId: string) {
  return apiFetch<void>(`/admin/blog/tags/${tagId}`, { method: "DELETE" });
}

/**
 * Sessiz crash/kapatma-kurtarma güvenlik ağı — revizyon/audit ÜRETMEZ, "Kaydet" butonunun
 * YERİNİ ALMAZ (bkz. `use-autosave.ts` ve `admin/blog/[postId]/page.tsx`).
 */
export function autosavePost(
  postId: string,
  body: { title?: string; excerpt?: string | null; contentHtml?: string }
) {
  return apiFetch<{ savedAt: string }>(`/admin/blog/${postId}/autosave`, { method: "POST", body });
}

/** Paket Z1 — editörde okuma süresi önizlemesi (sunucudaki formülün aynısı). */
export function previewReadingTime(html: string) {
  return apiFetch<{ minutes: number }>("/admin/blog/reading-time", { method: "POST", body: { html } });
}

// ---- Paket Z1 — doktor paneli "Medical review" kuyruğu ----
export function listDoctorBlogReviews() {
  return apiFetch<DoctorBlogReviewItem[]>("/doctor/blog-reviews");
}

export function approveDoctorBlogReview(id: string) {
  return apiFetch<DoctorBlogReviewItem>(`/doctor/blog-reviews/${encodeURIComponent(id)}/approve`, { method: "POST" });
}

/** `note` 1..2000 karakter (backend zorunlu kılar; arayüz de gönderimden önce denetler). */
export function requestDoctorBlogChanges(id: string, note: string) {
  return apiFetch<DoctorBlogReviewItem>(`/doctor/blog-reviews/${encodeURIComponent(id)}/request-changes`, { method: "POST", body: { note } });
}
