import { apiFetch, apiFetchPage } from "./client";
import type {
  CreateOutboundWebhookRequest,
  CreateOutboundWebhookResponse,
  EnqueueWebhookDeliveryResponse,
  OutboundWebhook,
  Page,
  RotateWebhookSecretResponse,
  UpdateOutboundWebhookRequest,
  WebhookDelivery,
  WebhookDeliveryStatus,
  WebhookDeliverySummary,
  WebhookEvent,
  WebhookEventDefinition,
} from "./types";

export interface ListWebhooksParams {
  cursor?: string;
  limit?: number;
}

export interface ListWebhookDeliveriesParams {
  cursor?: string;
  limit?: number;
  status?: WebhookDeliveryStatus;
  event?: WebhookEvent;
}

/**
 * `GET /admin/settings/webhooks/events` — statik olay kayıt defteri (`lib/webhook-events.ts`),
 * DB tablosu DEĞİLDİR (ARCHITECTURE.md §10.13.10). Frontend olay listesini/etiketlerini
 * HARDCODE ETMEZ; her zaman buradan okur.
 */
export function listWebhookEvents(): Promise<WebhookEventDefinition[]> {
  return apiFetch<WebhookEventDefinition[]>("/admin/settings/webhooks/events");
}

/** `GET /admin/settings/webhooks` — cursor sayfalı (`seq desc`). Secret ASLA dönmez — yalnızca `secretLast4`. */
export function listWebhooks(params: ListWebhooksParams = {}): Promise<Page<OutboundWebhook>> {
  return apiFetchPage<OutboundWebhook>("/admin/settings/webhooks", {
    query: { cursor: params.cursor, limit: params.limit },
  });
}

/**
 * `POST /admin/settings/webhooks` — `url` sunucuda SSRF doğrulamasından geçer (§10.13.7,
 * `422` + `error.details.url` reddinde). **`plainSecret` yalnızca bu yanıtta, bir kez döner.**
 */
export function createWebhook(input: CreateOutboundWebhookRequest): Promise<CreateOutboundWebhookResponse> {
  return apiFetch<CreateOutboundWebhookResponse>("/admin/settings/webhooks", { method: "POST", body: input });
}

export function getWebhook(webhookId: string): Promise<OutboundWebhook> {
  return apiFetch<OutboundWebhook>(`/admin/settings/webhooks/${webhookId}`);
}

/**
 * `url` gönderilirse SSRF doğrulaması YENİDEN çalışır. `status: "ACTIVE"` göndermek
 * otomatik kapatılmış (`DISABLED`) bir webhook'u yeniden etkinleştirir ve
 * `consecutiveFailureCount`'u sıfırlar.
 */
export function updateWebhook(webhookId: string, input: UpdateOutboundWebhookRequest): Promise<OutboundWebhook> {
  return apiFetch<OutboundWebhook>(`/admin/settings/webhooks/${webhookId}`, { method: "PATCH", body: input });
}

/** İlişkili tüm `WebhookDelivery` kayıtları cascade silinir. `204`. */
export function deleteWebhook(webhookId: string): Promise<void> {
  return apiFetch<void>(`/admin/settings/webhooks/${webhookId}`, { method: "DELETE" });
}

/** Eski secret ANINDA geçersizdir — kademeli geçiş (grace period) YOKTUR (§10.13.9). */
export function rotateWebhookSecret(webhookId: string): Promise<RotateWebhookSecretResponse> {
  return apiFetch<RotateWebhookSecretResponse>(`/admin/settings/webhooks/${webhookId}/rotate-secret`, {
    method: "POST",
  });
}

/**
 * `202` — `PING` olayı için bir gönderim kuyruklar (gönderim SENKRON DEĞİLDİR, dispatcher
 * en geç 15 sn içinde alır). Sonuç `deliveryId` ile yoklanır.
 */
export function testWebhook(webhookId: string): Promise<EnqueueWebhookDeliveryResponse> {
  return apiFetch<EnqueueWebhookDeliveryResponse>(`/admin/settings/webhooks/${webhookId}/test`, { method: "POST" });
}

/** Liste DTO'su `payload`/`responseBodySnippet` TAŞIMAZ (yalnızca detay ucunda döner). */
export function listWebhookDeliveries(
  webhookId: string,
  params: ListWebhookDeliveriesParams = {}
): Promise<Page<WebhookDeliverySummary>> {
  return apiFetchPage<WebhookDeliverySummary>(`/admin/settings/webhooks/${webhookId}/deliveries`, {
    query: { cursor: params.cursor, limit: params.limit, status: params.status, event: params.event },
  });
}

export function getWebhookDelivery(webhookId: string, deliveryId: string): Promise<WebhookDelivery> {
  return apiFetch<WebhookDelivery>(`/admin/settings/webhooks/${webhookId}/deliveries/${deliveryId}`);
}

/**
 * `202` — kaynak satırın `payload`'ını BİREBİR kullanarak YENİ bir `WebhookDelivery` satırı
 * oluşturur (`redeliveryOfId` ile bağlanır). Payload redakte edilmişse backend `409` döner.
 */
export function redeliverWebhookDelivery(
  webhookId: string,
  deliveryId: string
): Promise<EnqueueWebhookDeliveryResponse> {
  return apiFetch<EnqueueWebhookDeliveryResponse>(
    `/admin/settings/webhooks/${webhookId}/deliveries/${deliveryId}/redeliver`,
    { method: "POST" }
  );
}
