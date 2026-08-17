import { z } from "zod";
import { ContactFieldTypeSchema, ContactSubmissionStatusSchema, EMAIL_CUSTOM_VARIABLE_KEY_PATTERN } from "../../schemas/entities";
import { CursorQuerySchema } from "../../schemas/common";
import { CONTACT_SYSTEM_FIELD_KEYS } from "./contact.constants";

export const SubmissionIdParamSchema = z.object({
  submissionId: z.string().uuid(),
});

export const UpdateContactFormRequestSchema = z.object({
  title: z.string().min(1).max(120).optional(),
  description: z.string().nullable().optional(),
  submitLabel: z.string().min(1).max(60).optional(),
  successMessage: z.string().min(1).max(500).optional(),
  isEnabled: z.boolean().optional(),
  notifyEmail: z.string().email().nullable().optional(),
  notificationTemplateId: z.string().uuid().nullable().optional(),
  consentRequired: z.boolean().optional(),
  consentText: z.string().max(2000).optional(),
  consentLegalPageId: z.string().uuid().nullable().optional(),
  retentionDays: z.number().int().min(0).max(3650).optional(),
});

const ContactFormFieldOptionInputSchema = z.object({
  value: z.string(),
  label: z.string(),
});

const ContactFormFieldInputSchema = z.object({
  key: z.string().regex(EMAIL_CUSTOM_VARIABLE_KEY_PATTERN),
  label: z.string().min(1).max(120),
  type: ContactFieldTypeSchema,
  required: z.boolean().default(false),
  placeholder: z.string().nullable().optional(),
  helpText: z.string().nullable().optional(),
  maxLength: z.number().int().min(1).max(10000).nullable().optional(),
  options: z.array(ContactFormFieldOptionInputSchema).optional().default([]),
});

/**
 * `PUT /admin/navigation` deseniyle AYNI tam-değiştirme (full replace). Doğrulama (§10.16.8):
 * `key`'ler TEKİL olmalı; üç sistem alanının (`name`,`email`,`message`) HEPSİ bulunmalı ve
 * `type`'ları DEĞİŞMEMİŞ olmalıdır — sistem alanını silme/tip değiştirme denemesi SESSİZCE YOK
 * SAYILMAZ, açıkça 422 verir.
 */
export const ReplaceContactFormFieldsRequestSchema = z.object({
  fields: z
    .array(ContactFormFieldInputSchema)
    .max(30)
    .superRefine((fields, ctx) => {
      const seenKeys = new Set<string>();
      for (const field of fields) {
        if (seenKeys.has(field.key)) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: `'${field.key}' anahtarı birden fazla kez kullanılmış.` });
        }
        seenKeys.add(field.key);
      }

      for (const systemKey of CONTACT_SYSTEM_FIELD_KEYS) {
        if (!seenKeys.has(systemKey)) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Sistem alanı '${systemKey}' listeden çıkarılamaz.` });
        }
      }
    }),
});

export const ListContactSubmissionsQuerySchema = CursorQuerySchema.extend({
  status: ContactSubmissionStatusSchema.optional(),
  q: z.string().min(1).optional(),
});

export const UpdateContactSubmissionRequestSchema = z.object({
  status: ContactSubmissionStatusSchema,
});

/**
 * PUBLIC — bkz. openapi.yaml `CreateContactSubmissionRequest` (honeypot dahil, §10.16.9).
 *
 * GÜVENLİK DÜZELTMESİ (security-agent denetimi) — `website` (honeypot) alanı önceden
 * `z.string().optional()` idi, YANİ üst sınırsızdı. `values` gövdesi servis katmanında 32 KB'a
 * sınırlansa da (`contact.service.ts::CONTACT_SUBMISSION_VALUES_MAX_BYTES`) bu kontrol
 * YALNIZCA `values` alanına bakar — `website` alanı bu ölçümün DIŞINDA kalır. Bu uç PUBLIC +
 * kimliksizdir ve global `bodyLimit` (~5 MB, bkz. app.ts) tek başına yeterli değildir: kimliksiz
 * bir istemci `CONTACT_SUBMIT_RATE_LIMIT` (5/dk) içinde tekrarlanan ~5 MB'lık `website` gövdeleri
 * göndererek gereksiz JSON parse/bellek maliyeti oluşturabilirdi (honeypot değeri hiçbir zaman
 * DB'ye YAZILMAZ — `contact.service.ts::collectSpamValues` yalnızca `values` alanlarını 5000
 * karaktere kısaltır, `website`'in kendisini hiç saklamaz — bu yüzden risk depolama değil,
 * gereksiz istek işleme maliyetidir). Gerçek bir honeypot değeri (boş ya da botun doldurduğu
 * kısa bir metin) hiçbir zaman birkaç yüz karakteri aşmaz; 2000 karakter cömert bir üst sınırdır.
 */
export const CreateContactSubmissionRequestSchema = z.object({
  values: z.record(z.string(), z.string()),
  consent: z.boolean().optional(),
  website: z.string().max(2000).optional(),
});
