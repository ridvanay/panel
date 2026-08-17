import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { authenticate } from "../../middleware/authenticate";
import { requireSiteRole } from "../../middleware/site-rbac";
import { ok } from "../../lib/envelope";
import { ApiSuccessSchema } from "../../schemas/common";
import {
  ContactFormFieldSchema,
  ContactFormSchema,
  ContactSubmissionSchema,
  ContactSubmissionSummarySchema,
  CreateContactSubmissionResponseSchema,
  PublicContactFormSchema,
} from "../../schemas/entities";
import {
  toContactFormDto,
  toContactFormFieldDto,
  toContactSubmissionDto,
  toContactSubmissionSummaryDto,
  toPublicContactFormDto,
} from "../../mappers";
import { NotFoundError, ValidationError } from "../../lib/errors";
import { logAudit } from "../../lib/audit";
import { parseCursor, encodeCursor } from "../../lib/pagination";
import { CONTACT_SUBMIT_RATE_LIMIT } from "../../lib/rate-limit";
import { CONTACT_FORM_ID, CONTACT_SYSTEM_FIELD_KEYS } from "./contact.constants";
import { submitContactForm } from "./contact.service";
import {
  CreateContactSubmissionRequestSchema,
  ListContactSubmissionsQuerySchema,
  ReplaceContactFormFieldsRequestSchema,
  SubmissionIdParamSchema,
  UpdateContactFormRequestSchema,
  UpdateContactSubmissionRequestSchema,
} from "./contact.schemas";

/** `SiteSettings`/`SiteAppearance` ile AYNI lazy-upsert deseni — satır yoksa varsayılanlar döner, DB'ye YAZILMAZ. */
const CONTACT_FORM_DEFAULTS = {
  title: "İletişim",
  description: null as string | null,
  submitLabel: "Gönder",
  successMessage: "Mesajınız alındı. En kısa sürede dönüş yapacağız.",
  isEnabled: true,
  notifyEmail: null as string | null,
  notificationTemplateId: null as string | null,
  consentRequired: true,
  consentText: "",
  consentLegalPageId: null as string | null,
  retentionDays: 180,
};

async function readContactFormRow(app: FastifyInstance) {
  return app.prisma.contactForm.findUnique({
    where: { id: CONTACT_FORM_ID },
    include: { fields: { orderBy: { order: "asc" } } },
  });
}

async function readContactFormDto(app: FastifyInstance) {
  const row = await readContactFormRow(app);
  if (row) return toContactFormDto(row);
  return { id: CONTACT_FORM_ID, ...CONTACT_FORM_DEFAULTS, fields: [], updatedAt: new Date().toISOString() };
}

async function assertValidNotificationTemplateId(app: FastifyInstance, id: string | null | undefined): Promise<void> {
  if (!id) return;
  const exists = await app.prisma.emailTemplate.findUnique({ where: { id }, select: { id: true } });
  if (!exists) throw new ValidationError("notificationTemplateId geçersiz.", { notificationTemplateId: ["Şablon bulunamadı."] });
}

async function assertValidConsentLegalPageId(app: FastifyInstance, id: string | null | undefined): Promise<void> {
  if (!id) return;
  const exists = await app.prisma.page.findUnique({ where: { id }, select: { id: true } });
  if (!exists) throw new ValidationError("consentLegalPageId geçersiz.", { consentLegalPageId: ["Sayfa bulunamadı."] });
}

/**
 * `/admin/contact` prefix'i altında bağlanır (bkz. app.ts). Form yapılandırması/alan yönetimi
 * yalnızca ADMIN; gönderim okuma ADMIN VEYA EDITOR (§10.16.8).
 */
export async function adminContactRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>();
  server.addHook("preHandler", authenticate);

  server.get(
    "/form",
    { preHandler: requireSiteRole("ADMIN"), schema: { response: { 200: ApiSuccessSchema(ContactFormSchema) } } },
    async (_request, reply) => {
      return reply.send(ok(await readContactFormDto(app)));
    }
  );

  server.patch(
    "/form",
    {
      preHandler: requireSiteRole("ADMIN"),
      schema: { body: UpdateContactFormRequestSchema, response: { 200: ApiSuccessSchema(ContactFormSchema) } },
    },
    async (request, reply) => {
      await assertValidNotificationTemplateId(app, request.body.notificationTemplateId);
      await assertValidConsentLegalPageId(app, request.body.consentLegalPageId);

      await app.prisma.contactForm.upsert({
        where: { id: CONTACT_FORM_ID },
        create: { id: CONTACT_FORM_ID, ...CONTACT_FORM_DEFAULTS, ...request.body, updatedById: request.user!.id },
        update: { ...request.body, updatedById: request.user!.id },
      });

      // Audit metadata'sına değişen alan ADLARI yazılır, DEĞERLERİ DEĞİL (openapi.yaml notu).
      await logAudit(app, {
        actorId: request.user!.id,
        actorEmail: request.user!.email,
        action: "contact.form_update",
        targetType: "ContactForm",
        targetId: CONTACT_FORM_ID,
        metadata: { changed: Object.keys(request.body) },
        ipAddress: request.ip,
      });

      return reply.send(ok(await readContactFormDto(app)));
    }
  );

  server.put(
    "/form/fields",
    {
      preHandler: requireSiteRole("ADMIN"),
      schema: { body: ReplaceContactFormFieldsRequestSchema, response: { 200: ApiSuccessSchema(z.array(ContactFormFieldSchema)) } },
    },
    async (request, reply) => {
      // Zod şeması yalnızca "üç sistem anahtarı mevcut mu" kontrol eder; `type` DEĞİŞMEMİŞ mi
      // kontrolü MEVCUT DB durumunu bilmeyi gerektirdiğinden BURADA yapılır.
      const currentSystemFields = await app.prisma.contactFormField.findMany({ where: { formId: CONTACT_FORM_ID, isSystem: true } });
      const currentTypeByKey = new Map(currentSystemFields.map((field) => [field.key, field.type]));

      for (const field of request.body.fields) {
        const currentType = currentTypeByKey.get(field.key);
        if (currentType && currentType !== field.type) {
          throw new ValidationError(`Sistem alanı '${field.key}' türü değiştirilemez.`, {
            fields: [`'${field.key}' türü (${currentType}) değiştirilemez.`],
          });
        }
      }

      await app.prisma.$transaction(async (tx) => {
        await tx.contactForm.upsert({
          where: { id: CONTACT_FORM_ID },
          create: { id: CONTACT_FORM_ID, ...CONTACT_FORM_DEFAULTS },
          update: {},
        });
        await tx.contactFormField.deleteMany({ where: { formId: CONTACT_FORM_ID } });
        await tx.contactFormField.createMany({
          data: request.body.fields.map((field, index) => ({
            formId: CONTACT_FORM_ID,
            order: index,
            key: field.key,
            label: field.label,
            type: field.type,
            required: field.required,
            placeholder: field.placeholder ?? null,
            helpText: field.helpText ?? null,
            maxLength: field.maxLength ?? null,
            options: (field.options ?? []) as Prisma.InputJsonValue,
            isSystem: (CONTACT_SYSTEM_FIELD_KEYS as readonly string[]).includes(field.key),
          })),
        });
      });

      const fields = await app.prisma.contactFormField.findMany({ where: { formId: CONTACT_FORM_ID }, orderBy: { order: "asc" } });

      await logAudit(app, {
        actorId: request.user!.id,
        actorEmail: request.user!.email,
        action: "contact.fields_update",
        targetType: "ContactForm",
        targetId: CONTACT_FORM_ID,
        metadata: { fieldCount: fields.length },
        ipAddress: request.ip,
      });

      return reply.send(ok(fields.map(toContactFormFieldDto)));
    }
  );

  server.get(
    "/submissions",
    {
      preHandler: requireSiteRole("ADMIN", "EDITOR"),
      schema: {
        querystring: ListContactSubmissionsQuerySchema,
        response: { 200: ApiSuccessSchema(z.array(ContactSubmissionSummarySchema)) },
      },
    },
    async (request, reply) => {
      const { cursor, limit, status, q } = request.query;
      const cursorSeq = parseCursor(cursor);

      const where: Prisma.ContactSubmissionWhereInput = {
        formId: CONTACT_FORM_ID,
        ...(cursorSeq ? { seq: { lt: cursorSeq } } : {}),
        ...(status ? { status } : {}),
        ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { email: { contains: q, mode: "insensitive" } }] } : {}),
      };

      // `seq DESC` (en yeni önce) — bkz. openapi.yaml `GET /admin/contact/submissions`.
      const rows = await app.prisma.contactSubmission.findMany({ where, orderBy: { seq: "desc" }, take: limit });
      const nextCursor = rows.length === limit ? encodeCursor(rows[rows.length - 1]!.seq) : null;

      return reply.send(ok(rows.map(toContactSubmissionSummaryDto), { nextCursor }));
    }
  );

  server.get(
    "/submissions/:submissionId",
    {
      preHandler: requireSiteRole("ADMIN", "EDITOR"),
      schema: { params: SubmissionIdParamSchema, response: { 200: ApiSuccessSchema(ContactSubmissionSchema) } },
    },
    async (request, reply) => {
      // Yan etkisizdir — okundu İŞARETLEMEZ (bkz. openapi.yaml notu, önyükleme/prefetch güvenliği).
      const submission = await app.prisma.contactSubmission.findUnique({ where: { id: request.params.submissionId } });
      if (!submission) throw new NotFoundError("Gönderim bulunamadı.");
      return reply.send(ok(toContactSubmissionDto(submission)));
    }
  );

  server.patch(
    "/submissions/:submissionId",
    {
      preHandler: requireSiteRole("ADMIN", "EDITOR"),
      schema: {
        params: SubmissionIdParamSchema,
        body: UpdateContactSubmissionRequestSchema,
        response: { 200: ApiSuccessSchema(ContactSubmissionSchema) },
      },
    },
    async (request, reply) => {
      const existing = await app.prisma.contactSubmission.findUnique({ where: { id: request.params.submissionId } });
      if (!existing) throw new NotFoundError("Gönderim bulunamadı.");

      const becomingRead = request.body.status === "READ" && existing.status !== "READ";

      const updated = await app.prisma.contactSubmission.update({
        where: { id: existing.id },
        data: {
          status: request.body.status,
          ...(becomingRead ? { readAt: new Date(), readById: request.user!.id } : {}),
        },
      });

      // Audit metadata'sına ziyaretçi adı/e-postası/mesajı YAZILMAZ — yalnızca durum geçişi (§10.16.8).
      await logAudit(app, {
        actorId: request.user!.id,
        actorEmail: request.user!.email,
        action: "contact.submission_status_change",
        targetType: "ContactSubmission",
        targetId: updated.id,
        metadata: { from: existing.status, to: updated.status },
        ipAddress: request.ip,
      });

      return reply.send(ok(toContactSubmissionDto(updated)));
    }
  );

  server.delete(
    "/submissions/:submissionId",
    { preHandler: requireSiteRole("ADMIN"), schema: { params: SubmissionIdParamSchema, response: { 204: z.undefined() } } },
    async (request, reply) => {
      const existing = await app.prisma.contactSubmission.findUnique({ where: { id: request.params.submissionId } });
      if (!existing) throw new NotFoundError("Gönderim bulunamadı.");

      await app.prisma.contactSubmission.delete({ where: { id: existing.id } });

      // KVKK silme talebinin (veri sahibi hakkı) karşılığı — geri alınamaz, çöp kutusu YOKTUR.
      await logAudit(app, {
        actorId: request.user!.id,
        actorEmail: request.user!.email,
        action: "contact.submission_delete",
        targetType: "ContactSubmission",
        targetId: existing.id,
        ipAddress: request.ip,
      });

      return reply.code(204).send();
    }
  );
}

/** `/contact` prefix'i altında bağlanır — herkese açık, kimlik doğrulama YOK (§10.16.8). */
export async function publicContactRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>();

  server.get("/form", { schema: { response: { 200: ApiSuccessSchema(PublicContactFormSchema) } } }, async (_request, reply) => {
    const row = await readContactFormRow(app);
    // `isEnabled=false` (ya da hiç yapılandırılmamışsa varsayılan `true` olsa da satır YOKSA form
    // fiilen kullanılamaz) → 404. İç yapılandırma (`notifyEmail`/`notificationTemplateId`/
    // `retentionDays`) YANITTA YOKTUR (bkz. `toPublicContactFormDto`).
    if (!row || !row.isEnabled) throw new NotFoundError("İletişim formu bulunamadı.");

    const consentLegalPage = row.consentLegalPageId
      ? await app.prisma.page.findFirst({
          where: { id: row.consentLegalPageId, status: "PUBLISHED", deletedAt: null },
          select: { title: true, slug: true },
        })
      : null;

    return reply.send(ok(toPublicContactFormDto(row, consentLegalPage)));
  });

  server.post(
    "/submissions",
    {
      config: { rateLimit: CONTACT_SUBMIT_RATE_LIMIT },
      schema: { body: CreateContactSubmissionRequestSchema, response: { 201: ApiSuccessSchema(CreateContactSubmissionResponseSchema) } },
    },
    async (request, reply) => {
      const result = await submitContactForm(app, {
        values: request.body.values,
        consent: request.body.consent,
        website: request.body.website,
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"] ?? null,
      });

      return reply.code(201).send(ok(result));
    }
  );
}
