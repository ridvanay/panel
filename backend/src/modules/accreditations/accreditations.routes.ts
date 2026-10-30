import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { authenticate } from "../../middleware/authenticate";
import { requireSiteRole } from "../../middleware/site-rbac";
import { requirePanelAccess } from "../../middleware/panel-access";
import { ROLES_ADMIN, ROLES_ADMIN_MANAGER } from "../../lib/site-roles";
import { ok } from "../../lib/envelope";
import { ApiSuccessSchema, LocaleQuerySchema } from "../../schemas/common";
import { NotFoundError, ValidationError } from "../../lib/errors";
import { logAudit } from "../../lib/audit";
import { CACHE_TAGS, triggerTagRevalidation } from "../../lib/revalidate";
import { getLocaleSet } from "../../lib/localization";
import { resolveContentLocaleCode } from "../../lib/entity-translations";
import {
  ACCREDITATION_LOGO_MIME_TYPES,
  AccreditationIdParamSchema,
  AdminAccreditationSchema,
  CreateAccreditationRequestSchema,
  PublicAccreditationSchema,
  UpdateAccreditationRequestSchema,
  activationError,
  isPubliclyVisible,
  parseDateOnly,
  toAdminAccreditationDto,
  toPublicAccreditationDto,
} from "./accreditations.lib";

const INCLUDE_LOGO = { logoMedia: { select: { url: true, altText: true } } } as const;
const ORDER: Prisma.AccreditationBadgeOrderByWithRelationInput[] = [{ sortOrder: "asc" }, { seq: "asc" }];

async function assertLogoMedia(app: FastifyInstance, mediaId: string) {
  const media = await app.prisma.media.findUnique({ where: { id: mediaId }, select: { mimeType: true } });
  if (!media) throw new NotFoundError("Medya bulunamadı.");
  if (!ACCREDITATION_LOGO_MIME_TYPES.has(media.mimeType)) {
    throw new ValidationError("Logo yalnızca PNG, JPG veya WebP olabilir.", { logoMediaId: ["Logo yalnızca PNG, JPG veya WebP olabilir."] });
  }
}

function assertActivation(state: { isActive: boolean; certificateNo: string | null | undefined }) {
  const error = activationError(state);
  if (error) throw new ValidationError(error, { certificateNo: [error] });
}

/** `/accreditations` — herkese açık; yalnızca sitede görünen (aktif + belge no + süresi geçmemiş) belgeler. */
export async function publicAccreditationsRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>();
  server.get(
    "/",
    { schema: { querystring: LocaleQuerySchema, response: { 200: ApiSuccessSchema(z.array(PublicAccreditationSchema)) } } },
    async (request, reply) => {
      const rows = await app.prisma.accreditationBadge.findMany({
        where: { isActive: true, certificateNo: { not: null } },
        include: INCLUDE_LOGO,
        orderBy: ORDER,
      });
      const locale = resolveContentLocaleCode(await getLocaleSet(app), request.query.locale ?? "");
      const now = new Date();
      return reply.send(ok(rows.filter((r) => isPubliclyVisible(r, now)).map((r) => toPublicAccreditationDto(r, locale))));
    }
  );
}

/**
 * `/admin/accreditations` — "Yetki Belgeleri ve Akreditasyonlar". Okuma ADMIN/MANAGER; yazma YALNIZCA
 * ADMIN (sitede resmi yetki iddiası). Her yazma audit kaydına düşer ve site önbelleğini yeniler.
 */
export async function adminAccreditationsRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>();
  server.addHook("preHandler", authenticate);
  server.addHook("preHandler", requirePanelAccess());

  server.get(
    "/",
    { preHandler: requireSiteRole(...ROLES_ADMIN_MANAGER), schema: { response: { 200: ApiSuccessSchema(z.array(AdminAccreditationSchema)) } } },
    async (_request, reply) => {
      const rows = await app.prisma.accreditationBadge.findMany({ include: INCLUDE_LOGO, orderBy: ORDER });
      const now = new Date();
      return reply.send(ok(rows.map((r) => toAdminAccreditationDto(r, now))));
    }
  );

  server.post(
    "/",
    {
      preHandler: requireSiteRole(...ROLES_ADMIN),
      schema: { body: CreateAccreditationRequestSchema, response: { 201: ApiSuccessSchema(AdminAccreditationSchema) } },
    },
    async (request, reply) => {
      const body = request.body;
      if (body.logoMediaId) await assertLogoMedia(app, body.logoMediaId);
      const certificateNo = body.certificateNo?.trim() || null;
      assertActivation({ isActive: body.isActive ?? false, certificateNo });
      const row = await app.prisma.accreditationBadge.create({
        data: {
          name: body.name,
          issuer: body.issuer,
          logoMediaId: body.logoMediaId ?? null,
          certificateNo,
          verificationUrl: body.verificationUrl ?? null,
          validUntil: parseDateOnly(body.validUntil) ?? null,
          translations: (body.translations ?? {}) as Prisma.InputJsonValue,
          sortOrder: body.sortOrder ?? 0,
          isActive: body.isActive ?? false,
        },
        include: INCLUDE_LOGO,
      });
      await logAudit(app, {
        actorId: request.user!.id,
        actorEmail: request.user!.email,
        action: "accreditation.create",
        targetType: "AccreditationBadge",
        targetId: row.id,
        metadata: { name: row.name, certificateNo: row.certificateNo, isActive: row.isActive },
        ipAddress: request.ip,
      });
      await triggerTagRevalidation(app, [CACHE_TAGS.accreditations]);
      return reply.status(201).send(ok(toAdminAccreditationDto(row)));
    }
  );

  server.patch(
    "/:id",
    {
      preHandler: requireSiteRole(...ROLES_ADMIN),
      schema: { params: AccreditationIdParamSchema, body: UpdateAccreditationRequestSchema, response: { 200: ApiSuccessSchema(AdminAccreditationSchema) } },
    },
    async (request, reply) => {
      const existing = await app.prisma.accreditationBadge.findUnique({ where: { id: request.params.id } });
      if (!existing) throw new NotFoundError("Belge bulunamadı.");
      const body = request.body;
      if (body.logoMediaId) await assertLogoMedia(app, body.logoMediaId);
      const certificateNo = body.certificateNo === undefined ? existing.certificateNo : body.certificateNo?.trim() || null;
      const isActive = body.isActive ?? existing.isActive;
      assertActivation({ isActive, certificateNo });

      const row = await app.prisma.accreditationBadge.update({
        where: { id: existing.id },
        data: {
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.issuer !== undefined ? { issuer: body.issuer } : {}),
          ...(body.logoMediaId !== undefined ? { logoMediaId: body.logoMediaId } : {}),
          ...(body.certificateNo !== undefined ? { certificateNo } : {}),
          ...(body.verificationUrl !== undefined ? { verificationUrl: body.verificationUrl } : {}),
          ...(body.validUntil !== undefined ? { validUntil: parseDateOnly(body.validUntil) } : {}),
          ...(body.translations !== undefined ? { translations: body.translations as Prisma.InputJsonValue } : {}),
          ...(body.sortOrder !== undefined ? { sortOrder: body.sortOrder } : {}),
          ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
        },
        include: INCLUDE_LOGO,
      });
      await logAudit(app, {
        actorId: request.user!.id,
        actorEmail: request.user!.email,
        action: "accreditation.update",
        targetType: "AccreditationBadge",
        targetId: row.id,
        metadata: {
          before: { name: existing.name, certificateNo: existing.certificateNo, isActive: existing.isActive, validUntil: existing.validUntil },
          after: { name: row.name, certificateNo: row.certificateNo, isActive: row.isActive, validUntil: row.validUntil },
        },
        ipAddress: request.ip,
      });
      await triggerTagRevalidation(app, [CACHE_TAGS.accreditations]);
      return reply.send(ok(toAdminAccreditationDto(row)));
    }
  );

  server.delete(
    "/:id",
    { preHandler: requireSiteRole(...ROLES_ADMIN), schema: { params: AccreditationIdParamSchema, response: { 204: z.undefined() } } },
    async (request, reply) => {
      const existing = await app.prisma.accreditationBadge.findUnique({ where: { id: request.params.id } });
      if (!existing) throw new NotFoundError("Belge bulunamadı.");
      await app.prisma.accreditationBadge.delete({ where: { id: existing.id } });
      await logAudit(app, {
        actorId: request.user!.id,
        actorEmail: request.user!.email,
        action: "accreditation.delete",
        targetType: "AccreditationBadge",
        targetId: existing.id,
        metadata: { name: existing.name, certificateNo: existing.certificateNo },
        ipAddress: request.ip,
      });
      await triggerTagRevalidation(app, [CACHE_TAGS.accreditations]);
      return reply.status(204).send();
    }
  );
}
