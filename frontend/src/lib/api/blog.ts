import { apiFetch, apiFetchPage } from "./client";
import type {
  BlogCategory,
  BlogPost,
  CreateBlogCategoryRequest,
  CreateBlogPostRequest,
  Page,
  UpdateBlogCategoryRequest,
  UpdateBlogPostRequest,
} from "./types";

export function listPosts(cursor?: string): Promise<Page<BlogPost>> {
  return apiFetchPage<BlogPost>("/admin/blog", { query: { cursor, limit: 100 } });
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

export function deletePost(postId: string) {
  return apiFetch<void>(`/admin/blog/${postId}`, { method: "DELETE" });
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
