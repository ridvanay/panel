import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import type { PortfolioItem } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { authenticate } from "../../middleware/authenticate";
import { requireSiteRole } from "../../middleware/site-rbac";
import { requireModuleEnabled } from "../../middleware/module-guard";
import { ok } from "../../lib/envelope";
import { ApiSuccessSchema, ApiSuccessWithMeta, CursorQuerySchema } from "../../schemas/common";
import { ContentListMetaSchema, PortfolioCategorySchema, PortfolioItemSchema } from "../../schemas/entities";
import { toPortfolioCategoryDto, toPortfolioItemDto } from "../../mappers";
import { ConflictError, NotFoundError } from "../../lib/errors";
import { parseCursor, buildPageMeta, buildPageMetaWithCounts } from "../../lib/pagination";
import { slugify } from "../../lib/slug";
import { snapshotBeforeUpdate } from "../../lib/content-revisions";
import { getPortfolioItemContentCounts } from "../../lib/content-counts";
import { resolveAuthorId } from "../../lib/content-author";
import { logAudit } from "../../lib/audit";
import { sanitizeRichHtml } from "../../lib/html-sanitize";
import { sanitizePortfolioTranslations } from "./lib/sanitize-content";
import {
  AddPortfolioImageRequestSchema,
  CreatePortfolioCategoryRequestSchema,
  CreatePortfolioItemRequestSchema,
  ListPortfolioItemsQuerySchema,
  PortfolioCategoryIdParamSchema,
  PortfolioImageIdParamSchema,
  PortfolioItemIdParamSchema,
  PortfolioItemSlugParamSchema,
  UpdatePortfolioCategoryRequestSchema,
  UpdatePortfolioItemRequestSchema,
} from "./portfolio.schemas";

/** Portföy öğesi detay/liste sorgularında kategori + kapak görseli + galeri + yazar özetini de dönmek için. */
const WITH_RELATIONS = {
  category: true,
  coverMedia: true,
  author: true,
  images: { include: { media: true }, orderBy: { order: "asc" as const } },
} as const;

/** Güncellemeden HEMEN ÖNCEKİ alan setini döner (bkz. products.routes.ts::toProductSnapshot). */
function toPortfolioItemSnapshot(item: PortfolioItem): Record<string, unknown> {
  return {
    title: item.title,
    slug: item.slug,
    summary: item.summary,
    contentHtml: item.contentHtml,
    clientName: item.clientName,
    projectUrl: item.projectUrl,
    completedAt: item.completedAt,
    order: item.order,
    categoryId: item.categoryId,
    coverMediaId: item.coverMediaId,
    seoTitle: item.seoTitle,
    seoDescription: item.seoDescription,
    ogTitle: item.ogTitle,
    ogImageUrl: item.ogImageUrl,
    canonicalUrl: item.canonicalUrl,
    noIndex: item.noIndex,
    translations: item.translations,
  };
}

/** `/admin/portfolio` prefix'i altında bağlanır (bkz. app.ts) — tüm durumlar (taslak dahil), authenticated. */
export async function adminPortfolioRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>();
  server.addHook("preHandler", authenticate);

  server.get(
    "/",
    {
      schema: {
        querystring: ListPortfolioItemsQuerySchema,
        response: { 200: ApiSuccessWithMeta(z.array(PortfolioItemSchema), ContentListMetaSchema) },
      },
    },
    async (request, reply) => {
      const { cursor, limit, trashed, status, search } = request.query;
      const cursorSeq = parseCursor(cursor);

      const where: Prisma.PortfolioItemWhereInput = {
        ...(cursorSeq ? { seq: { gt: cursorSeq } } : {}),
        ...(status ? { status } : {}),
        ...(trashed === "exclude" ? { deletedAt: null } : trashed === "only" ? { deletedAt: { not: null } } : {}),
        ...(search
          ? {
              OR: [
                { title: { contains: search, mode: "insensitive" } },
                { clientName: { contains: search, mode: "insensitive" } },
              ],
            }
          : {}),
      };

      const [rows, counts] = await Promise.all([
        app.prisma.portfolioItem.findMany({ where, orderBy: { seq: "asc" }, take: limit, include: WITH_RELATIONS }),
        getPortfolioItemContentCounts(app.prisma),
      ]);

      return reply.send(ok(rows.map(toPortfolioItemDto), buildPageMetaWithCounts(rows, limit, counts)));
    }
  );

  server.post(
    "/",
    {
      preHandler: requireSiteRole("ADMIN", "EDITOR"),
      schema: { body: CreatePortfolioItemRequestSchema, response: { 201: ApiSuccessSchema(PortfolioItemSchema) } },
    },
    async (request, reply) => {
      const {
        title,
        slug,
        summary,
        contentHtml,
        clientName,
        projectUrl,
        completedAt,
        order,
        status,
        categoryId,
        coverMediaId,
        seoTitle,
        seoDescription,
        ogTitle,
        ogImageUrl,
        canonicalUrl,
        noIndex,
        translations,
        scheduledAt,
      } = request.body;

      const resolvedAuthorId = await resolveAuthorId(app, request.body.authorId, request.user!);
      const authorId = resolvedAuthorId === undefined ? request.user!.id : resolvedAuthorId;

      const item = await app.prisma.portfolioItem.create({
        data: {
          title,
          slug: slug ? slugify(slug) : slugify(title),
          summary,
          // Stored-XSS koruması: EDITOR de yazabildiği için (ADMIN'den daha az güvenilir bir rol)
          // içerik DB'ye yazılmadan önce sanitize edilir — public sitede `dangerouslySetInnerHTML`
          // ile doğrudan render edilir (bkz. lib/html-sanitize.ts).
          contentHtml: sanitizeRichHtml(contentHtml),
          clientName: clientName ?? undefined,
          projectUrl: projectUrl ?? undefined,
          completedAt: completedAt ? new Date(completedAt) : undefined,
          order: order ?? undefined,
          status: status ?? "DRAFT",
          categoryId: categoryId ?? undefined,
          coverMediaId: coverMediaId ?? undefined,
          authorId,
          seoTitle,
          seoDescription,
          ogTitle,
          ogImageUrl,
          canonicalUrl,
          noIndex,
          translations: (translations ? sanitizePortfolioTranslations(translations) : {}) as Prisma.InputJsonValue,
          publishedAt: status === "PUBLISHED" ? new Date() : null,
          // Faz 4 (zamanlanmış yayın) — `CreatePortfolioItemRequestSchema`'nın `refine`'ı zaten
          // `status === "SCHEDULED"` iken `scheduledAt`'in gelecekte dolu olmasını garanti eder.
          scheduledAt: status === "SCHEDULED" && scheduledAt ? new Date(scheduledAt) : null,
        },
        include: WITH_RELATIONS,
      });

      return reply.code(201).send(ok(toPortfolioItemDto(item)));
    }
  );

  server.get(
    "/:itemId",
    { schema: { params: PortfolioItemIdParamSchema, response: { 200: ApiSuccessSchema(PortfolioItemSchema) } } },
    async (request, reply) => {
      // Çöpteki öğeyi de döner (geri yükleme/onay ekranları için) — deletedAt filtresi YOK.
      const item = await app.prisma.portfolioItem.findUnique({
        where: { id: request.params.itemId },
        include: WITH_RELATIONS,
      });
      if (!item) throw new NotFoundError("Portföy öğesi bulunamadı.");
      return reply.send(ok(toPortfolioItemDto(item)));
    }
  );

  server.patch(
    "/:itemId",
    {
      preHandler: requireSiteRole("ADMIN", "EDITOR"),
      schema: {
        params: PortfolioItemIdParamSchema,
        body: UpdatePortfolioItemRequestSchema,
        response: { 200: ApiSuccessSchema(PortfolioItemSchema) },
      },
    },
    async (request, reply) => {
      const existing = await app.prisma.portfolioItem.findUnique({ where: { id: request.params.itemId } });
      if (!existing) throw new NotFoundError("Portföy öğesi bulunamadı.");

      if (existing.deletedAt) {
        throw new ConflictError("Çöpteki içerik düzenlenemez. Önce geri yükleyin.");
      }

      await snapshotBeforeUpdate(app, "PORTFOLIO_ITEM", existing.id, toPortfolioItemSnapshot(existing), request.user!.id);

      const { slug, translations, authorId: requestedAuthorId, scheduledAt, completedAt, ...rest } = request.body;
      const resolvedAuthorId = await resolveAuthorId(app, requestedAuthorId, request.user!);

      // Stored-XSS koruması: gelen çeviriler merge'den ÖNCE sanitize edilir (mevcut kayıttaki
      // çeviriler zaten sanitize edilmiş halde DB'de duruyor — bkz. lib/html-sanitize.ts).
      const sanitizedTranslations = translations !== undefined ? sanitizePortfolioTranslations(translations) : undefined;

      const mergedTranslations =
        sanitizedTranslations !== undefined
          ? {
              ...((existing.translations as Record<string, Record<string, unknown>>) ?? {}),
              ...Object.fromEntries(
                Object.entries(sanitizedTranslations).map(([locale, fields]) => [
                  locale,
                  { ...(((existing.translations as Record<string, Record<string, unknown>>) ?? {})[locale] ?? {}), ...fields },
                ])
              ),
            }
          : undefined;

      const item = await app.prisma.portfolioItem.update({
        where: { id: request.params.itemId },
        data: {
          ...rest,
          ...(rest.contentHtml !== undefined ? { contentHtml: sanitizeRichHtml(rest.contentHtml) } : {}),
          ...(slug !== undefined ? { slug: slugify(slug) } : {}),
          ...(completedAt !== undefined ? { completedAt: completedAt ? new Date(completedAt) : null } : {}),
          ...(mergedTranslations !== undefined ? { translations: mergedTranslations as Prisma.InputJsonValue } : {}),
          ...(rest.status === "PUBLISHED" && !existing.publishedAt ? { publishedAt: new Date() } : {}),
          // Faz 4 (zamanlanmış yayın) — yalnızca bu istekte `status` GÖNDERİLMİŞSE dokunulur.
          ...(rest.status !== undefined
            ? { scheduledAt: rest.status === "SCHEDULED" && scheduledAt ? new Date(scheduledAt) : null }
            : {}),
          ...(resolvedAuthorId !== undefined ? { authorId: resolvedAuthorId } : {}),
        },
        include: WITH_RELATIONS,
      });

      return reply.send(ok(toPortfolioItemDto(item)));
    }
  );

  // §10.7 İçerik Yönetim Listesi — ÇÖPE TAŞI (soft-delete), KALICI SİLMEZ. İdempotenttir.
  server.delete(
    "/:itemId",
    {
      preHandler: requireSiteRole("ADMIN", "EDITOR"),
      schema: { params: PortfolioItemIdParamSchema, response: { 204: z.undefined() } },
    },
    async (request, reply) => {
      const existing = await app.prisma.portfolioItem.findUnique({ where: { id: request.params.itemId } });
      if (!existing) throw new NotFoundError("Portföy öğesi bulunamadı.");

      if (!existing.deletedAt) {
        await app.prisma.portfolioItem.update({ where: { id: existing.id }, data: { deletedAt: new Date() } });

        await logAudit(app, {
          actorId: request.user!.id,
          actorEmail: request.user!.email,
          action: "portfolio_item.trash",
          targetType: "PortfolioItem",
          targetId: existing.id,
          ipAddress: request.ip,
        });
      }

      return reply.code(204).send();
    }
  );

  // §10.7 — çöpten geri yükle. `status` DEĞİŞMEZ. İdempotenttir. Revizyon "restore"u İLE KARIŞTIRILMAMALI.
  server.post(
    "/:itemId/restore",
    {
      preHandler: requireSiteRole("ADMIN", "EDITOR"),
      schema: { params: PortfolioItemIdParamSchema, response: { 200: ApiSuccessSchema(PortfolioItemSchema) } },
    },
    async (request, reply) => {
      const existing = await app.prisma.portfolioItem.findUnique({ where: { id: request.params.itemId } });
      if (!existing) throw new NotFoundError("Portföy öğesi bulunamadı.");

      if (existing.deletedAt) {
        await app.prisma.portfolioItem.update({ where: { id: existing.id }, data: { deletedAt: null } });

        await logAudit(app, {
          actorId: request.user!.id,
          actorEmail: request.user!.email,
          action: "portfolio_item.restore",
          targetType: "PortfolioItem",
          targetId: existing.id,
          ipAddress: request.ip,
        });
      }

      const item = await app.prisma.portfolioItem.findUnique({ where: { id: existing.id }, include: WITH_RELATIONS });
      return reply.send(ok(toPortfolioItemDto(item!)));
    }
  );

  // §10.7 — KALICI sil (yalnızca ADMIN). Kayıt ÖNCE çöpte olmalı, değilse 409.
  server.delete(
    "/:itemId/permanent",
    {
      preHandler: requireSiteRole("ADMIN"),
      schema: { params: PortfolioItemIdParamSchema, response: { 204: z.undefined() } },
    },
    async (request, reply) => {
      const existing = await app.prisma.portfolioItem.findUnique({ where: { id: request.params.itemId } });
      if (!existing) throw new NotFoundError("Portföy öğesi bulunamadı.");
      if (!existing.deletedAt) throw new ConflictError("Kalıcı silmeden önce içeriği çöpe taşıyın.");

      await app.prisma.$transaction([
        app.prisma.contentRevision.deleteMany({ where: { entityType: "PORTFOLIO_ITEM", entityId: existing.id } }),
        app.prisma.portfolioItem.delete({ where: { id: existing.id } }),
      ]);

      await logAudit(app, {
        actorId: request.user!.id,
        actorEmail: request.user!.email,
        action: "portfolio_item.permanent_delete",
        targetType: "PortfolioItem",
        targetId: existing.id,
        ipAddress: request.ip,
      });

      return reply.code(204).send();
    }
  );

  // Galeriye görsel ekle — aynı `mediaId` zaten galerideyse 409 (bkz. `@@unique([portfolioItemId, mediaId])`).
  server.post(
    "/:itemId/images",
    {
      preHandler: requireSiteRole("ADMIN", "EDITOR"),
      schema: {
        params: PortfolioItemIdParamSchema,
        body: AddPortfolioImageRequestSchema,
        response: { 201: ApiSuccessSchema(PortfolioItemSchema) },
      },
    },
    async (request, reply) => {
      const item = await app.prisma.portfolioItem.findUnique({ where: { id: request.params.itemId } });
      if (!item) throw new NotFoundError("Portföy öğesi bulunamadı.");

      const media = await app.prisma.media.findUnique({ where: { id: request.body.mediaId } });
      if (!media) throw new NotFoundError("Medya bulunamadı.");

      const existingImage = await app.prisma.portfolioImage.findUnique({
        where: { portfolioItemId_mediaId: { portfolioItemId: item.id, mediaId: media.id } },
      });
      if (existingImage) throw new ConflictError("Bu görsel zaten portföy öğesinin galerisinde.");

      const lastImage = await app.prisma.portfolioImage.findFirst({
        where: { portfolioItemId: item.id },
        orderBy: { order: "desc" },
      });

      await app.prisma.portfolioImage.create({
        data: { portfolioItemId: item.id, mediaId: media.id, order: lastImage ? lastImage.order + 1 : 0 },
      });

      const updated = await app.prisma.portfolioItem.findUnique({ where: { id: item.id }, include: WITH_RELATIONS });
      return reply.code(201).send(ok(toPortfolioItemDto(updated!)));
    }
  );

  // Galeriden görsel kaldır — `imageId`'nin GERÇEKTEN bu öğeye ait olduğu doğrulanır (IDOR koruması).
  server.delete(
    "/:itemId/images/:imageId",
    {
      preHandler: requireSiteRole("ADMIN", "EDITOR"),
      schema: { params: PortfolioImageIdParamSchema, response: { 200: ApiSuccessSchema(PortfolioItemSchema) } },
    },
    async (request, reply) => {
      const { itemId, imageId } = request.params;
      const image = await app.prisma.portfolioImage.findUnique({ where: { id: imageId } });
      if (!image || image.portfolioItemId !== itemId) throw new NotFoundError("Galeri görseli bulunamadı.");

      await app.prisma.portfolioImage.delete({ where: { id: imageId } });

      const updated = await app.prisma.portfolioItem.findUnique({ where: { id: itemId }, include: WITH_RELATIONS });
      if (!updated) throw new NotFoundError("Portföy öğesi bulunamadı.");
      return reply.send(ok(toPortfolioItemDto(updated)));
    }
  );
}

/** `/admin/portfolio/categories` prefix'i altında bağlanır — authenticated (bkz. products.routes.ts::adminProductCategoriesRoutes). */
export async function adminPortfolioCategoriesRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>();
  server.addHook("preHandler", authenticate);

  server.get(
    "/",
    { schema: { response: { 200: ApiSuccessSchema(z.array(PortfolioCategorySchema)) } } },
    async (_request, reply) => {
      const rows = await app.prisma.portfolioCategory.findMany({ orderBy: { seq: "asc" } });
      return reply.send(ok(rows.map(toPortfolioCategoryDto)));
    }
  );

  server.post(
    "/",
    {
      preHandler: requireSiteRole("ADMIN", "EDITOR"),
      schema: { body: CreatePortfolioCategoryRequestSchema, response: { 201: ApiSuccessSchema(PortfolioCategorySchema) } },
    },
    async (request, reply) => {
      const category = await app.prisma.portfolioCategory.create({
        data: {
          name: request.body.name,
          slug: request.body.slug ? slugify(request.body.slug) : slugify(request.body.name),
        },
      });
      return reply.code(201).send(ok(toPortfolioCategoryDto(category)));
    }
  );

  server.patch(
    "/:categoryId",
    {
      preHandler: requireSiteRole("ADMIN", "EDITOR"),
      schema: {
        params: PortfolioCategoryIdParamSchema,
        body: UpdatePortfolioCategoryRequestSchema,
        response: { 200: ApiSuccessSchema(PortfolioCategorySchema) },
      },
    },
    async (request, reply) => {
      const { slug, ...rest } = request.body;
      const category = await app.prisma.portfolioCategory
        .update({
          where: { id: request.params.categoryId },
          data: { ...rest, ...(slug !== undefined ? { slug: slugify(slug) } : {}) },
        })
        .catch(() => {
          throw new NotFoundError("Kategori bulunamadı.");
        });
      return reply.send(ok(toPortfolioCategoryDto(category)));
    }
  );

  server.delete(
    "/:categoryId",
    {
      preHandler: requireSiteRole("ADMIN"),
      schema: { params: PortfolioCategoryIdParamSchema, response: { 204: z.undefined() } },
    },
    async (request, reply) => {
      await app.prisma.portfolioCategory.delete({ where: { id: request.params.categoryId } }).catch(() => {
        throw new NotFoundError("Kategori bulunamadı.");
      });
      return reply.code(204).send();
    }
  );
}

/**
 * `/portfolio` prefix'i altında bağlanır — herkese açık, yalnızca yayınlanmış VE çöpte olmayan
 * öğeler. `requireModuleEnabled("portfolio")` — modül kapalıysa TÜM uçlar 404 döner (bkz.
 * middleware/module-guard.ts), admin uçları BU GUARD'A TABİ DEĞİLDİR (veri korunumu).
 */
export async function publicPortfolioRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>();
  server.addHook("preHandler", requireModuleEnabled("portfolio"));

  server.get(
    "/",
    { schema: { querystring: CursorQuerySchema, response: { 200: ApiSuccessSchema(z.array(PortfolioItemSchema)) } } },
    async (request, reply) => {
      const { cursor, limit } = request.query;
      const cursorSeq = parseCursor(cursor);

      const rows = await app.prisma.portfolioItem.findMany({
        where: { status: "PUBLISHED", deletedAt: null, ...(cursorSeq ? { seq: { gt: cursorSeq } } : {}) },
        // Manuel sıralama (kullanıcı kararı) — `seq`/`viewCount` DEĞİL, bkz. prisma/schema.prisma::PortfolioItem.order.
        orderBy: { order: "asc" },
        take: limit,
        include: WITH_RELATIONS,
      });

      return reply.send(ok(rows.map(toPortfolioItemDto), buildPageMeta(rows, limit)));
    }
  );

  server.get(
    "/:slug",
    { schema: { params: PortfolioItemSlugParamSchema, response: { 200: ApiSuccessSchema(PortfolioItemSchema) } } },
    async (request, reply) => {
      const item = await app.prisma.portfolioItem.findFirst({
        where: { slug: request.params.slug, status: "PUBLISHED", deletedAt: null },
        include: WITH_RELATIONS,
      });
      if (!item) throw new NotFoundError("Portföy öğesi bulunamadı.");
      return reply.send(ok(toPortfolioItemDto(item)));
    }
  );

  server.post(
    "/:slug/view",
    { schema: { params: PortfolioItemSlugParamSchema, response: { 204: z.undefined() } } },
    async (request, reply) => {
      const item = await app.prisma.portfolioItem.findFirst({
        where: { slug: request.params.slug, status: "PUBLISHED", deletedAt: null },
        select: { id: true },
      });
      if (!item) throw new NotFoundError("Portföy öğesi bulunamadı.");

      await app.prisma.portfolioItem.update({ where: { id: item.id }, data: { viewCount: { increment: 1 } } });

      return reply.code(204).send();
    }
  );
}
