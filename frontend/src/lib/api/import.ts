import { apiFetch, apiFetchPage } from "./client";
import type {
  ImportJob,
  ImportJobError,
  ImportJobStatus,
  ImportJobSummary,
  ImportJobType,
  Page,
  StartImportJobRequest,
} from "./types";

export interface ListImportJobsParams {
  cursor?: string;
  limit?: number;
  type?: ImportJobType;
  status?: ImportJobStatus;
}

/** `GET /admin/import/jobs` — cursor sayfalı, `seq DESC` (en yeni önce). `preview` DÖNMEZ. */
export function listImportJobs(params: ListImportJobsParams = {}): Promise<Page<ImportJobSummary>> {
  return apiFetchPage<ImportJobSummary>("/admin/import/jobs", {
    query: { cursor: params.cursor, limit: params.limit, type: params.type, status: params.status },
  });
}

/**
 * `POST /admin/import/jobs` — 1. ADIM: dosya yükle, ÖNİZLEME üret. Hiçbir Page/BlogPost/
 * User/Media kaydı OLUŞTURMAZ; `status: PENDING` bir iş döner.
 */
export function createImportJob(file: File, type: ImportJobType): Promise<ImportJob> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("type", type);
  return apiFetch<ImportJob>("/admin/import/jobs", { method: "POST", body: formData });
}

/** `GET /admin/import/jobs/{jobId}` — POLL UCU. Frontend 2 sn'de bir çağırır. */
export function getImportJob(jobId: string): Promise<ImportJob> {
  return apiFetch<ImportJob>(`/admin/import/jobs/${jobId}`);
}

/**
 * `DELETE /admin/import/jobs/{jobId}` — geçmişten kaldırır. İçe aktarılmış içeriği GERİ
 * ALMAZ. `status: PROCESSING` iken 409 döner.
 */
export function deleteImportJob(jobId: string): Promise<void> {
  return apiFetch<void>(`/admin/import/jobs/${jobId}`, { method: "DELETE" });
}

/** `POST /admin/import/jobs/{jobId}/start` — 2. ADIM: onayla, arka planda başlat. 202 ile HEMEN döner. */
export function startImportJob(jobId: string, input?: StartImportJobRequest): Promise<ImportJob> {
  return apiFetch<ImportJob>(`/admin/import/jobs/${jobId}/start`, { method: "POST", body: input });
}

/** `POST /admin/import/jobs/{jobId}/cancel` — işbirlikçi iptal; yanıt anında `status` hâlâ `PROCESSING` olabilir. */
export function cancelImportJob(jobId: string): Promise<ImportJob> {
  return apiFetch<ImportJob>(`/admin/import/jobs/${jobId}/cancel`, { method: "POST" });
}

export interface ListImportJobErrorsParams {
  cursor?: string;
  limit?: number;
}

/**
 * `GET /admin/import/jobs/{jobId}/errors` — satır-bazlı hata/atlama kayıtları, `seq ASC`
 * (dosyadaki sırayla). `meta.truncated: true` ise iş başına 1.000 satırlık tavan aşılmıştır.
 */
export function listImportJobErrors(jobId: string, params: ListImportJobErrorsParams = {}): Promise<Page<ImportJobError>> {
  return apiFetchPage<ImportJobError>(`/admin/import/jobs/${jobId}/errors`, {
    query: { cursor: params.cursor, limit: params.limit },
  });
}
