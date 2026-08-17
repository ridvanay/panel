import { z } from "zod";
import {
  buildEmailBlockSchema,
  EMAIL_BLOCKS_MAX,
  EmailCustomVariableSchema,
  EmailTemplateEditorModeSchema,
  EmailTemplatePurposeSchema,
} from "../../schemas/entities";

/**
 * YAZMA (request) tarafındaki stil şeması — `schemas/entities.ts::EmailBlockStyleSchema`
 * (YANIT, tüm alanlar zorunlu) İLE KARIŞTIRILMAMALI. Burada tüm alanlar `.default(...)`'lıdır —
 * istemci hiç `style` göndermese dahi (ya da yalnızca birkaç alan gönderse) makul varsayılanlarla
 * tamamlanır (openapi.yaml `EmailBlockStyle.default` alanlarıyla uyumlu).
 */
const EmailBlockStyleInputSchema = z.object({
  align: z.enum(["left", "center", "right"]).default("left"),
  backgroundColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .nullable()
    .default(null),
  textColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .nullable()
    .default(null),
  paddingY: z.enum(["none", "sm", "md", "lg"]).default("md"),
  paddingX: z.enum(["none", "sm", "md", "lg"]).default("md"),
});

/** `schemas/entities.ts::buildEmailBlockSchema` — AYNI 7 `data` şeklinden üretilir, kod tekrarı YOK. */
export const EmailBlockInputSchema = buildEmailBlockSchema(EmailBlockStyleInputSchema);

/** `blocks` gövdesi en fazla 256 KB (§10.16.4) — Fastify'ın global `bodyLimit`'i TÜM istek gövdesine
 * bakar (uploads için 5MB+'a ayarlı), bu yüzden `blocks` alanına özel bir üst sınır AYRICA gerekir. */
const EMAIL_BLOCKS_MAX_BYTES = 256 * 1024;

export const EmailBlockListInputSchema = z
  .array(EmailBlockInputSchema)
  .max(EMAIL_BLOCKS_MAX)
  .superRefine((blocks, ctx) => {
    const byteLength = Buffer.byteLength(JSON.stringify(blocks), "utf8");
    if (byteLength > EMAIL_BLOCKS_MAX_BYTES) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `blocks gövdesi en fazla ${EMAIL_BLOCKS_MAX_BYTES / 1024} KB olabilir.` });
    }
  });

export const TemplateIdParamSchema = z.object({
  templateId: z.string().uuid(),
});

export const ListEmailTemplatesQuerySchema = z.object({
  purpose: EmailTemplatePurposeSchema.optional(),
  isActive: z.coerce.boolean().optional(),
});

export const EmailTemplateVariablesQuerySchema = z.object({
  purpose: EmailTemplatePurposeSchema,
});

export const CreateEmailTemplateRequestSchema = z.object({
  name: z.string().min(1).max(120),
  purpose: EmailTemplatePurposeSchema,
  subject: z.string().min(1).max(200).optional(),
  blocks: EmailBlockListInputSchema.optional(),
});

/**
 * `bodyHtml` YALNIZCA `editorMode=RAW`, `blocks` YALNIZCA `BLOCKS` şablonda kabul edilir — bu
 * kural şema SEVİYESİNDE ifade EDİLEMEZ (mevcut satırın `editorMode`'unu bilmek gerekir), route
 * handler'da uygulanır (bkz. email-templates.routes.ts). `purpose`/`editorMode`/`key`/`isSystem`/
 * `availableVariables` bu şemada YOKTUR — bu uçtan DEĞİŞTİRİLEMEZ.
 *
 * `isActive` (qa-agent bulgusu, 2026-08-17 — kullanılabilirlik kilitlenmesi düzeltmesi):
 * yalnızca `purpose=CUSTOM` şablonlarda route handler'da KABUL EDİLİR (`purpose != CUSTOM`
 * şablonlarda 422 — o durumda aktiflik yalnızca `/activate`'in transaction'ı ile değişir, bkz.
 * §10.16.3 teklik kuralı). CUSTOM'da teklik kuralı UYGULANMADIĞI için (birden çok CUSTOM şablon
 * aynı anda aktif olabilir) burada bir transaction'a gerek yoktur. Bu alan olmadan bir CUSTOM
 * şablon bir kez aktif edildikten sonra ASLA deaktif/silinemiyordu (DELETE `isActive=true` iken
 * koşulsuz 409 döner) — kalıcı bir kilitlenmeydi.
 */
export const UpdateEmailTemplateRequestSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  subject: z.string().min(1).max(200).optional(),
  bodyHtml: z.string().optional(),
  blocks: EmailBlockListInputSchema.optional(),
  customVariables: z.array(EmailCustomVariableSchema).max(20).optional(),
  isActive: z.boolean().optional(),
});

export const PreviewEmailTemplateRequestSchema = z.object({
  purpose: EmailTemplatePurposeSchema,
  editorMode: EmailTemplateEditorModeSchema,
  subject: z.string(),
  blocks: EmailBlockListInputSchema.optional(),
  bodyHtml: z.string().optional(),
  customVariables: z.array(EmailCustomVariableSchema).max(20).optional(),
  sampleValues: z.record(z.string(), z.string()).optional(),
});

export const PreviewEmailTemplateResponseSchema = z.object({
  renderedSubject: z.string(),
  renderedHtml: z.string(),
});

/** `to` alanı BİLİNÇLİ OLARAK YOKTUR — alıcı her zaman `request.user.email` (§10.16.6). */
export const TestSendEmailTemplateRequestSchema = z.object({
  sampleValues: z.record(z.string(), z.string()).optional(),
});

export const TestSendEmailTemplateResponseSchema = z.object({
  sentTo: z.string().email(),
  messageId: z.string(),
  previewUrl: z.string().nullable().optional(),
});
