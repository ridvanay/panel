import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { authenticate } from "../../middleware/authenticate";
import { requireSiteRole } from "../../middleware/site-rbac";
import { requirePanelAccess } from "../../middleware/panel-access";
import { ROLES_ADMIN_MANAGER } from "../../lib/site-roles";
import { ok } from "../../lib/envelope";
import { ApiSuccessSchema } from "../../schemas/common";
import { NotFoundError, ValidationError } from "../../lib/errors";
import { logAudit } from "../../lib/audit";
import { CONTACT_SUBMIT_RATE_LIMIT } from "../../lib/rate-limit";
import { absolutizeMediaUrl } from "../../mappers";
import { CACHE_TAGS, triggerTagRevalidation } from "../../lib/revalidate";
import { CONTACT_FORM_ID } from "./contact.constants";
import {
  CONTACT_PAGE_CONSENT_TEXTS,
  CONTACT_PAGE_LOCALES,
  ContactPageContentSchema,
  ContactPageLocaleContentSchema,
  ContactPageSubmissionBodySchema,
  TREATMENT_NOT_SURE,
  issueContactFormToken,
  localeContent,
  parseContactPageContent,
  submitContactPage,
  toWhatsAppDigits,
  type ContactPageContent,
} from "./contact-page";

const PublicContactPageSchema = z.object({
  locale: z.enum(CONTACT_PAGE_LOCALES),
  content: ContactPageLocaleContentSchema,
  /** Yalnızca rakamlar — `https://wa.me/<whatsappDigits>`. Boşsa WhatsApp gösterilmez. */
  whatsappDigits: z.string(),
  mapImageUrl: z.string().nullable(),
  mapUrl: z.string(),
  privacyPage: z.object({ slug: z.string(), localizedSlugs: z.record(z.string()) }).nullable(),
  consent: z.object({ notice: z.string(), explicit: z.string(), privacyLinkLabel: z.string() }),
  treatmentNotSure: z.literal(TREATMENT_NOT_SURE),
});

const AdminContactPageSchema = z.object({
  content: ContactPageContentSchema,
  mapImageUrl: z.string().nullable(),
});

async function mapImageUrlFor(app: FastifyInstance, mediaId: string | null): Promise<string | null> {
  if (!mediaId) return null;
  const media = await app.prisma.media.findUnique({ where: { id: mediaId }, select: { url: true, mimeType: true } });
  if (!media || !media.mimeType.startsWith("image/")) return null;
  return absolutizeMediaUrl(media.url);
}

async function readPageContent(app: FastifyInstance): Promise<ContactPageContent> {
  const row = await app.prisma.contactForm.findUnique({ where: { id: CONTACT_FORM_ID }, select: { pageContent: true } });
  return parseContactPageContent(row?.pageContent);
}

/** `/contact` prefix'i altında — herkese açık. */
export async function publicContactPageRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>();

  server.get(
    "/page",
    {
      schema: {
        querystring: z.object({ locale: z.string().max(10).optional() }),
        response: { 200: ApiSuccessSchema(PublicContactPageSchema) },
      },
    },
    async (request, reply) => {
      const row = await app.prisma.contactForm.findUnique({
        where: { id: CONTACT_FORM_ID },
        select: { isEnabled: true, pageContent: true, consentLegalPageId: true },
      });
      if (!row || !row.isEnabled) throw new NotFoundError("İletişim formu bulunamadı.");

      const locale = request.query.locale === "tr" ? "tr" : "en";
      const content = parseContactPageContent(row.pageContent);
      const localized = localeContent(content, locale);

      let privacyPage: z.infer<typeof PublicContactPageSchema>["privacyPage"] = null;
      if (row.consentLegalPageId) {
        const page = await app.prisma.page.findFirst({
          where: { id: row.consentLegalPageId, status: "PUBLISHED", deletedAt: null },
          select: { id: true, slug: true },
        });
        if (page) {
          const slugs = await app.prisma.contentSlug.findMany({
            where: { entityType: "PAGE", entityId: page.id },
            select: { locale: true, slug: true },
          });
          privacyPage = { slug: page.slug, localizedSlugs: Object.fromEntries(slugs.map((s) => [s.locale, s.slug])) };
        }
      }

      return reply.send(
        ok({
          locale,
          content: localized,
          whatsappDigits: toWhatsAppDigits(localized.whatsapp),
          mapImageUrl: await mapImageUrlFor(app, content.mapImageMediaId),
          mapUrl: content.mapUrl,
          privacyPage,
          consent: CONTACT_PAGE_CONSENT_TEXTS[locale],
          treatmentNotSure: TREATMENT_NOT_SURE,
        })
      );
    }
  );

  /** İmzalı zaman damgası — form açıldığında tarayıcı alır; önbelleğe ALINMAZ. */
  server.get(
    "/page/token",
    { schema: { response: { 200: ApiSuccessSchema(z.object({ token: z.string() })) } } },
    async (_request, reply) => {
      reply.header("Cache-Control", "no-store");
      return reply.send(ok({ token: issueContactFormToken() }));
    }
  );

  /**
   * Gönderim TARAYICIDAN doğrudan bu uca yapılır (Next.js sunucusu aracı değildir) — rate limit
   * (5/dk) gerçek ziyaretçi IP'sine göre işler (`request.ip`, `TRUST_PROXY` ayarına bağlı).
   */
  server.post(
    "/page-submissions",
    {
      config: { rateLimit: CONTACT_SUBMIT_RATE_LIMIT },
      schema: {
        body: ContactPageSubmissionBodySchema,
        response: { 201: ApiSuccessSchema(z.object({ id: z.string().uuid() })) },
      },
    },
    async (request, reply) => {
      const result = await submitContactPage(app, request.body, {
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"] ?? null,
      });
      return reply.code(201).send(ok(result));
    }
  );
}

/** `/admin/contact` prefix'i altında — okuma panel kapısı, yazma ADMIN/MANAGER (diğer iletişim ayarlarıyla aynı). */
export async function adminContactPageRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>();
  server.addHook("preHandler", authenticate);
  server.addHook("preHandler", requirePanelAccess());

  server.get("/page", { schema: { response: { 200: ApiSuccessSchema(AdminContactPageSchema) } } }, async (_request, reply) => {
    const content = await readPageContent(app);
    return reply.send(ok({ content, mapImageUrl: await mapImageUrlFor(app, content.mapImageMediaId) }));
  });

  server.put(
    "/page",
    {
      preHandler: requireSiteRole(...ROLES_ADMIN_MANAGER),
      schema: { body: ContactPageContentSchema, response: { 200: ApiSuccessSchema(AdminContactPageSchema) } },
    },
    async (request, reply) => {
      const content = request.body;
      if (content.mapImageMediaId) {
        const media = await app.prisma.media.findUnique({ where: { id: content.mapImageMediaId }, select: { mimeType: true } });
        if (!media) throw new NotFoundError("Medya bulunamadı.");
        if (!["image/png", "image/jpeg", "image/webp"].includes(media.mimeType)) {
          throw new ValidationError("Harita görseli yalnızca PNG, JPG veya WebP olabilir.", {
            mapImageMediaId: ["Harita görseli yalnızca PNG, JPG veya WebP olabilir."],
          });
        }
      }

      await app.prisma.contactForm.upsert({
        where: { id: CONTACT_FORM_ID },
        create: { id: CONTACT_FORM_ID, pageContent: content as Prisma.InputJsonObject, updatedById: request.user!.id },
        update: { pageContent: content as Prisma.InputJsonObject, updatedById: request.user!.id },
      });

      await logAudit(app, {
        actorId: request.user!.id,
        actorEmail: request.user!.email,
        action: "contact.page_update",
        targetType: "ContactForm",
        targetId: CONTACT_FORM_ID,
        // İletişim bilgileri kurumsal veridir (kişisel veri değil) — değişen dillerin listesi yazılır.
        metadata: { locales: Object.keys(content.locales), mapImage: Boolean(content.mapImageMediaId), mapUrl: Boolean(content.mapUrl) },
        ipAddress: request.ip,
      });
      await triggerTagRevalidation(app, [CACHE_TAGS.contactPage]);

      return reply.send(ok({ content, mapImageUrl: await mapImageUrlFor(app, content.mapImageMediaId) }));
    }
  );
}
