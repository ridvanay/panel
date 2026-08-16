import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { authenticate } from "../../middleware/authenticate";
import { requireSiteRole } from "../../middleware/site-rbac";
import { ok } from "../../lib/envelope";
import { ApiSuccessSchema } from "../../schemas/common";
import { ApiKeySchema, CreateApiKeyResponseSchema } from "../../schemas/entities";
import { toApiKeyDto } from "../../mappers";
import { parseCursor, buildPageMeta } from "../../lib/pagination";
import { API_KEY_MANAGEMENT_RATE_LIMIT } from "../../lib/rate-limit";
import { createApiKey, listApiKeys, updateApiKey, revokeApiKey, deleteApiKey } from "./api-keys.service";
import { ApiKeyIdParamSchema, CreateApiKeyRequestSchema, ListApiKeysQuerySchema, UpdateApiKeyRequestSchema } from "./api-keys.schemas";

/**
 * `/admin/settings/api-keys` prefix'i altında bağlanır (bkz. app.ts). §10.13.10 — TÜM uçlar
 * İSTİSNASIZ yalnızca `SiteRole=ADMIN`'dir (OKUMA DAHİL). Bir API anahtarı listesi (adlar,
 * ön ekler, scope'lar) saldırı yüzeyi haritasıdır.
 */
export async function apiKeysRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>();
  server.addHook("preHandler", authenticate);
  server.addHook("preHandler", requireSiteRole("ADMIN"));

  server.get(
    "/",
    {
      schema: {
        querystring: ListApiKeysQuerySchema,
        response: { 200: ApiSuccessSchema(z.array(ApiKeySchema)) },
      },
    },
    async (request, reply) => {
      const { cursor, limit, status } = request.query;
      const cursorSeq = parseCursor(cursor);

      const rows = await listApiKeys(app, { cursorSeq, limit, status });

      return reply.send(ok(rows.map(toApiKeyDto), buildPageMeta(rows, limit)));
    }
  );

  server.post(
    "/",
    {
      config: { rateLimit: API_KEY_MANAGEMENT_RATE_LIMIT },
      schema: { body: CreateApiKeyRequestSchema, response: { 201: ApiSuccessSchema(CreateApiKeyResponseSchema) } },
    },
    async (request, reply) => {
      const { apiKey, plainKey } = await createApiKey(app, request.body, {
        id: request.user!.id,
        email: request.user!.email,
        ip: request.ip,
      });

      return reply.code(201).send(ok({ apiKey: toApiKeyDto(apiKey), plainKey }));
    }
  );

  server.patch(
    "/:keyId",
    {
      config: { rateLimit: API_KEY_MANAGEMENT_RATE_LIMIT },
      schema: {
        params: ApiKeyIdParamSchema,
        body: UpdateApiKeyRequestSchema,
        response: { 200: ApiSuccessSchema(ApiKeySchema) },
      },
    },
    async (request, reply) => {
      const apiKey = await updateApiKey(app, request.params.keyId, request.body, {
        id: request.user!.id,
        email: request.user!.email,
        ip: request.ip,
      });
      return reply.send(ok(toApiKeyDto(apiKey)));
    }
  );

  server.post(
    "/:keyId/revoke",
    {
      config: { rateLimit: API_KEY_MANAGEMENT_RATE_LIMIT },
      schema: { params: ApiKeyIdParamSchema, response: { 200: ApiSuccessSchema(ApiKeySchema) } },
    },
    async (request, reply) => {
      const apiKey = await revokeApiKey(app, request.params.keyId, {
        id: request.user!.id,
        email: request.user!.email,
        ip: request.ip,
      });
      return reply.send(ok(toApiKeyDto(apiKey)));
    }
  );

  server.delete(
    "/:keyId",
    {
      config: { rateLimit: API_KEY_MANAGEMENT_RATE_LIMIT },
      schema: { params: ApiKeyIdParamSchema, response: { 204: z.undefined() } },
    },
    async (request, reply) => {
      await deleteApiKey(app, request.params.keyId, { id: request.user!.id, email: request.user!.email, ip: request.ip });
      return reply.code(204).send();
    }
  );
}
