import { apiFetch, apiFetchPage } from "./client";
import type { Media, Page } from "./types";

export function uploadMedia(file: File): Promise<Media> {
  const formData = new FormData();
  formData.append("file", file);
  return apiFetch<Media>("/admin/media", { method: "POST", body: formData });
}

export function listMedia(cursor?: string): Promise<Page<Media>> {
  return apiFetchPage<Media>("/admin/media", { query: { cursor, limit: 100 } });
}

export function deleteMedia(mediaId: string) {
  return apiFetch<void>(`/admin/media/${mediaId}`, { method: "DELETE" });
}

/** Boş string backend'de 422 döner (`altText` boş bırakılamaz) — çağıran taraf önceden doğrulamalı. */
export function updateMediaAltText(mediaId: string, altText: string): Promise<Media> {
  return apiFetch<Media>(`/admin/media/${mediaId}`, { method: "PATCH", body: { altText } });
}
