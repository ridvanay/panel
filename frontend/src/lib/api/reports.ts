import { API_BASE_URL } from "../env";
import { apiFetch, apiFetchPage } from "./client";
import { ApiClientError } from "./error";
import { getAccessToken } from "./token-store";
import type {
  ApiErrorBody,
  CreateExportJobRequest,
  ExportFileFormat,
  ExportJob,
  ExportJobStatus,
  ExportJobType,
  Page,
} from "./types";

export interface ListExportJobsParams {
  cursor?: string;
  limit?: number;
  type?: ExportJobType;
  status?: ExportJobStatus;
}

/** `GET /admin/reports/exports` — cursor sayfalı (`seq DESC`, en yeni önce). YALNIZCA ADMIN. */
export function listExportJobs(params: ListExportJobsParams = {}): Promise<Page<ExportJob>> {
  return apiFetchPage<ExportJob>("/admin/reports/exports", {
    query: { cursor: params.cursor, limit: params.limit, type: params.type, status: params.status },
  });
}

/**
 * `POST /admin/reports/exports` — YALNIZCA ADMIN. 202 + `PENDING` durumunda bir iş döner (worker
 * arka planda üretir). Rate limit 10/10dk — aşımda backend 429 (`RATE_LIMITED`) döner.
 */
export function createExportJob(input: CreateExportJobRequest): Promise<ExportJob> {
  return apiFetch<ExportJob>("/admin/reports/exports", { method: "POST", body: input });
}

/** `GET /admin/reports/exports/{jobId}` — poll ucu. YALNIZCA ADMIN. */
export function getExportJob(jobId: string): Promise<ExportJob> {
  return apiFetch<ExportJob>(`/admin/reports/exports/${jobId}`);
}

function extensionFor(format: ExportFileFormat): string {
  return format === "CSV" ? "csv" : "pdf";
}

/**
 * `GET /admin/reports/exports/{jobId}/download` — yanıt JSON DEĞİL, dosya STREAM eder; bu yüzden
 * `apiFetch` KULLANILMAZ. Ham `fetch` ile `Authorization` header'ı elle eklenir, `blob()` alınıp
 * `URL.createObjectURL` + geçici `<a download>` ile indirilir. Yalnızca `COMPLETED` + süresi
 * dolmamış işlerde 200 döner (aksi halde backend 404/409 — bkz. reports.routes.ts).
 */
export async function downloadExportJob(job: Pick<ExportJob, "id" | "type" | "format">): Promise<void> {
  const requestId = crypto.randomUUID();
  const token = getAccessToken();

  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}/admin/reports/exports/${job.id}/download`, {
      headers: {
        "x-request-id": requestId,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      credentials: "include",
    });
  } catch {
    throw new ApiClientError(
      0,
      { code: "NETWORK_ERROR", message: "Sunucuya ulaşılamadı. İnternet bağlantınızı kontrol edip tekrar deneyin." },
      requestId
    );
  }

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as ApiErrorBody | null;
    const errorBody = body?.error ?? { code: "INTERNAL_ERROR" as const, message: "Dosya indirilemedi." };
    throw new ApiClientError(res.status, errorBody, requestId);
  }

  const blob = await res.blob();
  // Backend `Content-Disposition`'da aynı adı kullanır (bkz. reports.routes.ts) — istemci
  // tarafında da BİREBİR aynı deseni üretiyoruz ki iki taraf hep tutarlı olsun.
  const filename = `export-${job.type.toLowerCase()}-${job.id}.${extensionFor(job.format)}`;
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
