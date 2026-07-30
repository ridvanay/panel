import { API_BASE_URL } from "../env";
import { ApiClientError } from "./error";
import { clearAccessToken, getAccessToken, setAccessToken } from "./token-store";
import type { ApiErrorBody, AuthTokens, Page } from "./types";

type Method = "GET" | "POST" | "PATCH" | "DELETE";

interface RequestOptions {
  method?: Method;
  body?: unknown;
  query?: Record<string, string | number | undefined>;
  /** /auth/* uçlarının kendisi için true: 401'de sonsuz refresh döngüsünü engeller. */
  skipAuthRetry?: boolean;
}

function buildUrl(path: string, query?: RequestOptions["query"]): string {
  const url = new URL(`${API_BASE_URL}${path}`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

function networkError(): ApiClientError {
  return new ApiClientError(0, {
    code: "NETWORK_ERROR",
    message: "Sunucuya ulaşılamadı. İnternet bağlantınızı kontrol edip tekrar deneyin.",
  });
}

let refreshPromise: Promise<string | null> | null = null;

/** Paralel isteklerin aynı anda 401 alması durumunda tek bir refresh çağrısını paylaşır. */
async function refreshAccessToken(): Promise<string | null> {
  if (!refreshPromise) {
    refreshPromise = (async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/auth/refresh`, {
          method: "POST",
          credentials: "include",
        });
        if (!res.ok) {
          clearAccessToken();
          return null;
        }
        const json = (await res.json()) as { data: AuthTokens };
        setAccessToken(json.data.accessToken);
        return json.data.accessToken;
      } catch {
        clearAccessToken();
        return null;
      } finally {
        refreshPromise = null;
      }
    })();
  }
  return refreshPromise;
}

async function doFetch(path: string, options: RequestOptions): Promise<Response> {
  const headers: Record<string, string> = {};
  const token = getAccessToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const isFormData = options.body instanceof FormData;
  // FormData için Content-Type'ı bilerek set etmiyoruz — tarayıcı sınırı (boundary) kendisi ekler.
  if (options.body !== undefined && !isFormData) headers["Content-Type"] = "application/json";

  try {
    return await fetch(buildUrl(path, options.query), {
      method: options.method ?? "GET",
      headers,
      credentials: "include",
      body: options.body === undefined ? undefined : isFormData ? (options.body as FormData) : JSON.stringify(options.body),
    });
  } catch {
    throw networkError();
  }
}

interface ParsedResponse {
  status: number;
  body: { data?: unknown; meta?: { nextCursor: string | null } } | null;
}

async function request(path: string, options: RequestOptions): Promise<ParsedResponse> {
  let res = await doFetch(path, options);

  if (res.status === 401 && !options.skipAuthRetry) {
    const newToken = await refreshAccessToken();
    if (newToken) {
      res = await doFetch(path, options);
    }
  }

  if (res.status === 204) {
    return { status: res.status, body: null };
  }

  const body = await res.json().catch(() => null);

  if (!res.ok) {
    const errorBody = (body as ApiErrorBody | null)?.error ?? {
      code: "INTERNAL_ERROR" as const,
      message: "Beklenmeyen bir sunucu hatası oluştu.",
    };
    throw new ApiClientError(res.status, errorBody);
  }

  return { status: res.status, body };
}

/** Tekil kaynak / komut uçları için: `data` zarfını açıp döner, 204'te `undefined`. */
export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { status, body } = await request(path, options);
  if (status === 204) return undefined as T;
  return body?.data as T;
}

/** Cursor sayfalı liste uçları için: hem öğeleri hem `meta.nextCursor`'ı döner. */
export async function apiFetchPage<T>(path: string, options: RequestOptions = {}): Promise<Page<T>> {
  const { body } = await request(path, options);
  return {
    items: (body?.data as T[]) ?? [],
    meta: body?.meta ?? { nextCursor: null },
  };
}
