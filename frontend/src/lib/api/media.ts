import { apiFetch, apiFetchPage, apiFetchWithMeta } from "./client";
import { uploadWithProgress, type UploadOptions } from "./upload";
import type {
  CreateMediaFolderRequest,
  Media,
  MediaFolder,
  MediaTypeFilter,
  MoveMediaResult,
  Page,
  UpdateMediaFolderRequest,
} from "./types";

/** `POST /admin/media` `meta.notice` — ör. beyan edilen tür içerikle uyuşmadığında `TYPE_CORRECTED`. */
export interface MediaUploadNotice {
  /** `CONVERTED` | `TYPE_CORRECTED` — arayüz koda bakmaz, yalnızca `message` gösterilir. */
  code: string;
  message: string;
  detectedMimeType?: string;
}

/**
 * `purpose` — `"logo"`: saydam olmasa da PNG uyumluluk kopyası (e-posta logosu kullanır); `"icon"`: favicon /
 * apple-touch-icon, ana sürüm PNG kalır (WebP'ye çevrilmez). Verilmezse varsayılan davranış.
 */
export type MediaUploadPurpose = "logo" | "icon";

export interface UploadMediaOptions {
  purpose?: MediaUploadPurpose;
}

/**
 * `folderId` verilirse yükleme doğrudan o klasöre düşer (§10.11.4) — verilmezse "Kategorisiz".
 * `onNotice`, sunucu `meta.notice` döndürdüğünde (dosya türü düzeltildi vb.) çağrılır; dönüş tipi
 * (Media) değişmez, mevcut çağıranlar etkilenmez.
 */
export async function uploadMedia(
  file: File,
  folderId?: string | null,
  onNotice?: (notice: MediaUploadNotice) => void,
  options: UploadMediaOptions = {},
): Promise<Media> {
  const formData = new FormData();
  formData.append("file", file);
  if (folderId) formData.append("folderId", folderId);
  if (options.purpose) formData.append("purpose", options.purpose);
  const { data, meta } = await apiFetchWithMeta<Media>("/admin/media", { method: "POST", body: formData });
  const notice = (meta as { notice?: MediaUploadNotice } | undefined)?.notice;
  if (notice?.message && onNotice) onNotice(notice);
  return data;
}

/**
 * `folderId` §10.11 SUNUCU taraflı filtredir (tür/tarih/dosya adı filtrelerinin aksine) — `"none"`
 * = yalnızca "Kategorisiz", bir klasör UUID'si = yalnızca o klasördeki medya (özyinelemeli değil),
 * verilmezse filtre uygulanmaz (tüm kütüphane).
 */
/**
 * `type` — `.claude/architect-scope-ecommerce-pro-template.md` §2.2 madde 6: `MediaPicker`
 * görsel modunda PDF göstermez, döküman modunda yalnızca PDF gösterir. Verilmezse (mevcut
 * çağrı yerleri) filtre uygulanmaz — geriye dönük uyumluluk.
 */
export function listMedia(params?: { cursor?: string; folderId?: string; type?: MediaTypeFilter }): Promise<Page<Media>> {
  return apiFetchPage<Media>("/admin/media", {
    query: { cursor: params?.cursor, limit: 100, folderId: params?.folderId, type: params?.type },
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

// ---------------------------------------------------------------------------
// Paket AE — MP4 video ve .vtt altyazı yükleme (ilerleme çubuklu XHR).
// ---------------------------------------------------------------------------

export type VideoProcessingStatus = "processing" | "ready" | "failed";

/** `POST /admin/media/video` yanıtındaki `processing` — video kuyrukta H.264 MP4'e çevrilir. */
export interface VideoUploadProcessing {
  status: VideoProcessingStatus;
  queuePosition: number | null;
}

export type VideoWarningCode = "HEVC_CODEC" | "MOOV_AT_END";

export interface VideoUploadWarning {
  code: VideoWarningCode;
  message: string;
}

export interface VideoUploadInfo {
  codec: "avc1" | "hvc1" | "hev1" | "av01" | "vp09" | null;
  faststart: boolean;
  durationSec: number | null;
}

export interface VideoUploadResult {
  media: Media;
  video: VideoUploadInfo;
  warnings: VideoUploadWarning[];
  processing: VideoUploadProcessing | null;
}

/** `POST /admin/media/video` — MP4 ya da MOV (iPhone); `signal` ile iptal edilebilir. */
export async function uploadVideo(file: File, options: Pick<UploadOptions, "onProgress" | "signal"> = {}): Promise<VideoUploadResult> {
  const { data } = await uploadWithProgress<VideoUploadResult>("/admin/media/video", file, options);
  return { media: data.media, video: data.video, warnings: data.warnings ?? [], processing: data.processing ?? null };
}

// Paket AE-ek — video dönüştürme işleri.
export type TranscodeJobStatus = "queued" | "running" | "done" | "failed";

export interface TranscodeJob {
  id: string;
  mediaId: string;
  status: TranscodeJobStatus;
  sourceContainer: "mp4" | "mov";
  sourceSizeBytes: number | null;
  sourceCodec: string | null;
  sourceDurationSec: number | null;
  outputSizeBytes: number | null;
  attempts: number;
  error: string | null;
  canRetry: boolean;
  queuedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  sourceDeleteAfter: string | null;
  queuePosition: number | null;
}

/** `GET /admin/media/transcode-jobs` — bekleyen/çalışan/başarısız + son 7 günde biten işler. */
export function listTranscodeJobs(): Promise<TranscodeJob[]> {
  return apiFetch<TranscodeJob[]>("/admin/media/transcode-jobs");
}

/** `POST /admin/media/:mediaId/transcode/retry` — 409: orijinal silinmiş ya da iş başarısız değil. */
export function retryTranscode(mediaId: string): Promise<TranscodeJob> {
  return apiFetch<TranscodeJob>(`/admin/media/${encodeURIComponent(mediaId)}/transcode/retry`, { method: "POST" });
}

/** `POST /admin/media/captions` — `.vtt` (WEBVTT ile başlamalı, ≤ 512 KB). */
export async function uploadCaptions(file: File, options: Pick<UploadOptions, "onProgress" | "signal"> = {}): Promise<Media> {
  const { data } = await uploadWithProgress<Media>("/admin/media/captions", file, options);
  return data;
}
