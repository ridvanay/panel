import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import type { PortfolioItem } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { authenticate } from "../../middleware/authenticate";
import { requireSiteRole } from "../../middleware/site-rbac";
import { requireModuleEnabled } from "../../middleware/module-guard";
import { requirePanelAccess } from "../../middleware/panel-access";
import { ROLES_ADMIN_MANAGER } from "../../lib/site-roles";
import { ok } from "../../lib/envelope";
import { ApiSuccessSchema, ApiSuccessWithMeta, AutosaveResponseSchema, CursorQuerySchema } from "../../schemas/common";
import {
  BulkContentActionRequestSchema,
  BulkContentActionResultSchema,
  ContentListMetaSchema,
  ContentRevisionSchema,
  ContentRevisionSummarySchema,
  PortfolioCategorySchema,
  PortfolioItemSchema,
} from "../../schemas/entities";
import { toContentRevisionDto, toContentRevisionSummaryDto, toPortfolioCategoryDto, toPortfolioItemDto } from "../../mappers";
import { ConflictError, NotFoundError, ValidationError } from "../../lib/errors";
import { parseCursor, buildPageMeta, buildPageMetaWithCounts } from "../../lib/pagination";
import { slugify } from "../../lib/slug";
import { snapshotBeforeUpdate, listContentRevisions, getContentRevisionOrThrow } from "../../lib/content-revisions";
import { runBulkContentAction, type BulkContentDelegate } from "../../lib/bulk-content-actions";
import { getPortfolioItemContentCounts } from "../../lib/content-counts";
import { resolveAuthorId } from "../../lib/content-author";
import { logAudit } from "../../lib/audit";
import { sanitizeRichHtml } from "../../lib/html-sanitize";
import { isImageMimeType } from "../../lib/mime-detect";
import {
  applyFieldLocalization,
  attachLocalizations,
  attachLocalizationsOne,
  deleteContentSlugsForEntity,
  getLocaleSet,
  mergeTranslations,
  resolveEffectiveLocaleCode,
  resolveEntityIdBySlug,
  syncContentSlugs,
} from "../../lib/localization";
import { sanitizePortfolioTranslations } from "./lib/sanitize-content";
import { emitWebhookEvent } from "../../lib/webhook-emitter";
import { toPublicPortfolioItemDto } from "../public-api/public-api.mappers";
import {
  AddPortfolioImageRequestSchema,
  AutosavePortfolioItemRequestSchema,
  CreatePortfolioCategoryRequestSchema,
  CreatePortfolioItemRequestSchema,
  ListPortfolioItemsQuerySchema,
  LocaleQuerySchema,
  PortfolioCategoryIdParamSchema,
  PortfolioImageIdParamSchema,
  PortfolioItemIdParamSchema,
  PortfolioItemSlugParamSchema,
  PortfolioRevisionIdParamSchema,
  UpdatePortfolioCategoryRequestSchema,
  UpdatePortfolioItemRequestSchema,
} from "./portfolio.schemas";

/**
 * §2.2 madde 5 (.claude/architect-scope-ecommerce-pro-template.md, bağlayıcı) ve
 * openapi.yaml `POST /admin/media` açıklaması ("Görsel bekleyen FK slotları (`coverMediaId`,
 * ürün/portföy galerisi, `Slide.bgMediaId`, `SiteAppearance.pageHeaderBackgroundMediaId`)
 * `image/*` DIŞINDAKİ medyayı `422` ile REDDEDER") — `products.routes.ts::assertImageMedia`
 * ile AYNI kural, `PortfolioItem.coverMediaId`/`PortfolioImage.mediaId` için.
 */
async function assertImageMedia(app: FastifyInstance, mediaId: string) {
  const media = await app.prisma.media.findUnique({ where: { id: mediaId } });
  if (!media) throw new NotFoundError("Medya bulunamadı.");
  if (!isImageMimeType(media.mimeType)) {
    throw new ValidationError("Bu alan yalnızca görsel medya kabul eder.", {
      mediaId: ["Seçilen dosya bir görsel değil."],
    });
  }
  return media;
}

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

const PORTFOLIO_ITEM_STRING_FIELDS = [
  "title",
  "seoTitle",
  "seoDescription",
  "ogTitle",
  "canonicalUrl",
  "summary",
  "contentHtml",
] as const;

/**
 * §0.1b — ÖNCELİK 1: `PortfolioItem` public GET'lerinde `translations` YAZILABİLİYORDU ama
 * OKUNAMIYORDU (`applyLocale()` hiç YOKTU). Artık `BlogPost`/`Product`/`Page` ile AYNI ortak
 * yardımcıyı kullanır (bkz. lib/localization.ts).
 */
function applyPortfolioItemLocale<T extends PortfolioItem>(item: T, effectiveLocale: string | undefined): T {
  if (!effectiveLocale) return item;
  return applyFieldLocalization(item, effectiveLocale, PORTFOLIO_ITEM_STRING_FIELDS);
}

async function toPortfolioItemDtoLocalized(app: FastifyInstance, item: Parameters<typeof toPortfolioItemDto>[0]) {
  const localizations = await attachLocalizationsOne(app, "PORTFOLIO_ITEM", item);
  return toPortfolioItemDto(item, localizations);
}

async function toPortfolioItemDtosLocalized(app: FastifyInstance, items: Parameters<typeof toPortfolioItemDto>[0][]) {
  const map = await attachLocalizations(app, "PORTFOLIO_ITEM", items);
  return items.map((item) => toPortfolioItemDto(item, map.get(item.id) ?? []));
}

/** `/admin/portfolio` prefix'i altında bağlanır (bkz. app.ts) — tüm durumlar (taslak dahil), authenticated. */
export async function adminPortfolioRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>();
  server.addHook("preHandler", authenticate);
  server.addHook("preHandler", requirePanelAccess());

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

      return reply.send(ok(await toPortfolioItemDtosLocalized(app, rows), buildPageMetaWithCounts(rows, limit, counts)));
    }
  );

  server.post(
    "/",
    {
      preHandler: requireSiteRole(...ROLES_ADMIN_MANAGER),
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

      if (coverMediaId) {
        await assertImageMedia(app, coverMediaId);
      }

      const resolvedAuthorId = await resolveAuthorId(app, request.body.authorId, request.user!);
      const authorId = resolvedAuthorId === undefined ? request.user!.id : resolvedAuthorId;

      const { enabled: enabledLocales } = await getLocaleSet(app);
      const sanitizedTranslations = translations ? sanitizePortfolioTranslations(translations) : {};

      const item = await app.prisma.$transaction(async (tx) => {
        const created = await tx.portfolioItem.create({
          data: {
            title,
            slug: slug ? slugify(slug) : slugify(title),
            summary,
            // Stored-XSS koruması: MANAGER de yazabildiği için (ADMIN'den daha az güvenilir bir rol)
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
            translations: sanitizedTranslations as Prisma.InputJsonValue,
            publishedAt: status === "PUBLISHED" ? new Date() : null,
            // Faz 4 (zamanlanmış yayın) — `CreatePortfolioItemRequestSchema`'nın `refine`'ı zaten
            // `status === "SCHEDULED"` iken `scheduledAt`'in gelecekte dolu olmasını garanti eder.
            scheduledAt: status === "SCHEDULED" && scheduledAt ? new Date(scheduledAt) : null,
          },
          include: WITH_RELATIONS,
        });

        await syncContentSlugs(tx, enabledLocales, "PORTFOLIO_ITEM", created.id, created.slug, created.translations);

        return created;
      });

      return reply.code(201).send(ok(await toPortfolioItemDtoLocalized(app, item)));
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
      return reply.send(ok(await toPortfolioItemDtoLocalized(app, item)));
    }
  );

  server.patch(
    "/:itemId",
    {
      preHandler: requireSiteRole(...ROLES_ADMIN_MANAGER),
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

      if (rest.coverMediaId) {
        await assertImageMedia(app, rest.coverMediaId);
      }

      const resolvedAuthorId = await resolveAuthorId(app, requestedAuthorId, request.user!);

      // Stored-XSS koruması: gelen çeviriler merge'den ÖNCE sanitize edilir (mevcut kayıttaki
      // çeviriler zaten sanitize edilmiş halde DB'de duruyor — bkz. lib/html-sanitize.ts).
      const sanitizedTranslations = translations !== undefined ? sanitizePortfolioTranslations(translations) : undefined;
      const mergedTranslations =
        sanitizedTranslations !== undefined ? mergeTranslations(existing.translations, sanitizedTranslations) : undefined;

      const { enabled: enabledLocales } = await getLocaleSet(app);

      const item = await app.prisma.$transaction(async (tx) => {
        const updated = await tx.portfolioItem.update({
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

        if (slug !== undefined || mergedTranslations !== undefined) {
          await syncContentSlugs(tx, enabledLocales, "PORTFOLIO_ITEM", updated.id, updated.slug, updated.translations);
        }

        return updated;
      });

      // §10.13.8 — `PORTFOLIO_ITEM_PUBLISHED` YALNIZCA duruma GEÇİŞTE tetiklenir.
      if (!existing.publishedAt && item.publishedAt) {
        await emitWebhookEvent(app, "PORTFOLIO_ITEM_PUBLISHED", toPublicPortfolioItemDto(item));
      }

      return reply.send(ok(await toPortfolioItemDtoLocalized(app, item)));
    }
  );

  // Faz 3 (autosave) — 3sn debounce ile frontend'den çağrılır. Bilinçli olarak `PATCH`'ten
  // AYRIDIR: `snapshotBeforeUpdate` (revizyon) ve `logAudit` ÇAĞIRMAZ (bkz. products.routes.ts'teki
  // AYNI gerekçe). `status`/`slug`/`order`/`clientName`/`projectUrl`/`completedAt`/SEO/çeviri BU
  // UÇTAN DEĞİŞTİRİLEMEZ — `AutosavePortfolioItemRequestSchema` şema seviyesinde zaten yalnızca
  // title/summary/contentHtml içerir.
  server.post(
    "/:itemId/autosave",
    {
      preHandler: requireSiteRole(...ROLES_ADMIN_MANAGER),
      schema: {
        params: PortfolioItemIdParamSchema,
        body: AutosavePortfolioItemRequestSchema,
        response: { 200: ApiSuccessSchema(AutosaveResponseSchema) },
      },
    },
    async (request, reply) => {
      const existing = await app.prisma.portfolioItem.findUnique({ where: { id: request.params.itemId } });
      if (!existing) throw new NotFoundError("Portföy öğesi bulunamadı.");

      if (existing.deletedAt) {
        throw new ConflictError("Çöpteki içerik düzenlenemez. Önce geri yükleyin.");
      }

      const { title, summary, contentHtml } = request.body;

      await app.prisma.portfolioItem.update({
        where: { id: request.params.itemId },
        data: {
          ...(title !== undefined ? { title } : {}),
          ...(summary !== undefined ? { summary } : {}),
          ...(contentHtml !== undefined ? { contentHtml: sanitizeRichHtml(contentHtml) } : {}),
        },
      });

      return reply.send(ok({ savedAt: new Date().toISOString() }));
    }
  );

  // §10.7 İçerik Yönetim Listesi — ÇÖPE TAŞI (soft-delete), KALICI SİLMEZ. İdempotenttir.
  server.delete(
    "/:itemId",
    {
      preHandler: requireSiteRole(...ROLES_ADMIN_MANAGER),
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
      preHandler: requireSiteRole(...ROLES_ADMIN_MANAGER),
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
      return reply.send(ok(await toPortfolioItemDtoLocalized(app, item!)));
    }
  );

  // §10.7 — KALICI sil (ADMIN + MANAGER). Kayıt ÖNCE çöpte olmalı, değilse 409.
  server.delete(
    "/:itemId/permanent",
    {
      preHandler: requireSiteRole(...ROLES_ADMIN_MANAGER),
      schema: { params: PortfolioItemIdParamSchema, response: { 204: z.undefined() } },
    },
    async (request, reply) => {
      const existing = await app.prisma.portfolioItem.findUnique({ where: { id: request.params.itemId } });
      if (!existing) throw new NotFoundError("Portföy öğesi bulunamadı.");
      if (!existing.deletedAt) throw new ConflictError("Kalıcı silmeden önce içeriği çöpe taşıyın.");

      await app.prisma.$transaction(async (tx) => {
        await tx.contentRevision.deleteMany({ where: { entityType: "PORTFOLIO_ITEM", entityId: existing.id } });
        await deleteContentSlugsForEntity(tx, "PORTFOLIO_ITEM", existing.id);
        await tx.portfolioItem.delete({ where: { id: existing.id } });
      });

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
      preHandler: requireSiteRole(...ROLES_ADMIN_MANAGER),
      schema: {
        params: PortfolioItemIdParamSchema,
        body: AddPortfolioImageRequestSchema,
        response: { 201: ApiSuccessSchema(PortfolioItemSchema) },
      },
    },
    async (request, reply) => {
      const item = await app.prisma.portfolioItem.findUnique({ where: { id: request.params.itemId } });
      if (!item) throw new NotFoundError("Portföy öğesi bulunamadı.");

      const media = await assertImageMedia(app, request.body.mediaId);

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
      return reply.code(201).send(ok(await toPortfolioItemDtoLocalized(app, updated!)));
    }
  );

  // Galeriden görsel kaldır — `imageId`'nin GERÇEKTEN bu öğeye ait olduğu doğrulanır (IDOR koruması).
  server.delete(
    "/:itemId/images/:imageId",
    {
      preHandler: requireSiteRole(...ROLES_ADMIN_MANAGER),
      schema: { params: PortfolioImageIdParamSchema, response: { 200: ApiSuccessSchema(PortfolioItemSchema) } },
    },
    async (request, reply) => {
      const { itemId, imageId } = request.params;
      const image = await app.prisma.portfolioImage.findUnique({ where: { id: imageId } });
      if (!image || image.portfolioItemId !== itemId) throw new NotFoundError("Galeri görseli bulunamadı.");

      await app.prisma.portfolioImage.delete({ where: { id: imageId } });

      const updated = await app.prisma.portfolioItem.findUnique({ where: { id: itemId }, include: WITH_RELATIONS });
      if (!updated) throw new NotFoundError("Portföy öğesi bulunamadı.");
      return reply.send(ok(await toPortfolioItemDtoLocalized(app, updated)));
    }
  );

  // §10.1/§10.7 — toplu işlem. Ortak helper (bkz. ARCHITECTURE.md §10.1 karar 1A) — dört route
  // (page/blog_post/product/portfolio_item) BİREBİR aynı davranışı paylaşır.
  server.post(
    "/bulk",
    {
      preHandler: requireSiteRole(...ROLES_ADMIN_MANAGER),
      schema: { body: BulkContentActionRequestSchema, response: { 200: ApiSuccessSchema(BulkContentActionResultSchema) } },
    },
    async (request, reply) => {
      // §10.13.8 — bkz. pages.routes.ts::"/bulk" AYNI desen/gerekçe.
      const publishCandidateIds =
        request.body.action === "publish"
          ? (
              await app.prisma.portfolioItem.findMany({
                where: { id: { in: request.body.ids }, deletedAt: null, publishedAt: null },
                select: { id: true },
              })
            ).map((row) => row.id)
          : [];

      const result = await runBulkContentAction(
        app,
        {
          getDelegate: (client) => client.portfolioItem as unknown as BulkContentDelegate,
          entityType: "PORTFOLIO_ITEM",
          targetType: "PortfolioItem",
          auditActionPrefix: "portfolio_item.",
        },
        {
          ids: request.body.ids,
          action: request.body.action,
          actor: { id: request.user!.id, email: request.user!.email, role: request.user!.role },
          ip: request.ip,
        }
      );

      if (publishCandidateIds.length > 0) {
        const transitionedIds = publishCandidateIds.filter((id) => !result.skippedIds.includes(id));
        if (transitionedIds.length > 0) {
          const publishedRows = await app.prisma.portfolioItem.findMany({ where: { id: { in: transitionedIds } }, include: WITH_RELATIONS });
          for (const row of publishedRows) {
            await emitWebhookEvent(app, "PORTFOLIO_ITEM_PUBLISHED", toPublicPortfolioItemDto(row));
          }
        }
      }

      return reply.send(ok(result));
    }
  );

  // §10.1 İçerik Sürüm Kontrolü — yetki eşiği öğe düzenleme ile aynı (ADMIN+MANAGER). `Product`
  // ile BİREBİR AYNI sözleşme (bkz. lib/content-revisions.ts::listContentRevisions).
  server.get(
    "/:itemId/revisions",
    {
      preHandler: requireSiteRole(...ROLES_ADMIN_MANAGER),
      schema: {
        params: PortfolioItemIdParamSchema,
        querystring: CursorQuerySchema,
        response: { 200: ApiSuccessSchema(z.array(ContentRevisionSummarySchema)) },
      },
    },
    async (request, reply) => {
      const { rows, nextCursor } = await listContentRevisions(app, "PORTFOLIO_ITEM", request.params.itemId, request.query);
      return reply.send(ok(rows.map(toContentRevisionSummaryDto), { nextCursor }));
    }
  );

  server.get(
    "/:itemId/revisions/:revisionId",
    {
      preHandler: requireSiteRole(...ROLES_ADMIN_MANAGER),
      schema: { params: PortfolioRevisionIdParamSchema, response: { 200: ApiSuccessSchema(ContentRevisionSchema) } },
    },
    async (request, reply) => {
      const revision = await getContentRevisionOrThrow(app, "PORTFOLIO_ITEM", request.params.itemId, request.params.revisionId);
      return reply.send(ok(toContentRevisionDto(revision)));
    }
  );

  // `Product`'ın AKSİNE 422 dalı YOKTUR — `PortfolioItem`'da doğrulanacak bir çapraz-alan kuralı
  // (fiyat/indirim gibi) BULUNMAZ (bkz. ARCHITECTURE.md §10.1). `Product`'taki gibi snapshot
  // uygulanmadan önce çöp kontrolü yapılır (öğe çöpteyse 409, bkz. openapi.yaml bu ucun 409 açıklaması).
  server.post(
    "/:itemId/revisions/:revisionId/restore",
    {
      preHandler: requireSiteRole(...ROLES_ADMIN_MANAGER),
      schema: { params: PortfolioRevisionIdParamSchema, response: { 200: ApiSuccessSchema(PortfolioItemSchema) } },
    },
    async (request, reply) => {
      const existing = await app.prisma.portfolioItem.findUnique({ where: { id: request.params.itemId } });
      if (!existing) throw new NotFoundError("Portföy öğesi bulunamadı.");

      if (existing.deletedAt) {
        throw new ConflictError("Çöpteki içerik düzenlenemez. Önce geri yükleyin.");
      }

      const revision = await getContentRevisionOrThrow(app, "PORTFOLIO_ITEM", request.params.itemId, request.params.revisionId);

      // Geri dönüş de geri alınabilir olsun diye önce mevcut state'i yeni bir revizyon olarak kaydet.
      await snapshotBeforeUpdate(app, "PORTFOLIO_ITEM", existing.id, toPortfolioItemSnapshot(existing), request.user!.id);

      const snapshot = revision.snapshot as {
        title: string;
        slug: string;
        summary: string | null;
        contentHtml: string;
        clientName: string | null;
        projectUrl: string | null;
        completedAt: string | null;
        order: number;
        categoryId: string | null;
        coverMediaId: string | null;
        seoTitle: string | null;
        seoDescription: string | null;
        ogTitle: string | null;
        ogImageUrl: string | null;
        canonicalUrl: string | null;
        noIndex: boolean;
        translations: unknown;
      };

      const { enabled: enabledLocales } = await getLocaleSet(app);
      const sanitizedTranslations = snapshot.translations
        ? sanitizePortfolioTranslations(snapshot.translations as Record<string, Record<string, unknown> | null>)
        : {};

      const item = await app.prisma.$transaction(async (tx) => {
        const updated = await tx.portfolioItem.update({
          where: { id: request.params.itemId },
          data: {
            title: snapshot.title,
            slug: snapshot.slug,
            summary: snapshot.summary,
            // Savunmada derinlik: bu sanitizasyon eklenmeden ÖNCE kaydedilmiş eski revizyonlar
            // temizlenmemiş HTML içerebilir — geri yükleme her zaman yeniden sanitize eder.
            contentHtml: sanitizeRichHtml(snapshot.contentHtml),
            clientName: snapshot.clientName,
            projectUrl: snapshot.projectUrl,
            completedAt: snapshot.completedAt ? new Date(snapshot.completedAt) : null,
            order: snapshot.order,
            categoryId: snapshot.categoryId,
            coverMediaId: snapshot.coverMediaId,
            seoTitle: snapshot.seoTitle,
            seoDescription: snapshot.seoDescription,
            ogTitle: snapshot.ogTitle,
            ogImageUrl: snapshot.ogImageUrl,
            canonicalUrl: snapshot.canonicalUrl,
            noIndex: snapshot.noIndex,
            translations: sanitizedTranslations as Prisma.InputJsonValue,
          },
          include: WITH_RELATIONS,
        });

        await syncContentSlugs(tx, enabledLocales, "PORTFOLIO_ITEM", updated.id, updated.slug, updated.translations);

        return updated;
      });

      return reply.send(ok(await toPortfolioItemDtoLocalized(app, item)));
    }
  );
}

/** `/admin/portfolio/categories` prefix'i altında bağlanır — authenticated (bkz. products.routes.ts::adminProductCategoriesRoutes). */
export async function adminPortfolioCategoriesRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>();
  server.addHook("preHandler", authenticate);
  server.addHook("preHandler", requirePanelAccess());

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
      preHandler: requireSiteRole(...ROLES_ADMIN_MANAGER),
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
      preHandler: requireSiteRole(...ROLES_ADMIN_MANAGER),
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
      preHandler: requireSiteRole(...ROLES_ADMIN_MANAGER),
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
    {
      schema: {
        querystring: CursorQuerySchema.merge(LocaleQuerySchema),
        response: { 200: ApiSuccessSchema(z.array(PortfolioItemSchema)) },
      },
    },
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

      const localeSet = await getLocaleSet(app);
      const effectiveLocale = resolveEffectiveLocaleCode(localeSet, request.query.locale);
      const localizationsByEntity = await attachLocalizations(app, "PORTFOLIO_ITEM", rows);

      const dtos = rows.map((row) =>
        toPortfolioItemDto(applyPortfolioItemLocale(row, effectiveLocale), localizationsByEntity.get(row.id) ?? [])
      );

      return reply.send(ok(dtos, buildPageMeta(rows, limit)));
    }
  );

  server.get(
    "/:slug",
    {
      schema: {
        params: PortfolioItemSlugParamSchema,
        querystring: LocaleQuerySchema,
        response: { 200: ApiSuccessSchema(PortfolioItemSchema) },
      },
    },
    async (request, reply) => {
      const localeSet = await getLocaleSet(app);
      const effectiveLocale = resolveEffectiveLocaleCode(localeSet, request.query.locale);

      // §0.1b/§4 — ÖNCELİK 1 düzeltmesi: artık `/pages`/`/blog` ile BİREBİR AYNI slug çözümlemesi.
      const translatedEntityId = await resolveEntityIdBySlug(app, "PORTFOLIO_ITEM", request.params.slug, effectiveLocale);
      const item = translatedEntityId
        ? await app.prisma.portfolioItem.findFirst({
            where: { id: translatedEntityId, status: "PUBLISHED", deletedAt: null },
            include: WITH_RELATIONS,
          })
        : null;
      const resolvedItem =
        item ??
        (await app.prisma.portfolioItem.findFirst({
          where: { slug: request.params.slug, status: "PUBLISHED", deletedAt: null },
          include: WITH_RELATIONS,
        }));
      if (!resolvedItem) throw new NotFoundError("Portföy öğesi bulunamadı.");

      const localizations = await attachLocalizationsOne(app, "PORTFOLIO_ITEM", resolvedItem);
      return reply.send(ok(toPortfolioItemDto(applyPortfolioItemLocale(resolvedItem, effectiveLocale), localizations)));
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
