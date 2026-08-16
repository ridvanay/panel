import type { FastifyInstance } from "fastify";
import type { OutboundWebhook, WebhookDelivery } from "@prisma/client";
import type * as net from "node:net";
import { Agent, request as undiciRequest } from "undici";
import { decryptSecret } from "../../lib/crypto";
import { logAudit } from "../../lib/audit";
import { signWebhookPayload } from "../../lib/webhook-signature";
import { validateWebhookUrlSyntax, resolveAndValidateHost, SsrfValidationError } from "../../lib/ssrf-guard";

/**
 * §10.13.8 — süreç-içi sweeper + gönderim + backoff. `ImportJob`/zamanlanmış yayın ile AYNI
 * desen (§10.8.1): kuyruk altyapısı (BullMQ/Redis) YOK, tek instance varsayımı.
 */

export const WEBHOOK_DISPATCH_SWEEP_INTERVAL_MS = 15_000;
export const WEBHOOK_DISPATCH_TAKE = 20;
export const WEBHOOK_DISPATCH_CONCURRENCY = 5;
export const WEBHOOK_MAX_ATTEMPTS = 5;
/** 30 sn → 2 dk → 10 dk → 60 dk (deneme 1 başarısız olduktan sonraki bekleme, sırasıyla). */
export const WEBHOOK_RETRY_DELAYS_MS = [30_000, 120_000, 600_000, 3_600_000];
export const WEBHOOK_AUTO_DISABLE_THRESHOLD = 20;
export const WEBHOOK_CONNECT_TIMEOUT_MS = 5_000;
export const WEBHOOK_REQUEST_TIMEOUT_MS = 10_000;
export const WEBHOOK_RESPONSE_BODY_READ_LIMIT_BYTES = 8 * 1024;
export const WEBHOOK_RESPONSE_SNIPPET_LENGTH = 512;

/** Eşit jitter: `base/2 + random(0, base/2)` — senkronize "thundering herd" geri dönüşünü önler. */
function computeBackoffMs(attemptNumber: number): number {
  // attemptNumber: az önce BAŞARISIZ olan deneme sayısı (1..4) — bir sonraki denemenin gecikmesi.
  const base = WEBHOOK_RETRY_DELAYS_MS[Math.min(attemptNumber - 1, WEBHOOK_RETRY_DELAYS_MS.length - 1)]!;
  return Math.round(base / 2 + Math.random() * (base / 2));
}

export type WebhookDeliveryErrorCode =
  | "timeout"
  | "dns_failure"
  | "connection_refused"
  | "tls_error"
  | "redirect_not_followed"
  | "ssrf_blocked"
  | "http_error"
  | "unknown";

function mapNetworkErrorToCode(err: unknown): WebhookDeliveryErrorCode {
  const code = (err as { code?: string; cause?: { code?: string }; name?: string })?.code ?? (err as { cause?: { code?: string } })?.cause?.code;
  const name = (err as { name?: string })?.name;

  if (code === "UND_ERR_CONNECT_TIMEOUT" || code === "UND_ERR_HEADERS_TIMEOUT" || code === "UND_ERR_BODY_TIMEOUT" || name === "ConnectTimeoutError") {
    return "timeout";
  }
  if (code === "ECONNREFUSED") return "connection_refused";
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return "dns_failure";
  if (typeof code === "string" && (code.startsWith("ERR_TLS") || code.startsWith("CERT_"))) return "tls_error";
  return "unknown";
}

/** Yalnızca ağ hatalarında (§10.13.8 tablosu) yeniden denenir. */
function isRetryableNetworkError(): boolean {
  return true;
}

function isRetryableStatus(statusCode: number): boolean {
  return statusCode === 408 || statusCode === 429 || (statusCode >= 500 && statusCode < 600);
}

async function readBodySnippet(body: AsyncIterable<Uint8Array>): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of body) {
    const buf = Buffer.from(chunk);
    const remaining = WEBHOOK_RESPONSE_BODY_READ_LIMIT_BYTES - total;
    if (remaining <= 0) break;
    const slice = buf.length > remaining ? buf.subarray(0, remaining) : buf;
    chunks.push(slice);
    total += slice.length;
    if (total >= WEBHOOK_RESPONSE_BODY_READ_LIMIT_BYTES) break;
  }
  return Buffer.concat(chunks).toString("utf8").slice(0, WEBHOOK_RESPONSE_SNIPPET_LENGTH);
}

interface DeliveryOutcome {
  status: "SUCCEEDED" | "FAILED" | "RETRYING";
  responseStatus?: number;
  responseBodySnippet?: string;
  errorCode?: WebhookDeliveryErrorCode;
  errorMessage?: string;
  durationMs: number;
  nextAttemptAt?: Date;
}

/**
 * §10.13.7-C — her teslimat denemesinde host YENİDEN çözülür + seçilen IP'ye PİNLENİR
 * (`undici` `Agent`'ına özel `connect.lookup`, Host/SNI ORİJİNAL host adıyla kalır).
 * Yönlendirmeler (3xx) TAKİP EDİLMEZ (`undici.request` zaten varsayılan olarak izlemez).
 */
async function sendWebhookRequest(
  webhook: OutboundWebhook,
  delivery: WebhookDelivery,
  attemptNumber: number
): Promise<DeliveryOutcome> {
  const startedAt = Date.now();

  let hostname: string;
  try {
    hostname = validateWebhookUrlSyntax(webhook.url).hostname;
  } catch (err) {
    return {
      status: "FAILED",
      errorCode: "ssrf_blocked",
      errorMessage: err instanceof Error ? err.message : "SSRF doğrulaması başarısız.",
      durationMs: Date.now() - startedAt,
    };
  }

  let pinnedIp: string;
  try {
    const resolved = await resolveAndValidateHost(hostname);
    pinnedIp = resolved.addresses[0]!;
  } catch (err) {
    const isDnsFailure = err instanceof SsrfValidationError && err.reason === "dns_failure";
    return {
      status: "FAILED",
      errorCode: isDnsFailure ? "dns_failure" : "ssrf_blocked",
      errorMessage: err instanceof Error ? err.message : "SSRF doğrulaması başarısız.",
      durationMs: Date.now() - startedAt,
    };
  }

  let secret: string;
  try {
    secret = decryptSecret(webhook.secretEncrypted);
  } catch (err) {
    // `ENCRYPTION_KEY` değişmişse/veri bozulmuşsa bu istisna yakalanmazsa delivery `SENDING`'de
    // askıda kalır (yalnızca restart'ta `recoverStuckWebhookDeliveries` ile kurtarılır) —
    // security-agent denetiminde flaglenen dayanıklılık notu.
    return {
      status: "FAILED",
      errorCode: "unknown",
      errorMessage: err instanceof Error ? `Webhook secret çözülemedi: ${err.message}` : "Webhook secret çözülemedi.",
      durationMs: Date.now() - startedAt,
    };
  }

  const rawBody = JSON.stringify(delivery.payload);
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = signWebhookPayload(secret, timestamp, rawBody);

  // Yalnızca bu isteğe özel, pinlenmiş IP'ye bağlanan bir Agent — DNS rebinding koruması.
  // `connect.lookup` her zaman AYNI (önceden doğrulanmış) IP'yi döner; işletim sistemi
  // çözümleyicisine (`dns.lookup`) ikinci kez BAŞVURULMAZ. Host/SNI orijinal host adıyla kalır
  // çünkü istek URL'i (`webhook.url`) değiştirilmeden kullanılır — yalnızca bağlantı hedefi pinlenir.
  const pinnedFamily = pinnedIp.includes(":") ? 6 : 4;
  const pinnedLookup: net.LookupFunction = (_hostname, _options, callback) => {
    callback(null, pinnedIp, pinnedFamily);
  };

  const agent = new Agent({
    connect: {
      timeout: WEBHOOK_CONNECT_TIMEOUT_MS,
      lookup: pinnedLookup,
    },
  });

  try {
    const response = await undiciRequest(webhook.url, {
      method: "POST",
      dispatcher: agent,
      // Proxy ortam değişkenleri (`HTTP_PROXY`/`HTTPS_PROXY`) `undici` tarafından ONURLANDIRILMAZ
      // (Node'un `http`/`https` modüllerinin aksine) — §10.13.7-C4 gerekçesiyle TUTARLI.
      maxRedirections: 0,
      bodyTimeout: WEBHOOK_REQUEST_TIMEOUT_MS,
      headersTimeout: WEBHOOK_REQUEST_TIMEOUT_MS,
      headers: {
        "content-type": "application/json",
        "user-agent": "CMS-Webhook/1.0",
        "x-webhook-id": webhook.id,
        "x-webhook-delivery": delivery.id,
        "x-webhook-event": delivery.event,
        "x-webhook-timestamp": String(timestamp),
        "x-webhook-attempt": String(attemptNumber),
        "x-webhook-signature": signature,
      },
      body: rawBody,
    });

    const snippet = await readBodySnippet(response.body);
    const durationMs = Date.now() - startedAt;
    const statusCode = response.statusCode;

    if (statusCode >= 200 && statusCode < 300) {
      return { status: "SUCCEEDED", responseStatus: statusCode, responseBodySnippet: snippet, durationMs };
    }
    if (statusCode >= 300 && statusCode < 400) {
      return {
        status: "FAILED",
        responseStatus: statusCode,
        responseBodySnippet: snippet,
        errorCode: "redirect_not_followed",
        errorMessage: `Alıcı bir yönlendirme (${statusCode}) döndürdü; yönlendirmeler takip edilmez.`,
        durationMs,
      };
    }
    if (isRetryableStatus(statusCode)) {
      return {
        status: attemptNumber >= WEBHOOK_MAX_ATTEMPTS ? "FAILED" : "RETRYING",
        responseStatus: statusCode,
        responseBodySnippet: snippet,
        errorCode: "http_error",
        errorMessage: `Alıcı ${statusCode} döndürdü.`,
        durationMs,
        nextAttemptAt: attemptNumber >= WEBHOOK_MAX_ATTEMPTS ? undefined : new Date(Date.now() + computeBackoffMs(attemptNumber)),
      };
    }
    return {
      status: "FAILED",
      responseStatus: statusCode,
      responseBodySnippet: snippet,
      errorCode: "http_error",
      errorMessage: `Alıcı kalıcı bir istemci hatası döndürdü (${statusCode}).`,
      durationMs,
    };
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    const errorCode = mapNetworkErrorToCode(err);
    const retryable = isRetryableNetworkError();
    return {
      status: retryable && attemptNumber < WEBHOOK_MAX_ATTEMPTS ? "RETRYING" : "FAILED",
      errorCode,
      errorMessage: err instanceof Error ? err.message : "Bilinmeyen ağ hatası.",
      durationMs,
      nextAttemptAt: retryable && attemptNumber < WEBHOOK_MAX_ATTEMPTS ? new Date(Date.now() + computeBackoffMs(attemptNumber)) : undefined,
    };
  } finally {
    await agent.close().catch(() => {});
  }
}

async function processDelivery(app: FastifyInstance, delivery: WebhookDelivery): Promise<void> {
  const webhook = await app.prisma.outboundWebhook.findUnique({ where: { id: delivery.webhookId } });
  // Webhook cascade ile silinmiş olabilir (aradaki pencerede) — satır zaten gitmiş demektir.
  if (!webhook) return;

  const attemptNumber = delivery.attemptCount + 1;
  const now = new Date();

  const outcome = await sendWebhookRequest(webhook, delivery, attemptNumber);

  await app.prisma.webhookDelivery.update({
    where: { id: delivery.id },
    data: {
      status: outcome.status,
      attemptCount: attemptNumber,
      firstAttemptAt: delivery.firstAttemptAt ?? now,
      lastAttemptAt: now,
      responseStatus: outcome.responseStatus ?? null,
      responseBodySnippet: outcome.responseBodySnippet ?? null,
      errorCode: outcome.errorCode ?? null,
      errorMessage: outcome.errorMessage ?? null,
      durationMs: outcome.durationMs,
      nextAttemptAt: outcome.status === "RETRYING" ? outcome.nextAttemptAt : null,
      deliveredAt: outcome.status === "SUCCEEDED" ? now : undefined,
    },
  });

  if (outcome.status === "RETRYING") {
    // Ara durum — webhook düzeyindeki sayaçlar yalnızca NİHAİ (SUCCEEDED/FAILED) sonuçta güncellenir.
    return;
  }

  if (outcome.status === "SUCCEEDED") {
    await app.prisma.outboundWebhook.update({
      where: { id: webhook.id },
      data: { consecutiveFailureCount: 0, lastTriggeredAt: now, lastSuccessAt: now },
    });
    return;
  }

  // FAILED (nihai) — sayaç artar, eşik aşılırsa otomatik kapatılır.
  const updated = await app.prisma.outboundWebhook.update({
    where: { id: webhook.id },
    data: { consecutiveFailureCount: { increment: 1 }, lastTriggeredAt: now, lastFailureAt: now },
  });

  if (updated.consecutiveFailureCount >= WEBHOOK_AUTO_DISABLE_THRESHOLD && updated.status !== "DISABLED") {
    await app.prisma.outboundWebhook.update({
      where: { id: webhook.id },
      data: { status: "DISABLED", autoDisabledAt: now },
    });
    await logAudit(app, {
      action: "outbound_webhook.auto_disabled",
      targetType: "OutboundWebhook",
      targetId: webhook.id,
      metadata: { consecutiveFailureCount: updated.consecutiveFailureCount },
    });
  }
}

let sweeping = false;
let sweepAgainRequested = false;

async function runDispatchSweep(app: FastifyInstance): Promise<void> {
  if (sweeping) {
    sweepAgainRequested = true;
    return;
  }
  sweeping = true;
  try {
    do {
      sweepAgainRequested = false;
      const now = new Date();
      const candidates = await app.prisma.webhookDelivery.findMany({
        where: { status: { in: ["PENDING", "RETRYING"] }, nextAttemptAt: { lte: now } },
        orderBy: { nextAttemptAt: "asc" },
        take: WEBHOOK_DISPATCH_TAKE,
      });
      if (candidates.length === 0) continue;

      // Claim — aynı satırın iki kez işlenmesini önler (§10.13.8). Tek instance varsayımında bu
      // esas olarak `runDispatchSweep`'in kendi içindeki çakışmaları (immediate-trigger + interval
      // aynı anda tetiklenirse) önler; `sweeping` bayrağı zaten bunu engeller ama savunma ağıdır.
      const claim = await app.prisma.webhookDelivery.updateMany({
        where: { id: { in: candidates.map((c) => c.id) }, status: { in: ["PENDING", "RETRYING"] } },
        data: { status: "SENDING", lastAttemptAt: now },
      });
      if (claim.count === 0) continue;

      const queue = [...candidates];
      const workers = Array.from({ length: WEBHOOK_DISPATCH_CONCURRENCY }, async () => {
        let item = queue.shift();
        while (item) {
          await processDelivery(app, item).catch((err) => {
            app.log.error({ err, deliveryId: item!.id }, "Webhook teslimatı işlenirken beklenmedik hata oluştu");
          });
          item = queue.shift();
        }
      });
      await Promise.all(workers);
    } while (sweepAgainRequested);
  } finally {
    sweeping = false;
  }
}

/** `emitWebhookEvent` sonrası 15 sn'lik turu beklemeden best-effort tetikleme. */
export function enqueueWebhookDispatch(app: FastifyInstance): void {
  setImmediate(() => {
    runDispatchSweep(app).catch((err) => {
      app.log.error({ err }, "Webhook dispatch sweep başarısız oldu");
    });
  });
}

/**
 * §10.8.1 deseniyle AYNI çökme/restart kurtarması — `SENDING`'de kalmış satırlar `RETRYING`'e
 * çevrilir ve `nextAttemptAt: now()` yapılır. BU HOOK OLMADAN çökme sonrası bu satırlar sonsuza
 * dek `SENDING`'de asılı kalır (dispatcher onları bir daha asla almaz, bkz. sweeper WHERE'i).
 */
export async function recoverStuckWebhookDeliveries(app: FastifyInstance): Promise<void> {
  const result = await app.prisma.webhookDelivery.updateMany({
    where: { status: "SENDING" },
    data: { status: "RETRYING", nextAttemptAt: new Date() },
  });
  if (result.count > 0) {
    app.log.warn({ count: result.count }, "Yarıda kalmış webhook teslimatları RETRYING olarak işaretlendi (sunucu restart kurtarması)");
  }
}

/**
 * `app.ts`'te §10.8.1 deseniyle AYNI şekilde `onReady` içinde çağrılır. Açılışta kurtarma +
 * hemen bir sweep, ardından her `WEBHOOK_DISPATCH_SWEEP_INTERVAL_MS`'de bir tekrar. `onClose`
 * ile interval temizlenir (testlerde process'in sonsuza dek açık kalmaması için).
 */
export function registerWebhookDispatcher(app: FastifyInstance): void {
  const runSweep = () => {
    runDispatchSweep(app).catch((err) => {
      app.log.error({ err }, "Webhook dispatch sweep başarısız oldu");
    });
  };

  runSweep();
  const timer = setInterval(runSweep, WEBHOOK_DISPATCH_SWEEP_INTERVAL_MS);
  timer.unref();

  app.addHook("onClose", () => {
    clearInterval(timer);
  });
}
