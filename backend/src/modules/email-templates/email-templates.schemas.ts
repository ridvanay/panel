import { z } from "zod";

export const TemplateKeyParamSchema = z.object({
  key: z.string(),
});

export const UpdateEmailTemplateRequestSchema = z.object({
  subject: z.string().min(1).optional(),
  bodyHtml: z.string().optional(),
});

export const PreviewEmailTemplateRequestSchema = z.object({
  sampleValues: z.record(z.string(), z.string()),
});

export const PreviewEmailTemplateResponseSchema = z.object({
  renderedSubject: z.string(),
  renderedHtml: z.string(),
});
