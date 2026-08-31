import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { authenticate } from "../../middleware/authenticate";
import { requireSiteRole } from "../../middleware/site-rbac";
import { requirePanelAccess } from "../../middleware/panel-access";
import { ROLES_ADMIN } from "../../lib/site-roles";
import { ok } from "../../lib/envelope";
import { ApiSuccessSchema } from "../../schemas/common";
import { DemoTemplateSummarySchema, DemoTemplateImportResultSchema } from "../../schemas/entities";
import { listDemoTemplateSummaries, importDemoTemplate } from "./importer";
import { DemoTemplateKeyParamSchema, ImportDemoTemplateRequestSchema } from "./demo-templates.schemas";

// openapi.yaml `POST /admin/demo-templates/{templateKey}/import` açıklaması — "Hız sınırı: 5
// istek / 1 dakika" (§6.3 gerekçesi: her çağrı ~6 dosya yazar ve uzun bir transaction açar).
const DEMO_TEMPLATE_IMPORT_RATE_LIMIT = { max: 5, timeWindow: "1 minute" };

/**
 * `/admin/demo-templates` prefix'i altında bağlanır (bkz. app.ts, appearance kayıtlarından
 * SONRA). `.claude/architect-scope-demo-template-import.md` §6.3 — okuma panel kapısı
 * (ADMIN/MANAGER/EDITOR, `requirePanelAccess()` yeterli — `appearance.routes.ts::GET /` ile AYNI
 * desen), yazma (`POST .../import`) YALNIZCA ADMIN (`ROLES_ADMIN` — ayrıcalık yükseltme yüzeyi,
 * `homePageId`/appearance/navigation/footer/social YAZAR).
 */
export async function adminDemoTemplatesRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>();
  server.addHook("preHandler", authenticate);
  server.addHook("preHandler", requirePanelAccess());

  server.get(
    "/",
    { schema: { response: { 200: ApiSuccessSchema(z.array(DemoTemplateSummarySchema)) } } },
    async (_request, reply) => {
      return reply.send(ok(await listDemoTemplateSummaries(app)));
    }
  );

  server.post(
    "/:templateKey/import",
    {
      preHandler: requireSiteRole(...ROLES_ADMIN),
      config: { rateLimit: DEMO_TEMPLATE_IMPORT_RATE_LIMIT },
      schema: {
        params: DemoTemplateKeyParamSchema,
        body: ImportDemoTemplateRequestSchema,
        response: { 201: ApiSuccessSchema(DemoTemplateImportResultSchema) },
      },
    },
    async (request, reply) => {
      const result = await importDemoTemplate(app, {
        templateKey: request.params.templateKey,
        body: request.body,
        actorId: request.user!.id,
        actorEmail: request.user!.email,
        ip: request.ip,
      });
      return reply.code(201).send(ok(result));
    }
  );
}
