import crypto from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { OutboundWebhook, User, WebhookDelivery } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { encryptSecret } from "../../lib/crypto";
import { generateWebhookSecret, webhookSecretLast4 } from "../../lib/webhook-signature";
import { validateWebhookUrl, validateWebhookUrlSyntax, SsrfValidationError } from "../../lib/ssrf-guard";
import { logAudit } from "../../lib/audit";
import { ConflictError, NotFoundError, ValidationError } from "../../lib/errors";
import { enqueueWebhookDispatch } from "./outbound-webhooks.dispatcher";
import type { CreateOutboundWebhookRequestDto, UpdateOutboundWebhookRequestDto } from "./outbound-webhooks.schemas";

/** §10.13.7-E — site genelinde en fazla 20 webhook tanımlanabilir; aşımda `409 CONFLICT`. */
export const WEBHOOK_MAX_COUNT = 20;

export type OutboundWebhookWithCreator = OutboundWebhook & { createdBy: User | null };

const WITH_CREATOR = { createdBy: true } as const;

interface Actor {
  id: string;
  email: string;
  ip?: string;
}

/**
 * §10.13.7 — URL'i sözdizimsel + DNS/ağ katmanı kontrollerinden geçirir. Reddedilirse
 * `422 VALIDATION_ERROR` (`details.url`) fırlatır VE `outbound_webhook.url_rejected` audit
 * kaydı yazar (**çözülen IP metadata'ya YAZILMAZ** — iç ağ topolojisini sızdırmamak için).
 */
async function assertValidWebhookUrlOrAudit(app: FastifyInstance, url: string, actor: Actor): Promise<void> {
  try {
    await validateWebhookUrl(url);
  } catch (err) {
    const reason = err instanceof SsrfValidationError ? err.reason : "invalid_url";
    let host: string | null = null;
    try {
      host = validateWebhookUrlSyntax(url).hostname;
    } catch {
      host = null;
    }

    await logAudit(app, {
      actorId: actor.id,
      actorEmail: actor.email,
      action: "outbound_webhook.url_rejected",
      status: "FORBIDDEN",
      metadata: { host, reason },
      ipAddress: actor.ip,
    });

    const message = err instanceof Error ? err.message : "Geçersiz webhook URL'i.";
    throw new ValidationError(message, { url: [message] });
  }
}

export async function createWebhook(
  app: FastifyInstance,
  input: CreateOutboundWebhookRequestDto,
  actor: Actor
): Promise<{ webhook: OutboundWebhookWithCreator; plainSecret: string }> {
  const count = await app.prisma.outboundWebhook.count();
  if (count >= WEBHOOK_MAX_COUNT) {
    throw new ConflictError(`En fazla ${WEBHOOK_MAX_COUNT} webhook tanımlanabilir.`);
  }

  await assertValidWebhookUrlOrAudit(app, input.url, actor);

  const plainSecret = generateWebhookSecret();
  const dedupedEvents = Array.from(new Set(input.events));

  const row = await app.prisma.outboundWebhook.create({
    data: {
      name: input.name,
      description: input.description ?? null,
      url: input.url,
      secretEncrypted: encryptSecret(plainSecret),
      secretLast4: webhookSecretLast4(plainSecret),
      events: dedupedEvents,
      status: input.status ?? "ACTIVE",
      createdById: actor.id,
    },
    include: WITH_CREATOR,
  });

  await logAudit(app, {
    actorId: actor.id,
    actorEmail: actor.email,
    action: "outbound_webhook.create",
    targetType: "OutboundWebhook",
    targetId: row.id,
    metadata: { name: row.name, url: row.url, events: row.events },
    ipAddress: actor.ip,
  });

  return { webhook: row, plainSecret };
}

/** §10.13.10 — `seq desc` (en yeni webhook önce). */
export async function listWebhooks(app: FastifyInstance, query: { cursorSeq?: number; limit: number }): Promise<OutboundWebhookWithCreator[]> {
  return app.prisma.outboundWebhook.findMany({
    where: { ...(query.cursorSeq ? { seq: { lt: query.cursorSeq } } : {}) },
    orderBy: { seq: "desc" },
    take: query.limit,
    include: WITH_CREATOR,
  });
}

export async function getWebhookOrThrow(app: FastifyInstance, webhookId: string): Promise<OutboundWebhookWithCreator> {
  const row = await app.prisma.outboundWebhook.findUnique({ where: { id: webhookId }, include: WITH_CREATOR });
  if (!row) throw new NotFoundError("Webhook bulunamadı.");
  return row;
}

export async function updateWebhook(
  app: FastifyInstance,
  webhookId: string,
  input: UpdateOutboundWebhookRequestDto,
  actor: Actor
): Promise<OutboundWebhookWithCreator> {
  const existing = await getWebhookOrThrow(app, webhookId);

  if (input.url !== undefined) {
    await assertValidWebhookUrlOrAudit(app, input.url, actor);
  }

  const becomingActive = input.status === "ACTIVE" && existing.status !== "ACTIVE";

  const row = await app.prisma.outboundWebhook.update({
    where: { id: webhookId },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.url !== undefined ? { url: input.url } : {}),
      ...(input.events !== undefined ? { events: Array.from(new Set(input.events)) } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      // §10.13.10 — `status: "ACTIVE"` gönderilmesi otomatik kapatılmış bir webhook'u yeniden
      // etkinleştirir ve sayacı 0'lar.
      ...(becomingActive ? { consecutiveFailureCount: 0, autoDisabledAt: null } : {}),
    },
    include: WITH_CREATOR,
  });

  await logAudit(app, {
    actorId: actor.id,
    actorEmail: actor.email,
    action: "outbound_webhook.update",
    targetType: "OutboundWebhook",
    targetId: row.id,
    metadata: { fields: Object.keys(input) },
    ipAddress: actor.ip,
  });

  return row;
}

export async function deleteWebhook(app: FastifyInstance, webhookId: string, actor: Actor): Promise<void> {
  await getWebhookOrThrow(app, webhookId);

  // İlişkili `WebhookDelivery` kayıtları `onDelete: Cascade` ile otomatik silinir (§10.13.10).
  await app.prisma.outboundWebhook.delete({ where: { id: webhookId } });

  await logAudit(app, {
    actorId: actor.id,
    actorEmail: actor.email,
    action: "outbound_webhook.delete",
    targetType: "OutboundWebhook",
    targetId: webhookId,
    ipAddress: actor.ip,
  });
}

export async function rotateWebhookSecret(
  app: FastifyInstance,
  webhookId: string,
  actor: Actor
): Promise<{ webhook: OutboundWebhookWithCreator; plainSecret: string }> {
  await getWebhookOrThrow(app, webhookId);

  const plainSecret = generateWebhookSecret();
  const row = await app.prisma.outboundWebhook.update({
    where: { id: webhookId },
    data: { secretEncrypted: encryptSecret(plainSecret), secretLast4: webhookSecretLast4(plainSecret) },
    include: WITH_CREATOR,
  });

  await logAudit(app, {
    actorId: actor.id,
    actorEmail: actor.email,
    action: "outbound_webhook.rotate_secret",
    targetType: "OutboundWebhook",
    targetId: row.id,
    ipAddress: actor.ip,
  });

  return { webhook: row, plainSecret };
}

/**
 * §10.13.10 — `PING` olayı için bir `WebhookDelivery` satırı oluşturur (202, asenkron).
 * Webhook `PAUSED`/`DISABLED` olsa DAHİ çalışır ve `events` listesinde `PING` olmasa bile
 * kuyruklanır — test aboneliğinden BAĞIMSIZDIR.
 */
export async function enqueueTestDelivery(app: FastifyInstance, webhookId: string, actor: Actor): Promise<{ deliveryId: string }> {
  const webhook = await getWebhookOrThrow(app, webhookId);

  const deliveryId = crypto.randomUUID();
  const now = new Date();
  const payload = {
    id: deliveryId,
    event: "PING" as const,
    apiVersion: "v1" as const,
    createdAt: now.toISOString(),
    data: { message: "ping", webhookId: webhook.id },
  };

  await app.prisma.webhookDelivery.create({
    data: {
      id: deliveryId,
      webhookId: webhook.id,
      event: "PING",
      payload,
      status: "PENDING",
      nextAttemptAt: now,
      containsPii: false,
    },
  });

  await logAudit(app, {
    actorId: actor.id,
    actorEmail: actor.email,
    action: "outbound_webhook.test",
    targetType: "OutboundWebhook",
    targetId: webhook.id,
    metadata: { deliveryId },
    ipAddress: actor.ip,
  });

  enqueueWebhookDispatch(app);

  return { deliveryId };
}

/** §10.13.10 — `seq desc`, `payload`/`responseBodySnippet` TAŞIMAZ (liste DTO'su mapper'da kesilir). */
export async function listDeliveries(
  app: FastifyInstance,
  webhookId: string,
  query: { cursorSeq?: number; limit: number; status?: WebhookDelivery["status"]; event?: WebhookDelivery["event"] }
): Promise<WebhookDelivery[]> {
  await getWebhookOrThrow(app, webhookId);

  return app.prisma.webhookDelivery.findMany({
    where: {
      webhookId,
      ...(query.cursorSeq ? { seq: { lt: query.cursorSeq } } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.event ? { event: query.event } : {}),
    },
    orderBy: { seq: "desc" },
    take: query.limit,
  });
}

/** IDOR koruması — `deliveryId`'nin GERÇEKTEN bu `webhookId`'ye ait olduğu doğrulanır (§10.13.10). */
export async function getDeliveryOrThrow(app: FastifyInstance, webhookId: string, deliveryId: string): Promise<WebhookDelivery> {
  const row = await app.prisma.webhookDelivery.findUnique({ where: { id: deliveryId } });
  if (!row || row.webhookId !== webhookId) throw new NotFoundError("Gönderim kaydı bulunamadı.");
  return row;
}

/**
 * §10.13.10 — kaynak kaydın `payload`'ını BİREBİR kullanarak YENİ bir `WebhookDelivery` satırı
 * oluşturur (`redeliveryOfId` ile bağlanır). Kaynak satırın sayaçları/durumu DEĞİŞMEZ. Payload
 * redakte edilmişse (`{ redacted: true }`, §10.13.8 7 gün) `409 CONFLICT`.
 */
export async function redeliverDelivery(
  app: FastifyInstance,
  webhookId: string,
  deliveryId: string,
  actor: Actor
): Promise<{ deliveryId: string }> {
  const source = await getDeliveryOrThrow(app, webhookId, deliveryId);

  const payload = source.payload as { redacted?: true } | Record<string, unknown>;
  if (payload && typeof payload === "object" && "redacted" in payload && payload.redacted === true) {
    throw new ConflictError("Bu gönderimin gövdesi saklama süresi nedeniyle redakte edildi, yeniden gönderilemez.");
  }

  const newDeliveryId = crypto.randomUUID();
  const now = new Date();

  await app.prisma.webhookDelivery.create({
    data: {
      id: newDeliveryId,
      webhookId,
      event: source.event,
      payload: source.payload as Prisma.InputJsonValue,
      status: "PENDING",
      nextAttemptAt: now,
      containsPii: source.containsPii,
      redeliveryOfId: source.id,
    },
  });

  await logAudit(app, {
    actorId: actor.id,
    actorEmail: actor.email,
    action: "outbound_webhook.redeliver",
    targetType: "OutboundWebhook",
    targetId: webhookId,
    metadata: { sourceDeliveryId: source.id, newDeliveryId },
    ipAddress: actor.ip,
  });

  enqueueWebhookDispatch(app);

  return { deliveryId: newDeliveryId };
}
