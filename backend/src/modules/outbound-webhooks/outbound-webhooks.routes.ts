import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { authenticate } from "../../middleware/authenticate";
import { requireSiteRole } from "../../middleware/site-rbac";
import { requirePanelAccess } from "../../middleware/panel-access";
import { ROLES_ADMIN } from "../../lib/site-roles";
import { ok } from "../../lib/envelope";
import { ApiSuccessSchema } from "../../schemas/common";
import {
  CreateOutboundWebhookResponseSchema,
  EnqueueWebhookDeliveryResponseSchema,
  OutboundWebhookSchema,
  RotateWebhookSecretResponseSchema,
  WebhookDeliverySchema,
  WebhookDeliverySummarySchema,
  WebhookEventDefinitionSchema,
} from "../../schemas/entities";
import { toOutboundWebhookDto, toWebhookDeliveryDto, toWebhookDeliverySummaryDto } from "../../mappers";
import { parseCursor, buildPageMeta } from "../../lib/pagination";
import { WEBHOOK_MANAGEMENT_RATE_LIMIT, WEBHOOK_REDELIVER_RATE_LIMIT, WEBHOOK_TEST_RATE_LIMIT } from "../../lib/rate-limit";
import { WEBHOOK_EVENT_REGISTRY } from "../../lib/webhook-events";
import {
  createWebhook,
  deleteWebhook,
  enqueueTestDelivery,
  getDeliveryOrThrow,
  getWebhookOrThrow,
  listDeliveries,
  listWebhooks,
  redeliverDelivery,
  rotateWebhookSecret,
  updateWebhook,
} from "./outbound-webhooks.service";
import {
  CreateOutboundWebhookRequestSchema,
  ListOutboundWebhooksQuerySchema,
  ListWebhookDeliveriesQuerySchema,
  OutboundWebhookIdParamSchema,
  UpdateOutboundWebhookRequestSchema,
  WebhookDeliveryIdParamSchema,
} from "./outbound-webhooks.schemas";

/**
 * `/admin/settings/webhooks` prefix'i altında bağlanır (bkz. app.ts). §10.13.10 — TÜM uçlar
 * İSTİSNASIZ yalnızca `SiteRole=ADMIN`'dir (OKUMA DAHİL) — bir webhook listesi dış entegrasyon
 * topolojisidir.
 *
 * DİKKAT: bu modül `POST /webhooks/stripe` (GELEN/inbound, `modules/webhooks/*`) İLE TAMAMEN
 * AYRIDIR — bkz. ARCHITECTURE.md §10.13 isimlendirme çakışması uyarısı.
 */
export async function outboundWebhooksRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>();
  server.addHook("preHandler", authenticate);
  server.addHook("preHandler", requirePanelAccess());
  server.addHook("preHandler", requireSiteRole(...ROLES_ADMIN));

  function actorFrom(request: { user?: { id: string; email: string }; ip: string }) {
    return { id: request.user!.id, email: request.user!.email, ip: request.ip };
  }

  // Statik olay kayıt defteri — `events` parametreli rotadan ÖNCE tanımlanır ("events" geçerli
  // bir UUID olmadığı için zaten çakışma yoktur, bkz. openapi.yaml rota önceliği notu).
  server.get(
    "/events",
    { schema: { response: { 200: ApiSuccessSchema(z.array(WebhookEventDefinitionSchema)) } } },
    async (_request, reply) => {
      return reply.send(ok(WEBHOOK_EVENT_REGISTRY));
    }
  );

  server.get(
    "/",
    {
      schema: { querystring: ListOutboundWebhooksQuerySchema, response: { 200: ApiSuccessSchema(z.array(OutboundWebhookSchema)) } },
    },
    async (request, reply) => {
      const { cursor, limit } = request.query;
      const rows = await listWebhooks(app, { cursorSeq: parseCursor(cursor), limit });
      return reply.send(ok(rows.map(toOutboundWebhookDto), buildPageMeta(rows, limit)));
    }
  );

  server.post(
    "/",
    {
      config: { rateLimit: WEBHOOK_MANAGEMENT_RATE_LIMIT },
      schema: { body: CreateOutboundWebhookRequestSchema, response: { 201: ApiSuccessSchema(CreateOutboundWebhookResponseSchema) } },
    },
    async (request, reply) => {
      const { webhook, plainSecret } = await createWebhook(app, request.body, actorFrom(request));
      return reply.code(201).send(ok({ webhook: toOutboundWebhookDto(webhook), plainSecret }));
    }
  );

  server.get(
    "/:webhookId",
    { schema: { params: OutboundWebhookIdParamSchema, response: { 200: ApiSuccessSchema(OutboundWebhookSchema) } } },
    async (request, reply) => {
      const webhook = await getWebhookOrThrow(app, request.params.webhookId);
      return reply.send(ok(toOutboundWebhookDto(webhook)));
    }
  );

  server.patch(
    "/:webhookId",
    {
      config: { rateLimit: WEBHOOK_MANAGEMENT_RATE_LIMIT },
      schema: {
        params: OutboundWebhookIdParamSchema,
        body: UpdateOutboundWebhookRequestSchema,
        response: { 200: ApiSuccessSchema(OutboundWebhookSchema) },
      },
    },
    async (request, reply) => {
      const webhook = await updateWebhook(app, request.params.webhookId, request.body, actorFrom(request));
      return reply.send(ok(toOutboundWebhookDto(webhook)));
    }
  );

  server.delete(
    "/:webhookId",
    {
      config: { rateLimit: WEBHOOK_MANAGEMENT_RATE_LIMIT },
      schema: { params: OutboundWebhookIdParamSchema, response: { 204: z.undefined() } },
    },
    async (request, reply) => {
      await deleteWebhook(app, request.params.webhookId, actorFrom(request));
      return reply.code(204).send();
    }
  );

  server.post(
    "/:webhookId/rotate-secret",
    {
      config: { rateLimit: WEBHOOK_MANAGEMENT_RATE_LIMIT },
      schema: { params: OutboundWebhookIdParamSchema, response: { 200: ApiSuccessSchema(RotateWebhookSecretResponseSchema) } },
    },
    async (request, reply) => {
      const { webhook, plainSecret } = await rotateWebhookSecret(app, request.params.webhookId, actorFrom(request));
      return reply.send(ok({ webhook: toOutboundWebhookDto(webhook), plainSecret }));
    }
  );

  server.post(
    "/:webhookId/test",
    {
      config: { rateLimit: WEBHOOK_TEST_RATE_LIMIT },
      schema: { params: OutboundWebhookIdParamSchema, response: { 202: ApiSuccessSchema(EnqueueWebhookDeliveryResponseSchema) } },
    },
    async (request, reply) => {
      const result = await enqueueTestDelivery(app, request.params.webhookId, actorFrom(request));
      return reply.code(202).send(ok(result));
    }
  );

  server.get(
    "/:webhookId/deliveries",
    {
      schema: {
        params: OutboundWebhookIdParamSchema,
        querystring: ListWebhookDeliveriesQuerySchema,
        response: { 200: ApiSuccessSchema(z.array(WebhookDeliverySummarySchema)) },
      },
    },
    async (request, reply) => {
      const { cursor, limit, status, event } = request.query;
      const rows = await listDeliveries(app, request.params.webhookId, { cursorSeq: parseCursor(cursor), limit, status, event });
      return reply.send(ok(rows.map(toWebhookDeliverySummaryDto), buildPageMeta(rows, limit)));
    }
  );

  server.get(
    "/:webhookId/deliveries/:deliveryId",
    {
      schema: { params: WebhookDeliveryIdParamSchema, response: { 200: ApiSuccessSchema(WebhookDeliverySchema) } },
    },
    async (request, reply) => {
      const delivery = await getDeliveryOrThrow(app, request.params.webhookId, request.params.deliveryId);
      return reply.send(ok(toWebhookDeliveryDto(delivery)));
    }
  );

  server.post(
    "/:webhookId/deliveries/:deliveryId/redeliver",
    {
      config: { rateLimit: WEBHOOK_REDELIVER_RATE_LIMIT },
      schema: { params: WebhookDeliveryIdParamSchema, response: { 202: ApiSuccessSchema(EnqueueWebhookDeliveryResponseSchema) } },
    },
    async (request, reply) => {
      const result = await redeliverDelivery(app, request.params.webhookId, request.params.deliveryId, actorFrom(request));
      return reply.code(202).send(ok(result));
    }
  );
}
