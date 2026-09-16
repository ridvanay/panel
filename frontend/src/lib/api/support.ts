import { apiFetch, apiFetchWithMeta } from "./client";
import type {
  AssignSupportSessionRequest,
  CreateSupportReplyTemplateRequest,
  CreateSupportSessionRequest,
  CreateSupportSessionResponse,
  SendSupportAgentMessageRequest,
  SendSupportMessageRequest,
  SupportAgentSummary,
  SupportChatMessage,
  SupportChatMessagePublic,
  SupportChatSession,
  SupportChatSessionSummary,
  SupportMessagesMeta,
  SupportReplyTemplate,
  SupportSessionsListMeta,
  SupportSessionStatus,
  UpdateSupportReplyTemplateRequest,
  UpdateSupportSessionRequest,
} from "./types";

/**
 * `.claude/architect-scope-support-desk-and-reminders.md` §3.5 — kaynak `openapi.yaml`
 * `Support` tag'i (tek doğru kaynak, DTO alan adları için birebir uyulur). Gerçek zamanlılık
 * POLLING iledir (`?afterSeq=` artımlı çekim) — SSE/WebSocket YOK, §3.3 bağlayıcı karar.
 */

// ---------------------------------------------------------------------------
// Ziyaretçi (PUBLIC, `security: []`) — `liveChatEnabled && provider==="internal"` değilse 404
// ---------------------------------------------------------------------------

/** Oturum + İLK MESAJ birlikte açılır. `accessToken` yanıtta BİR KEZ döner. 3/dk/IP. */
export function createSupportSession(input: CreateSupportSessionRequest): Promise<CreateSupportSessionResponse> {
  return apiFetch<CreateSupportSessionResponse>("/support/sessions", { method: "POST", body: input });
}

/**
 * Poll ucu — `afterSeq` ile artımlı çekim. Yetkilendirme YALNIZCA `?t=` iledir; yanlış/eksik
 * token → `404` (varlık sızdırılmaz). 60/dk/IP.
 */
export function getSupportMessages(
  sessionId: string,
  accessToken: string,
  afterSeq?: number
): Promise<{ items: SupportChatMessagePublic[]; meta: SupportMessagesMeta }> {
  return apiFetchWithMeta<SupportChatMessagePublic[]>(`/support/sessions/${sessionId}/messages`, {
    query: { t: accessToken, afterSeq },
  }).then(({ data, meta }) => ({ items: data ?? [], meta: meta as unknown as SupportMessagesMeta }));
}

/**
 * Düz metin, en fazla 2000 karakter. Oturum `CLOSED` ise `409 SUPPORT_SESSION_CLOSED`.
 * Hız sınırı 10/dk/IP.
 */
export function sendSupportMessage(
  sessionId: string,
  accessToken: string,
  input: SendSupportMessageRequest
): Promise<SupportChatMessagePublic> {
  return apiFetch<SupportChatMessagePublic>(`/support/sessions/${sessionId}/messages`, {
    method: "POST",
    query: { t: accessToken },
    body: input,
  });
}

// ---------------------------------------------------------------------------
// Yönetim (SiteRole = ADMIN veya MANAGER)
// ---------------------------------------------------------------------------

export interface ListSupportSessionsParams {
  cursor?: string;
  limit?: number;
  status?: SupportSessionStatus;
  /** `"me"` = oturum sahibinin kendisi, `"unassigned"` = havuzda, veya bir UUID. */
  assignedAgentId?: string;
  q?: string;
}

/** Cursor sayfalı, `seq DESC`. `meta.counts` — sekme rozetleri, `status` filtresinden ETKİLENMEZ. */
export function listSupportSessions(
  params: ListSupportSessionsParams = {}
): Promise<{ items: SupportChatSessionSummary[]; meta: SupportSessionsListMeta }> {
  return apiFetchWithMeta<SupportChatSessionSummary[]>("/admin/support/sessions", {
    query: {
      cursor: params.cursor,
      limit: params.limit ?? 20,
      status: params.status,
      assignedAgentId: params.assignedAgentId,
      q: params.q,
    },
  }).then(({ data, meta }) => ({ items: data ?? [], meta: meta as unknown as SupportSessionsListMeta }));
}

/** Yan etkisizdir — oturumu "okundu"/"yanıtlandı" İŞARETLEMEZ. */
export function getSupportSession(sessionId: string): Promise<SupportChatSession> {
  return apiFetch<SupportChatSession>(`/admin/support/sessions/${sessionId}`);
}

/**
 * Yalnızca `status` taşır — kapat/yeniden aç. `ANSWERED` bu uçtan SET EDİLEMEZ (`422`, türev durum).
 */
export function updateSupportSessionStatus(sessionId: string, input: UpdateSupportSessionRequest): Promise<SupportChatSession> {
  return apiFetch<SupportChatSession>(`/admin/support/sessions/${sessionId}`, { method: "PATCH", body: input });
}

/** Geri alınamaz — çöp kutusu YOKTUR. KVKK silme talebinin karşılığıdır. */
export function deleteSupportSession(sessionId: string): Promise<void> {
  return apiFetch<void>(`/admin/support/sessions/${sessionId}`, { method: "DELETE" });
}

/** Açık sohbet dizisi — `afterSeq` ile artımlı çekim, ziyaretçi ucuyla AYNI sözleşme. */
export function getAdminSupportMessages(
  sessionId: string,
  afterSeq?: number
): Promise<{ items: SupportChatMessage[]; meta: SupportMessagesMeta }> {
  return apiFetchWithMeta<SupportChatMessage[]>(`/admin/support/sessions/${sessionId}/messages`, {
    query: { afterSeq },
  }).then(({ data, meta }) => ({ items: data ?? [], meta: meta as unknown as SupportMessagesMeta }));
}

/**
 * Temsilci yanıtı. Yan etkiler: `status → ANSWERED`; oturum ATANMAMIŞSA gönderene otomatik
 * atanır ("yanıtlayan sahiplenir"). `templateId` verilse bile `body` yine de GÖNDERİLMELİDİR.
 */
export function sendAgentSupportMessage(sessionId: string, input: SendSupportAgentMessageRequest): Promise<SupportChatMessage> {
  return apiFetch<SupportChatMessage>(`/admin/support/sessions/${sessionId}/messages`, { method: "POST", body: input });
}

/** `agentId: null` → atamayı kaldırır. Hedef `ACTIVE` ve `role ∈ {ADMIN, MANAGER}` değilse `422`. */
export function assignSupportSession(sessionId: string, input: AssignSupportSessionRequest): Promise<SupportChatSession> {
  return apiFetch<SupportChatSession>(`/admin/support/sessions/${sessionId}/assign`, { method: "PATCH", body: input });
}

/** Atama dropdown'ını besler — `GET /admin/users` KULLANILMAZ (o uç ADMIN-only). `email` DÖNMEZ. */
export function listSupportAgents(): Promise<SupportAgentSummary[]> {
  return apiFetch<SupportAgentSummary[]>("/admin/support/agents");
}

/** `sortOrder ASC, seq ASC`. Sayfalama YOKTUR. `includeInactive=true` verilmezse yalnızca aktifler. */
export function listSupportTemplates(includeInactive = false): Promise<SupportReplyTemplate[]> {
  return apiFetch<SupportReplyTemplate[]>("/admin/support/templates", { query: { includeInactive } });
}

export function createSupportTemplate(input: CreateSupportReplyTemplateRequest): Promise<SupportReplyTemplate> {
  return apiFetch<SupportReplyTemplate>("/admin/support/templates", { method: "POST", body: input });
}

export function updateSupportTemplate(templateId: string, input: UpdateSupportReplyTemplateRequest): Promise<SupportReplyTemplate> {
  return apiFetch<SupportReplyTemplate>(`/admin/support/templates/${templateId}`, { method: "PATCH", body: input });
}

/** Kalıcı siler. Şablondan ÜRETİLMİŞ geçmiş mesajlar ETKİLENMEZ (`body` bir SNAPSHOT'tır). */
export function deleteSupportTemplate(templateId: string): Promise<void> {
  return apiFetch<void>(`/admin/support/templates/${templateId}`, { method: "DELETE" });
}
