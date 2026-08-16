import { z } from "zod";
import { CursorQuerySchema } from "../../schemas/common";
import { WebhookDeliveryStatusSchema, WebhookEventSchema } from "../../schemas/entities";
import { SUBSCRIBABLE_WEBHOOK_EVENTS } from "../../lib/webhook-events";
import { WEBHOOK_URL_MAX_LENGTH } from "../../lib/ssrf-guard";

export const OutboundWebhookIdParamSchema = z.object({
  webhookId: z.string().uuid(),
});

export const WebhookDeliveryIdParamSchema = OutboundWebhookIdParamSchema.extend({
  deliveryId: z.string().uuid(),
});

export const ListOutboundWebhooksQuerySchema = CursorQuerySchema;

export const ListWebhookDeliveriesQuerySchema = CursorQuerySchema.extend({
  status: WebhookDeliveryStatusSchema.optional(),
  event: WebhookEventSchema.optional(),
});

/** `PING` abonelik listesinde YASAKTIR — gerçek bir olay değildir (§10.13.10). */
const SubscribableEventSchema = WebhookEventSchema.refine((event) => (SUBSCRIBABLE_WEBHOOK_EVENTS as string[]).includes(event), {
  message: "PING bir abonelik olayı değildir.",
});

export const CreateOutboundWebhookRequestSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).nullable().optional(),
  url: z.string().url().max(WEBHOOK_URL_MAX_LENGTH),
  events: z.array(SubscribableEventSchema).min(1).max(20),
  // Oluştururken `DISABLED` GÖNDERİLEMEZ — o değer yalnızca sistemin otomatik kapatmasıyla oluşur.
  status: z.enum(["ACTIVE", "PAUSED"]).default("ACTIVE"),
});
export type CreateOutboundWebhookRequestDto = z.infer<typeof CreateOutboundWebhookRequestSchema>;

export const UpdateOutboundWebhookRequestSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).nullable().optional(),
  url: z.string().url().max(WEBHOOK_URL_MAX_LENGTH).optional(),
  events: z.array(SubscribableEventSchema).min(1).max(20).optional(),
  status: z.enum(["ACTIVE", "PAUSED"]).optional(),
});
export type UpdateOutboundWebhookRequestDto = z.infer<typeof UpdateOutboundWebhookRequestSchema>;
