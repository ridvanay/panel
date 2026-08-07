import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { authenticate } from "../../middleware/authenticate";
import { requireSiteRole } from "../../middleware/site-rbac";
import { ok } from "../../lib/envelope";
import { ApiSuccessSchema } from "../../schemas/common";
import { PublicSiteModuleSchema, SiteModuleSchema } from "../../schemas/entities";
import { toSiteModuleDto } from "../../mappers";
import { NotFoundError } from "../../lib/errors";
import { logAudit } from "../../lib/audit";
import { MODULE_REGISTRY, getModuleDefinition } from "../../lib/module-registry";
import { ModuleKeyParamSchema, UpdateModuleRequestSchema } from "./site-modules.schemas";

/**
 * §10.9 Eklenti/Modül Yönetimi — `/admin/modules` prefix'i altında bağlanır (authenticated).
 * GET herkes (ADMIN/EDITOR/VIEWER) görebilir, PATCH yalnızca ADMIN.
 */
export async function adminSiteModulesRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>();
  server.addHook("preHandler", authenticate);

  server.get(
    "/",
    {
      preHandler: requireSiteRole("ADMIN", "EDITOR", "VIEWER"),
      schema: { response: { 200: ApiSuccessSchema(z.array(SiteModuleSchema)) } },
    },
    async (_request, reply) => {
      // `MODULE_REGISTRY` (statik TANIM) ile `SiteModule` tablosundaki (varsa) durum
      // satırlarını LEFT JOIN mantığıyla birleştirir — bkz. mappers/index.ts::toSiteModuleDto.
      const rows = await app.prisma.siteModule.findMany({ include: { updatedBy: true } });
      const rowsByKey = new Map(rows.map((row) => [row.key, row]));

      const modules = MODULE_REGISTRY.map((definition) => toSiteModuleDto(definition, rowsByKey.get(definition.key) ?? null));
      return reply.send(ok(modules));
    }
  );

  server.patch(
    "/:key",
    {
      preHandler: requireSiteRole("ADMIN"),
      schema: {
        params: ModuleKeyParamSchema,
        body: UpdateModuleRequestSchema,
        response: { 200: ApiSuccessSchema(SiteModuleSchema) },
      },
    },
    async (request, reply) => {
      const definition = getModuleDefinition(request.params.key);
      if (!definition) throw new NotFoundError("Modül bulunamadı.");

      const { enabled } = request.body;
      const row = await app.prisma.siteModule.upsert({
        where: { key: definition.key },
        create: { key: definition.key, enabled, updatedById: request.user!.id },
        update: { enabled, updatedById: request.user!.id },
        include: { updatedBy: true },
      });

      await logAudit(app, {
        actorId: request.user!.id,
        actorEmail: request.user!.email,
        action: enabled ? "module.enable" : "module.disable",
        targetType: "SiteModule",
        targetId: definition.key,
        metadata: { key: definition.key, enabled },
        ipAddress: request.ip,
      });

      return reply.send(ok(toSiteModuleDto(definition, row)));
    }
  );
}

/** `/modules` prefix'i altında bağlanır — herkese açık (public sitenin nav/layout'u okur). */
export async function publicModulesRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>();

  server.get(
    "/",
    { schema: { response: { 200: ApiSuccessSchema(z.array(PublicSiteModuleSchema)) } } },
    async (_request, reply) => {
      const rows = await app.prisma.siteModule.findMany();
      const rowsByKey = new Map(rows.map((row) => [row.key, row]));

      const modules = MODULE_REGISTRY.map((definition) => ({
        key: definition.key,
        enabled: rowsByKey.get(definition.key)?.enabled ?? definition.defaultEnabled,
      }));
      return reply.send(ok(modules));
    }
  );
}
