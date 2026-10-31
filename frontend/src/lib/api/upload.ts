import { API_BASE_URL } from "../env";
import { ApiClientError } from "./error";
import { refreshAccessToken } from "./client";
import { getAccessToken } from "./token-store";
import type { ApiErrorBody } from "./types";

export interface UploadProgress {
  loaded: number;
  total: number;
  percent: number;
}

export interface UploadOptions {
  /** Dosyanın yanında gönderilecek ek metin alanları (ör. `folderId`). */
  fields?: Record<string, string | null | undefined>;
  onProgress?: (progress: UploadProgress) => void;
  /** Abort edilirse XHR iptal edilir; istek `UPLOAD_ABORTED` kodlu ApiClientError ile reddedilir. */
  signal?: AbortSignal;
}

export interface UploadResult<T> {
  data: T;
  meta?: Record<string, unknown>;
}

export const UPLOAD_ABORTED = "UPLOAD_ABORTED";

function sendOnce<T>(path: string, file: File, options: UploadOptions, requestId: string): Promise<{ status: number; result?: UploadResult<T>; error?: ApiErrorBody["error"] }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_BASE_URL}${path}`);
    // apiFetch ile aynı: çerez (refresh) + Bearer access token + x-request-id.
    xhr.withCredentials = true;
    xhr.setRequestHeader("x-request-id", requestId);
    const token = getAccessToken();
    if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable || !options.onProgress) return;
      options.onProgress({ loaded: event.loaded, total: event.total, percent: Math.min(100, Math.round((event.loaded / event.total) * 100)) });
    };

    xhr.onload = () => {
      let body: (Partial<ApiErrorBody> & { data?: T; meta?: Record<string, unknown> }) | null = null;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        body = null;
      }
      if (xhr.status >= 200 && xhr.status < 300 && body && body.data !== undefined) {
        resolve({ status: xhr.status, result: { data: body.data, meta: body.meta } });
      } else {
        resolve({ status: xhr.status, error: body?.error ?? { code: "INTERNAL_ERROR", message: "Yükleme başarısız oldu." } });
      }
    };
    xhr.onerror = () => reject(new ApiClientError(0, { code: "NETWORK_ERROR", message: "Sunucuya ulaşılamadı. İnternet bağlantınızı kontrol edip tekrar deneyin." }));
    xhr.onabort = () => reject(new ApiClientError(0, { code: UPLOAD_ABORTED as never, message: "Yükleme iptal edildi." }));

    if (options.signal) {
      if (options.signal.aborted) {
        reject(new ApiClientError(0, { code: UPLOAD_ABORTED as never, message: "Yükleme iptal edildi." }));
        return;
      }
      options.signal.addEventListener("abort", () => xhr.abort(), { once: true });
    }

    const formData = new FormData();
    // Metin alanları dosyadan ÖNCE: sunucu akışla okurken alanlara erken ulaşır.
    for (const [key, value] of Object.entries(options.fields ?? {})) {
      if (value) formData.append(key, value);
    }
    formData.append("file", file);
    xhr.send(formData);
  });
}

/**
 * `XMLHttpRequest` ile multipart yükleme (fetch yükleme ilerlemesi vermez). Kimlik doğrulama
 * `apiFetch` ile aynıdır; 401'de bir kez refresh edip yeniden dener. `{ data, meta }` zarfını döner.
 */
export async function uploadWithProgress<T>(path: string, file: File, options: UploadOptions = {}): Promise<UploadResult<T>> {
  const requestId = crypto.randomUUID();
  let res = await sendOnce<T>(path, file, options, requestId);
  if (res.status === 401) {
    const newToken = await refreshAccessToken();
    if (newToken) res = await sendOnce<T>(path, file, options, requestId);
  }
  if (res.result) return res.result;
  throw new ApiClientError(res.status, res.error ?? { code: "INTERNAL_ERROR", message: "Yükleme başarısız oldu." }, requestId);
}

export function isUploadAborted(err: unknown): boolean {
  return err instanceof ApiClientError && (err.code as string) === UPLOAD_ABORTED;
}
