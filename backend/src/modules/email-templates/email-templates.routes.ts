import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import type { EmailTemplatePurpose, Prisma } from "@prisma/client";
import { z } from "zod";
import { authenticate } from "../../middleware/authenticate";
import { requireSiteRole } from "../../middleware/site-rbac";
import { requirePanelAccess } from "../../middleware/panel-access";
import { ROLES_ADMIN_MANAGER } from "../../lib/site-roles";
import { ok } from "../../lib/envelope";
import { ApiSuccessSchema } from "../../schemas/common";
import { EmailTemplateSchema, EmailTemplateSummarySchema, EmailVariableDefinitionSchema } from "../../schemas/entities";
import { toEmailTemplateDto, toEmailTemplateSummaryDto } from "../../mappers";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../../lib/errors";
import { logAudit } from "../../lib/audit";
import { sendMail } from "../../lib/mail";
import { EMAIL_TEMPLATE_PREVIEW_RATE_LIMIT, EMAIL_TEST_SEND_RATE_LIMIT } from "../../lib/rate-limit";
import {
  assertCustomVariablesDoNotConflict,
  assertNoUndefinedVariables,
  getSystemVariablesForPurpose,
  resolveTemplateVariables,
  type EmailCustomVariable,
} from "../../lib/email-variables";
import { renderTemplatePreviewOrTest } from "./email-templates.service";
import {
  CreateEmailTemplateRequestSchema,
  EmailBlockInputSchema,
  EmailTemplateVariablesQuerySchema,
  ListEmailTemplatesQuerySchema,
  PreviewEmailTemplateRequestSchema,
  PreviewEmailTemplateResponseSchema,
  TemplateIdParamSchema,
  TestSendEmailTemplateRequestSchema,
  TestSendEmailTemplateResponseSchema,
  UpdateEmailTemplateRequestSchema,
} from "./email-templates.schemas";

type EmailBlockInput = z.infer<typeof EmailBlockInputSchema>;

/** `blocks` verilmediğinde sunucunun ürettiği generic başlangıç seti (§10.16.6 "amaca uygun bir başlangıç blok seti"). */
function buildDefaultBlocks(): EmailBlockInput[] {
  const baseStyle = { align: "left" as const, backgroundColor: null, textColor: null, paddingY: "md" as const, paddingX: "md" as const };
  return [
    {
      id: randomUUID(),
      type: "logo-header",
      style: { ...baseStyle, align: "center" },
      data: { useSiteLogo: true, logoUrl: null, height: 48 },
    },
    { id: randomUUID(), type: "heading", style: baseStyle, data: { text: "Başlık", level: 2 } },
    { id: randomUUID(), type: "text", style: baseStyle, data: { html: "<p>İçerik buraya gelecek.</p>" } },
  ];
}

/** `availableVariables` — salt bilgi amaçlı (§10.16.5), her yazmada registry'den TÜRETİLİR. */
function computeAvailableVariableKeys(purpose: EmailTemplatePurpose): string[] {
  return getSystemVariablesForPurpose(purpose).map((v) => v.key);
}

/**
 * Şablon metinlerindeki (`subject` + ilgili moddaki içerik) `{{...}}` doğrulaması için tarama
 * yüzeyi. `blocks` bütün olarak (JSON) taranır — hangi alanın "değişken kabul ettiği" belgeleme
 * amaçlıdır (bkz. openapi.yaml `EmailBlock`), taramanın kendisi daha basit ve güvenli olsun diye
 * TÜM metin alanlarına bakar (fazladan bir alanda `{{key}}` yakalamak zararsızdır, kaçırmak
 * zararlıdır).
 */
function collectTemplateTexts(subject: string, bodyHtml: string | undefined, blocks: unknown[] | undefined): string[] {
  const texts = [subject];
  if (bodyHtml) texts.push(bodyHtml);
  if (blocks && blocks.length > 0) texts.push(JSON.stringify(blocks));
  return texts;
}

/**
 * `/admin/notifications/templates` prefix'i altında bağlanır (bkz. app.ts).
 * `.claude/architect-scope-rbac-5-tier.md` §5.3 satır 5 — tüm uçlar (GET dahil) ADMIN + MANAGER.
 *
 * BREAKING (§10.16.6): adresleme artık `{key}` DEĞİL `{templateId}` (uuid) — kullanıcı
 * şablonlarının `key`'i yoktur (`null`).
 */
export async function emailTemplatesRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>();
  server.addHook("preHandler", authenticate);
  server.addHook("preHandler", requirePanelAccess());
  server.addHook("preHandler", requireSiteRole(...ROLES_ADMIN_MANAGER));

  server.get(
    "/",
    {
      schema: {
        querystring: ListEmailTemplatesQuerySchema,
        response: { 200: ApiSuccessSchema(z.array(EmailTemplateSummarySchema)) },
      },
    },
    async (request, reply) => {
      const { purpose, isActive } = request.query;
      const rows = await app.prisma.emailTemplate.findMany({
        where: {
          ...(purpose ? { purpose } : {}),
          ...(isActive !== undefined ? { isActive } : {}),
        },
        orderBy: { seq: "asc" },
      });
      return reply.send(ok(rows.map(toEmailTemplateSummaryDto)));
    }
  );

  server.post(
    "/",
    {
      schema: { body: CreateEmailTemplateRequestSchema, response: { 201: ApiSuccessSchema(EmailTemplateSchema) } },
    },
    async (request, reply) => {
      const { name, purpose, subject, blocks } = request.body;
      const finalSubject = subject ?? name;
      const finalBlocks = blocks && blocks.length > 0 ? blocks : buildDefaultBlocks();

      const definitions = await resolveTemplateVariables(app, purpose, []);
      assertNoUndefinedVariables(collectTemplateTexts(finalSubject, undefined, finalBlocks), new Set(definitions.map((d) => d.key)));

      const created = await app.prisma.emailTemplate.create({
        data: {
          name,
          purpose,
          // §10.16.6 — yeni şablonlar HER ZAMAN BLOCKS olarak oluşturulur (RAW oluşturulamaz).
          editorMode: "BLOCKS",
          isSystem: false,
          isActive: false,
          key: null,
          subject: finalSubject,
          bodyHtml: "",
          blocks: finalBlocks as Prisma.InputJsonValue,
          availableVariables: computeAvailableVariableKeys(purpose),
          customVariables: [],
          updatedById: request.user!.id,
        },
      });

      await logAudit(app, {
        actorId: request.user!.id,
        actorEmail: request.user!.email,
        action: "notifications.template_create",
        targetType: "EmailTemplate",
        targetId: created.id,
        ipAddress: request.ip,
      });

      const variables = await resolveTemplateVariables(app, created.purpose, []);
      return reply.code(201).send(ok(toEmailTemplateDto(created, variables)));
    }
  );

  server.get(
    "/variables",
    {
      schema: {
        querystring: EmailTemplateVariablesQuerySchema,
        response: { 200: ApiSuccessSchema(z.array(EmailVariableDefinitionSchema)) },
      },
    },
    async (request, reply) => {
      const variables = await resolveTemplateVariables(app, request.query.purpose, []);
      return reply.send(ok(variables));
    }
  );

  server.post(
    "/preview",
    {
      // Güvenlik denetimi bulgusu (security-agent) — bu uç önceden route-level bir rate limit'e
      // sahip değildi (bkz. lib/rate-limit.ts::EMAIL_TEMPLATE_PREVIEW_RATE_LIMIT gerekçesi).
      config: { rateLimit: EMAIL_TEMPLATE_PREVIEW_RATE_LIMIT },
      schema: {
        body: PreviewEmailTemplateRequestSchema,
        response: { 200: ApiSuccessSchema(PreviewEmailTemplateResponseSchema) },
      },
    },
    async (request, reply) => {
      const body = request.body;
      const rendered = await renderTemplatePreviewOrTest(
        app,
        {
          purpose: body.purpose,
          editorMode: body.editorMode,
          subject: body.subject,
          bodyHtml: body.bodyHtml,
          blocks: body.blocks,
          customVariables: body.customVariables,
        },
        body.sampleValues ?? {}
      );
      return reply.send(ok(rendered));
    }
  );

  // `templateId` DAİMA `z.string().uuid()` ile doğrulanır (bkz. TemplateIdParamSchema) — statik
  // `/variables`/`/preview` segmentleri Fastify radix router'da bu parametreli rotayla ASLA
  // çakışmaz (statik segment önceliklidir), ama yine de savunma amaçlı.
  server.get(
    "/:templateId",
    { schema: { params: TemplateIdParamSchema, response: { 200: ApiSuccessSchema(EmailTemplateSchema) } } },
    async (request, reply) => {
      const template = await app.prisma.emailTemplate.findUnique({ where: { id: request.params.templateId } });
      if (!template) throw new NotFoundError("Şablon bulunamadı.");

      const variables = await resolveTemplateVariables(app, template.purpose, (template.customVariables as unknown as EmailCustomVariable[]) ?? []);
      return reply.send(ok(toEmailTemplateDto(template, variables)));
    }
  );

  server.patch(
    "/:templateId",
    {
      schema: {
        params: TemplateIdParamSchema,
        body: UpdateEmailTemplateRequestSchema,
        response: { 200: ApiSuccessSchema(EmailTemplateSchema) },
      },
    },
    async (request, reply) => {
      const existing = await app.prisma.emailTemplate.findUnique({ where: { id: request.params.templateId } });
      if (!existing) throw new NotFoundError("Şablon bulunamadı.");

      const { name, subject, bodyHtml, blocks, customVariables, isActive } = request.body;

      if (bodyHtml !== undefined && existing.editorMode !== "RAW") {
        throw new ValidationError("bodyHtml yalnızca editorMode=RAW şablonlarda kabul edilir.", {
          bodyHtml: ["Bu şablon BLOCKS modundadır — 'blocks' alanını kullanın."],
        });
      }
      if (blocks !== undefined && existing.editorMode !== "BLOCKS") {
        throw new ValidationError("blocks yalnızca editorMode=BLOCKS şablonlarda kabul edilir.", {
          blocks: ["Bu şablon RAW modundadır — 'bodyHtml' alanını kullanın."],
        });
      }
      if (customVariables !== undefined) {
        assertCustomVariablesDoNotConflict(customVariables, existing.purpose);
      }
      // qa-agent bulgusu (2026-08-17) — kullanılabilirlik kilitlenmesi düzeltmesi: `purpose != CUSTOM`
      // şablonlarda aktiflik YALNIZCA `/activate`'in transaction'ı ile değişir (§10.16.3 teklik
      // kuralı — DB'deki kısmi unique index bu davranışa dayanır). `purpose = CUSTOM`'da teklik
      // kuralı UYGULANMADIĞI için burada transaction'a gerek YOKTUR; bu alan olmadan bir CUSTOM
      // şablon bir kez aktif edildikten sonra ASLA deaktif/silinemiyordu (kalıcı kilitlenme —
      // DELETE `isActive=true` iken koşulsuz 409 döner).
      if (isActive !== undefined && existing.purpose !== "CUSTOM") {
        throw new ValidationError("isActive yalnızca purpose=CUSTOM şablonlarda bu uçtan değiştirilebilir.", {
          isActive: ["Bu şablonun amacı CUSTOM değil — aktifleştirmek için POST .../activate kullanın."],
        });
      }

      const finalCustomVariables = customVariables ?? ((existing.customVariables as unknown as EmailCustomVariable[]) ?? []);
      const definitions = await resolveTemplateVariables(app, existing.purpose, finalCustomVariables);
      const allowedKeys = new Set(definitions.map((d) => d.key));

      const finalSubject = subject ?? existing.subject;
      const finalBodyHtml = existing.editorMode === "RAW" ? (bodyHtml ?? existing.bodyHtml) : undefined;
      const finalBlocks = existing.editorMode === "BLOCKS" ? ((blocks as unknown[] | undefined) ?? (existing.blocks as unknown[])) : undefined;

      assertNoUndefinedVariables(collectTemplateTexts(finalSubject, finalBodyHtml, finalBlocks), allowedKeys);

      const updated = await app.prisma.emailTemplate.update({
        where: { id: existing.id },
        data: {
          ...(name !== undefined ? { name } : {}),
          ...(subject !== undefined ? { subject } : {}),
          ...(bodyHtml !== undefined ? { bodyHtml } : {}),
          ...(blocks !== undefined ? { blocks: blocks as Prisma.InputJsonValue } : {}),
          ...(customVariables !== undefined ? { customVariables: customVariables as Prisma.InputJsonValue } : {}),
          // Yukarıdaki doğrulama sayesinde bu satıra yalnızca purpose=CUSTOM iken ulaşılabilir.
          ...(isActive !== undefined ? { isActive } : {}),
          availableVariables: computeAvailableVariableKeys(existing.purpose),
          updatedById: request.user!.id,
        },
      });

      await logAudit(app, {
        actorId: request.user!.id,
        actorEmail: request.user!.email,
        action: "notifications.template_update",
        targetType: "EmailTemplate",
        targetId: updated.id,
        ipAddress: request.ip,
      });

      const responseVariables = await resolveTemplateVariables(app, updated.purpose, (updated.customVariables as unknown as EmailCustomVariable[]) ?? []);
      return reply.send(ok(toEmailTemplateDto(updated, responseVariables)));
    }
  );

  server.delete(
    "/:templateId",
    { schema: { params: TemplateIdParamSchema, response: { 204: z.undefined() } } },
    async (request, reply) => {
      const existing = await app.prisma.emailTemplate.findUnique({ where: { id: request.params.templateId } });
      if (!existing) throw new NotFoundError("Şablon bulunamadı.");
      if (existing.isSystem) throw new ForbiddenError("Sistem şablonu silinemez.");
      if (existing.isActive) throw new ConflictError("Aktif şablon silinemez — önce başka bir şablonu aktifleştirin.");

      await app.prisma.emailTemplate.delete({ where: { id: existing.id } });

      await logAudit(app, {
        actorId: request.user!.id,
        actorEmail: request.user!.email,
        action: "notifications.template_delete",
        targetType: "EmailTemplate",
        targetId: existing.id,
        ipAddress: request.ip,
      });

      return reply.code(204).send();
    }
  );

  server.post(
    "/:templateId/activate",
    { schema: { params: TemplateIdParamSchema, response: { 200: ApiSuccessSchema(EmailTemplateSchema) } } },
    async (request, reply) => {
      const existing = await app.prisma.emailTemplate.findUnique({ where: { id: request.params.templateId } });
      if (!existing) throw new NotFoundError("Şablon bulunamadı.");

      // §10.16.3 — servis katmanı transaction'ı: önce aynı amacın diğer satırları pasifleştirilir,
      // sonra hedef aktifleştirilir. `purpose=CUSTOM` iken teklik kuralı UYGULANMAZ (DB'deki kısmi
      // unique index de bu satırları hariç tutar, bkz. db-agent migration notu §10.16.3).
      const updated = await app.prisma.$transaction(async (tx) => {
        if (existing.purpose !== "CUSTOM") {
          await tx.emailTemplate.updateMany({
            where: { purpose: existing.purpose, isActive: true, id: { not: existing.id } },
            data: { isActive: false },
          });
        }
        return tx.emailTemplate.update({ where: { id: existing.id }, data: { isActive: true } });
      });

      await logAudit(app, {
        actorId: request.user!.id,
        actorEmail: request.user!.email,
        action: "notifications.template_activate",
        targetType: "EmailTemplate",
        targetId: updated.id,
        ipAddress: request.ip,
      });

      const variables = await resolveTemplateVariables(app, updated.purpose, (updated.customVariables as unknown as EmailCustomVariable[]) ?? []);
      return reply.send(ok(toEmailTemplateDto(updated, variables)));
    }
  );

  server.post(
    "/:templateId/duplicate",
    { schema: { params: TemplateIdParamSchema, response: { 201: ApiSuccessSchema(EmailTemplateSchema) } } },
    async (request, reply) => {
      const existing = await app.prisma.emailTemplate.findUnique({ where: { id: request.params.templateId } });
      if (!existing) throw new NotFoundError("Şablon bulunamadı.");

      const created = await app.prisma.emailTemplate.create({
        data: {
          name: `${existing.name} (kopya)`,
          purpose: existing.purpose,
          editorMode: existing.editorMode,
          isSystem: false,
          isActive: false,
          key: null,
          subject: existing.subject,
          bodyHtml: existing.bodyHtml,
          blocks: existing.blocks as Prisma.InputJsonValue,
          availableVariables: existing.availableVariables as Prisma.InputJsonValue,
          customVariables: existing.customVariables as Prisma.InputJsonValue,
          updatedById: request.user!.id,
        },
      });

      await logAudit(app, {
        actorId: request.user!.id,
        actorEmail: request.user!.email,
        action: "notifications.template_duplicate",
        targetType: "EmailTemplate",
        targetId: created.id,
        ipAddress: request.ip,
      });

      const variables = await resolveTemplateVariables(app, created.purpose, (created.customVariables as unknown as EmailCustomVariable[]) ?? []);
      return reply.code(201).send(ok(toEmailTemplateDto(created, variables)));
    }
  );

  server.post(
    "/:templateId/test-send",
    {
      config: { rateLimit: EMAIL_TEST_SEND_RATE_LIMIT },
      schema: {
        params: TemplateIdParamSchema,
        body: TestSendEmailTemplateRequestSchema,
        response: { 200: ApiSuccessSchema(TestSendEmailTemplateResponseSchema) },
      },
    },
    async (request, reply) => {
      const template = await app.prisma.emailTemplate.findUnique({ where: { id: request.params.templateId } });
      if (!template) throw new NotFoundError("Şablon bulunamadı.");

      const rendered = await renderTemplatePreviewOrTest(
        app,
        {
          purpose: template.purpose,
          editorMode: template.editorMode,
          subject: template.subject,
          bodyHtml: template.bodyHtml,
          blocks: template.blocks as unknown[],
          customVariables: (template.customVariables as unknown as EmailCustomVariable[]) ?? [],
        },
        request.body?.sampleValues ?? {}
      );

      // §10.16.6 bağlayıcı güvenlik kararı — `to` gövdeden ASLA okunmaz, alıcı HER ZAMAN isteği
      // yapan kullanıcının kendi e-postasıdır (spam-relay/phishing vektörünü kapatır).
      // `sendMail` SMTP hatasında `EmailDeliveryError` (502) fırlatır — burada YAKALANMAZ, aynen yükselir.
      const result = await sendMail(app, { to: request.user!.email, subject: rendered.renderedSubject, html: rendered.renderedHtml });

      // Audit metadata'sına alıcı adresi YAZILMAZ (PII yasağı) — `actorEmail` zaten kayıtta.
      await logAudit(app, {
        actorId: request.user!.id,
        actorEmail: request.user!.email,
        action: "notifications.template_test_send",
        targetType: "EmailTemplate",
        targetId: template.id,
        ipAddress: request.ip,
      });

      return reply.send(ok({ sentTo: request.user!.email, messageId: result.messageId, previewUrl: result.previewUrl ?? null }));
    }
  );
}
