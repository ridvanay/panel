import { apiFetch, apiFetchPage } from "./client";
import type { CreateMediaFolderRequest, Media, MediaFolder, MoveMediaResult, Page, UpdateMediaFolderRequest } from "./types";

/** `folderId` verilirse yükleme doğrudan o klasöre düşer (§10.11.4) — verilmezse "Kategorisiz". */
export function uploadMedia(file: File, folderId?: string | null): Promise<Media> {
  const formData = new FormData();
  formData.append("file", file);
  if (folderId) formData.append("folderId", folderId);
  return apiFetch<Media>("/admin/media", { method: "POST", body: formData });
}

/**
 * `folderId` §10.11 SUNUCU taraflı filtredir (tür/tarih/dosya adı filtrelerinin aksine) — `"none"`
 * = yalnızca "Kategorisiz", bir klasör UUID'si = yalnızca o klasördeki medya (özyinelemeli değil),
 * verilmezse filtre uygulanmaz (tüm kütüphane).
 */
export function listMedia(params?: { cursor?: string; folderId?: string }): Promise<Page<Media>> {
  return apiFetchPage<Media>("/admin/media", {
    query: { cursor: params?.cursor, limit: 100, folderId: params?.folderId },
  });
}

export function deleteMedia(mediaId: string) {
  return apiFetch<void>(`/admin/media/${mediaId}`, { method: "DELETE" });
}

/** Boş string backend'de 422 döner (`altText` boş bırakılamaz) — çağıran taraf önceden doğrulamalı. */
export function updateMediaAltText(mediaId: string, altText: string): Promise<Media> {
  return apiFetch<Media>(`/admin/media/${mediaId}`, { method: "PATCH", body: { altText } });
}

// ---------------------------------------------------------------------------
// §10.11 Medya Kütüphanesi — Klasör Sistemi. Admin medya sayfası VE `MediaPicker` AYNI uçları
// paylaşır (bkz. ARCHITECTURE.md §10.11.2, openapi.yaml `/admin/media/folders*`).
// ---------------------------------------------------------------------------

/** Sayfalanmaz, arama parametresi almaz — düz dizi, `(parentId NULLS FIRST, name ASC)` sıralı. */
export function listMediaFolders(): Promise<MediaFolder[]> {
  return apiFetch<MediaFolder[]>("/admin/media/folders");
}

export function createMediaFolder(input: CreateMediaFolderRequest): Promise<MediaFolder> {
  return apiFetch<MediaFolder>("/admin/media/folders", { method: "POST", body: input });
}

export function updateMediaFolder(folderId: string, input: UpdateMediaFolderRequest): Promise<MediaFolder> {
  return apiFetch<MediaFolder>(`/admin/media/folders/${folderId}`, { method: "PATCH", body: input });
}

export function deleteMediaFolder(folderId: string): Promise<void> {
  return apiFetch<void>(`/admin/media/folders/${folderId}`, { method: "DELETE" });
}

/** Tekil ve toplu taşıma TEK uç — tekil taşıma tek elemanlı `mediaIds` dizisidir (§10.11.4). */
export function moveMedia(mediaIds: string[], folderId: string | null): Promise<MoveMediaResult> {
  return apiFetch<MoveMediaResult>("/admin/media/move", { method: "POST", body: { mediaIds, folderId } });
}
