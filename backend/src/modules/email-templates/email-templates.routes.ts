import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { authenticate } from "../../middleware/authenticate";
import { requireSiteRole } from "../../middleware/site-rbac";
import { ok } from "../../lib/envelope";
import { ApiSuccessSchema } from "../../schemas/common";
import { EmailTemplateSchema } from "../../schemas/entities";
import { toEmailTemplateDto } from "../../mappers";
import { NotFoundError } from "../../lib/errors";
import { logAudit } from "../../lib/audit";
import { renderTemplate } from "../../lib/template-render";
import {
  PreviewEmailTemplateRequestSchema,
  PreviewEmailTemplateResponseSchema,
  TemplateKeyParamSchema,
  UpdateEmailTemplateRequestSchema,
} from "./email-templates.schemas";

/**
 * `/admin/notifications/templates` prefix'i altında bağlanır (bkz. app.ts).
 * §10.3 gereği bu iletiler tüm kullanıcılara gidebildiği için tüm uçlar (GET dahil)
 * yalnızca `SiteRole=ADMIN` — `EDITOR` eşiği yetersiz.
 */
export async function emailTemplatesRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>();
  server.addHook("preHandler", authenticate);
  server.addHook("preHandler", requireSiteRole("ADMIN"));

  server.get(
    "/",
    { schema: { response: { 200: ApiSuccessSchema(z.array(EmailTemplateSchema)) } } },
    async (_request, reply) => {
      const rows = await app.prisma.emailTemplate.findMany({ orderBy: { seq: "asc" } });
      return reply.send(ok(rows.map(toEmailTemplateDto)));
    }
  );

  server.get(
    "/:key",
    { schema: { params: TemplateKeyParamSchema, response: { 200: ApiSuccessSchema(EmailTemplateSchema) } } },
    async (request, reply) => {
      const template = await app.prisma.emailTemplate.findUnique({ where: { key: request.params.key } });
      if (!template) throw new NotFoundError("Şablon bulunamadı.");
      return reply.send(ok(toEmailTemplateDto(template)));
    }
  );

  server.patch(
    "/:key",
    {
      schema: {
        params: TemplateKeyParamSchema,
        body: UpdateEmailTemplateRequestSchema,
        response: { 200: ApiSuccessSchema(EmailTemplateSchema) },
      },
    },
    async (request, reply) => {
      const template = await app.prisma.emailTemplate
        .update({
          where: { key: request.params.key },
          data: { ...request.body, updatedById: request.user!.id },
        })
        .catch(() => {
          throw new NotFoundError("Şablon bulunamadı.");
        });

      await logAudit(app, {
        actorId: request.user!.id,
        actorEmail: request.user!.email,
        action: "notifications.template_update",
        targetType: "EmailTemplate",
        targetId: request.params.key,
      });

      return reply.send(ok(toEmailTemplateDto(template)));
    }
  );

  server.post(
    "/:key/preview",
    {
      schema: {
        params: TemplateKeyParamSchema,
        body: PreviewEmailTemplateRequestSchema,
        response: { 200: ApiSuccessSchema(PreviewEmailTemplateResponseSchema) },
      },
    },
    async (request, reply) => {
      const template = await app.prisma.emailTemplate.findUnique({ where: { key: request.params.key } });
      if (!template) throw new NotFoundError("Şablon bulunamadı.");

      const allowedKeys = (template.availableVariables as string[]) ?? [];
      const renderedSubject = renderTemplate(template.subject, request.body.sampleValues, allowedKeys);
      const renderedHtml = renderTemplate(template.bodyHtml, request.body.sampleValues, allowedKeys);

      return reply.send(ok({ renderedSubject, renderedHtml }));
    }
  );
}
