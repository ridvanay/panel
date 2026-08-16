import { apiFetch, apiFetchPage } from "./client";
import type { ApiKey, ApiKeyStatus, CreateApiKeyRequest, CreateApiKeyResponse, Page, UpdateApiKeyRequest } from "./types";

export interface ListApiKeysParams {
  cursor?: string;
  limit?: number;
  status?: ApiKeyStatus;
}

/**
 * `GET /admin/settings/api-keys` — cursor sayfalı (`seq desc`). ARCHITECTURE.md §10.13.10:
 * YALNIZCA `SiteRole=ADMIN` (okuma DAHİL). `plainKey` bu ucun yanıtında ASLA dönmez.
 */
export function listApiKeys(params: ListApiKeysParams = {}): Promise<Page<ApiKey>> {
  return apiFetchPage<ApiKey>("/admin/settings/api-keys", {
    query: { cursor: params.cursor, limit: params.limit, status: params.status },
  });
}

/**
 * `POST /admin/settings/api-keys` — **`plainKey` yalnızca bu yanıtta, bir kez döner**
 * (§10.13.3). İstemci bu değeri kalıcı state'e/localStorage'a YAZMAZ.
 */
export function createApiKey(input: CreateApiKeyRequest): Promise<CreateApiKeyResponse> {
  return apiFetch<CreateApiKeyResponse>("/admin/settings/api-keys", { method: "POST", body: input });
}

/** `name`/`description`/`scope`/`expiresAt` günceller — anahtarın KENDİSİ değiştirilemez. */
export function updateApiKey(keyId: string, input: UpdateApiKeyRequest): Promise<ApiKey> {
  return apiFetch<ApiKey>(`/admin/settings/api-keys/${keyId}`, { method: "PATCH", body: input });
}

/** Soft iptal — `status: REVOKED`, kayıt kalır (denetim izi). Zaten `REVOKED` ise backend `409` döner. */
export function revokeApiKey(keyId: string): Promise<ApiKey> {
  return apiFetch<ApiKey>(`/admin/settings/api-keys/${keyId}/revoke`, { method: "POST" });
}

/** Kalıcı silme — `204`. */
export function deleteApiKey(keyId: string): Promise<void> {
  return apiFetch<void>(`/admin/settings/api-keys/${keyId}`, { method: "DELETE" });
}
