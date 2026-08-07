import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import type { Product } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { authenticate } from "../../middleware/authenticate";
import { requireSiteRole } from "../../middleware/site-rbac";
import { requireModuleEnabled } from "../../middleware/module-guard";
import { ok } from "../../lib/envelope";
import { ApiSuccessSchema, ApiSuccessWithMeta, CursorQuerySchema } from "../../schemas/common";
import { ContentListMetaSchema, ProductCategorySchema, ProductSchema } from "../../schemas/entities";
import { toProductCategoryDto, toProductDto } from "../../mappers";
import { ConflictError, NotFoundError, ValidationError } from "../../lib/errors";
import { parseCursor, buildPageMeta, buildPageMetaWithCounts } from "../../lib/pagination";
import { slugify } from "../../lib/slug";
import { snapshotBeforeUpdate } from "../../lib/content-revisions";
import { getProductContentCounts } from "../../lib/content-counts";
import { resolveAuthorId } from "../../lib/content-author";
import { logAudit } from "../../lib/audit";
import { sanitizeRichHtml } from "../../lib/html-sanitize";
import { sanitizeProductTranslations } from "./lib/sanitize-content";
import {
  AddProductImageRequestSchema,
  AdjustProductStockRequestSchema,
  CreateProductCategoryRequestSchema,
  CreateProductRequestSchema,
  ListProductsQuerySchema,
  ProductCategoryIdParamSchema,
  ProductIdParamSchema,
  ProductImageIdParamSchema,
  ProductSlugParamSchema,
  UpdateProductCategoryRequestSchema,
  UpdateProductRequestSchema,
} from "./products.schemas";

/** Ürün detay/liste sorgularında kategori + kapak görseli + galeri + yazar özetini de dönmek için. */
const WITH_RELATIONS = {
  category: true,
  coverMedia: true,
  author: true,
  images: { include: { media: true }, orderBy: { order: "asc" as const } },
} as const;

/** Güncellemeden HEMEN ÖNCEKİ alan setini döner (bkz. blog.routes.ts::toBlogPostSnapshot). */
function toProductSnapshot(product: Product): Record<string, unknown> {
  return {
    title: product.title,
    slug: product.slug,
    excerpt: product.excerpt,
    descriptionHtml: product.descriptionHtml,
    priceCents: product.priceCents,
    currency: product.currency,
    taxRatePercent: product.taxRatePercent ? Number(product.taxRatePercent) : null,
    discountPriceCents: product.discountPriceCents,
    sku: product.sku,
    stockQuantity: product.stockQuantity,
    categoryId: product.categoryId,
    coverMediaId: product.coverMediaId,
    seoTitle: product.seoTitle,
    seoDescription: product.seoDescription,
    ogTitle: product.ogTitle,
    ogImageUrl: product.ogImageUrl,
    canonicalUrl: product.canonicalUrl,
    noIndex: product.noIndex,
    translations: product.translations,
  };
}

/**
 * `discountPriceCents` her zaman nihai `priceCents`'ten (istekte gönderilmemişse mevcut kayıttaki)
 * KÜÇÜK olmalıdır. Şemadaki `refine` yalnızca AYNI istekte iki alan da gönderildiğinde kontrol
 * edebiliyor (bkz. products.schemas.ts) — bu yüzden update'te nihai/etkin değerler burada
 * çapraz kontrol edilir.
 */
function assertDiscountBelowPrice(finalPriceCents: number, finalDiscountPriceCents: number | null): void {
  if (finalDiscountPriceCents === null) return;
  if (finalDiscountPriceCents >= finalPriceCents) {
    throw new ValidationError("discountPriceCents, priceCents değerinden küçük olmalıdır.", {
      discountPriceCents: ["discountPriceCents, priceCents değerinden küçük olmalıdır."],
    });
  }
}

/** `/admin/products` prefix'i altında bağlanır (bkz. app.ts) — tüm durumlar (taslak dahil), authenticated. */
export async function adminProductsRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>();
  server.addHook("preHandler", authenticate);

  server.get(
    "/",
    {
      schema: {
        querystring: ListProductsQuerySchema,
        response: { 200: ApiSuccessWithMeta(z.array(ProductSchema), ContentListMetaSchema) },
      },
    },
    async (request, reply) => {
      const { cursor, limit, trashed, status, search } = request.query;
      const cursorSeq = parseCursor(cursor);

      const where: Prisma.ProductWhereInput = {
        ...(cursorSeq ? { seq: { gt: cursorSeq } } : {}),
        ...(status ? { status } : {}),
        ...(trashed === "exclude" ? { deletedAt: null } : trashed === "only" ? { deletedAt: { not: null } } : {}),
        ...(search
          ? {
              OR: [
                { title: { contains: search, mode: "insensitive" } },
                { sku: { contains: search, mode: "insensitive" } },
              ],
            }
          : {}),
      };

      const [rows, counts] = await Promise.all([
        app.prisma.product.findMany({ where, orderBy: { seq: "asc" }, take: limit, include: WITH_RELATIONS }),
        getProductContentCounts(app.prisma),
      ]);

      return reply.send(ok(rows.map(toProductDto), buildPageMetaWithCounts(rows, limit, counts)));
    }
  );

  server.post(
    "/",
    {
      preHandler: requireSiteRole("ADMIN", "EDITOR"),
      schema: { body: CreateProductRequestSchema, response: { 201: ApiSuccessSchema(ProductSchema) } },
    },
    async (request, reply) => {
      const {
        title,
        slug,
        excerpt,
        descriptionHtml,
        priceCents,
        currency,
        taxRatePercent,
        discountPriceCents,
        sku,
        stockQuantity,
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

      assertDiscountBelowPrice(priceCents, discountPriceCents ?? null);

      const resolvedAuthorId = await resolveAuthorId(app, request.body.authorId, request.user!);
      const authorId = resolvedAuthorId === undefined ? request.user!.id : resolvedAuthorId;

      const product = await app.prisma.product.create({
        data: {
          title,
          slug: slug ? slugify(slug) : slugify(title),
          excerpt,
          // Stored-XSS koruması: EDITOR de yazabildiği için (ADMIN'den daha az güvenilir bir rol)
          // içerik DB'ye yazılmadan önce sanitize edilir — public sitede `dangerouslySetInnerHTML`
          // ile doğrudan render edilir (bkz. lib/html-sanitize.ts).
          descriptionHtml: sanitizeRichHtml(descriptionHtml),
          priceCents,
          currency: currency ?? undefined,
          taxRatePercent: taxRatePercent ?? undefined,
          discountPriceCents: discountPriceCents ?? undefined,
          sku: sku ?? undefined,
          stockQuantity: stockQuantity ?? undefined,
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
          translations: (translations ? sanitizeProductTranslations(translations) : {}) as Prisma.InputJsonValue,
          publishedAt: status === "PUBLISHED" ? new Date() : null,
          // Faz 4 (zamanlanmış yayın) — `CreateProductRequestSchema`'nın `refine`'ı zaten
          // `status === "SCHEDULED"` iken `scheduledAt`'in gelecekte dolu olmasını garanti eder.
          scheduledAt: status === "SCHEDULED" && scheduledAt ? new Date(scheduledAt) : null,
        },
        include: WITH_RELATIONS,
      });

      return reply.code(201).send(ok(toProductDto(product)));
    }
  );

  server.get(
    "/:productId",
    { schema: { params: ProductIdParamSchema, response: { 200: ApiSuccessSchema(ProductSchema) } } },
    async (request, reply) => {
      // Çöpteki ürünü de döner (geri yükleme/onay ekranları için) — deletedAt filtresi YOK.
      const product = await app.prisma.product.findUnique({
        where: { id: request.params.productId },
        include: WITH_RELATIONS,
      });
      if (!product) throw new NotFoundError("Ürün bulunamadı.");
      return reply.send(ok(toProductDto(product)));
    }
  );

  server.patch(
    "/:productId",
    {
      preHandler: requireSiteRole("ADMIN", "EDITOR"),
      schema: {
        params: ProductIdParamSchema,
        body: UpdateProductRequestSchema,
        response: { 200: ApiSuccessSchema(ProductSchema) },
      },
    },
    async (request, reply) => {
      const existing = await app.prisma.product.findUnique({ where: { id: request.params.productId } });
      if (!existing) throw new NotFoundError("Ürün bulunamadı.");

      if (existing.deletedAt) {
        throw new ConflictError("Çöpteki içerik düzenlenemez. Önce geri yükleyin.");
      }

      const { priceCents, discountPriceCents } = request.body;
      const finalPriceCents = priceCents ?? existing.priceCents;
      const finalDiscountPriceCents =
        discountPriceCents !== undefined ? discountPriceCents : existing.discountPriceCents;
      assertDiscountBelowPrice(finalPriceCents, finalDiscountPriceCents);

      await snapshotBeforeUpdate(app, "PRODUCT", existing.id, toProductSnapshot(existing), request.user!.id);

      const { slug, translations, authorId: requestedAuthorId, scheduledAt, ...rest } = request.body;
      const resolvedAuthorId = await resolveAuthorId(app, requestedAuthorId, request.user!);

      // Stored-XSS koruması: gelen çeviriler merge'den ÖNCE sanitize edilir (mevcut kayıttaki
      // çeviriler zaten sanitize edilmiş halde DB'de duruyor — bkz. lib/html-sanitize.ts).
      const sanitizedTranslations = translations !== undefined ? sanitizeProductTranslations(translations) : undefined;

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

      const product = await app.prisma.product.update({
        where: { id: request.params.productId },
        data: {
          ...rest,
          ...(rest.descriptionHtml !== undefined ? { descriptionHtml: sanitizeRichHtml(rest.descriptionHtml) } : {}),
          ...(slug !== undefined ? { slug: slugify(slug) } : {}),
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

      return reply.send(ok(toProductDto(product)));
    }
  );

  // §10.7 İçerik Yönetim Listesi — ÇÖPE TAŞI (soft-delete), KALICI SİLMEZ. İdempotenttir.
  server.delete(
    "/:productId",
    {
      preHandler: requireSiteRole("ADMIN", "EDITOR"),
      schema: { params: ProductIdParamSchema, response: { 204: z.undefined() } },
    },
    async (request, reply) => {
      const existing = await app.prisma.product.findUnique({ where: { id: request.params.productId } });
      if (!existing) throw new NotFoundError("Ürün bulunamadı.");

      if (!existing.deletedAt) {
        await app.prisma.product.update({ where: { id: existing.id }, data: { deletedAt: new Date() } });

        await logAudit(app, {
          actorId: request.user!.id,
          actorEmail: request.user!.email,
          action: "product.trash",
          targetType: "Product",
          targetId: existing.id,
          ipAddress: request.ip,
        });
      }

      return reply.code(204).send();
    }
  );

  // §10.7 — çöpten geri yükle. `status` DEĞİŞMEZ. İdempotenttir. Revizyon "restore"u İLE KARIŞTIRILMAMALI.
  server.post(
    "/:productId/restore",
    {
      preHandler: requireSiteRole("ADMIN", "EDITOR"),
      schema: { params: ProductIdParamSchema, response: { 200: ApiSuccessSchema(ProductSchema) } },
    },
    async (request, reply) => {
      const existing = await app.prisma.product.findUnique({ where: { id: request.params.productId } });
      if (!existing) throw new NotFoundError("Ürün bulunamadı.");

      if (existing.deletedAt) {
        await app.prisma.product.update({ where: { id: existing.id }, data: { deletedAt: null } });

        await logAudit(app, {
          actorId: request.user!.id,
          actorEmail: request.user!.email,
          action: "product.restore",
          targetType: "Product",
          targetId: existing.id,
          ipAddress: request.ip,
        });
      }

      const product = await app.prisma.product.findUnique({ where: { id: existing.id }, include: WITH_RELATIONS });
      return reply.send(ok(toProductDto(product!)));
    }
  );

  // §10.7 — KALICI sil (yalnızca ADMIN). Kayıt ÖNCE çöpte olmalı, değilse 409.
  server.delete(
    "/:productId/permanent",
    {
      preHandler: requireSiteRole("ADMIN"),
      schema: { params: ProductIdParamSchema, response: { 204: z.undefined() } },
    },
    async (request, reply) => {
      const existing = await app.prisma.product.findUnique({ where: { id: request.params.productId } });
      if (!existing) throw new NotFoundError("Ürün bulunamadı.");
      if (!existing.deletedAt) throw new ConflictError("Kalıcı silmeden önce içeriği çöpe taşıyın.");

      await app.prisma.$transaction([
        app.prisma.contentRevision.deleteMany({ where: { entityType: "PRODUCT", entityId: existing.id } }),
        app.prisma.product.delete({ where: { id: existing.id } }),
      ]);

      await logAudit(app, {
        actorId: request.user!.id,
        actorEmail: request.user!.email,
        action: "product.permanent_delete",
        targetType: "Product",
        targetId: existing.id,
        ipAddress: request.ip,
      });

      return reply.code(204).send();
    }
  );

  // Admin'in ELLE stok düzeltmesi — checkout'un otomatik stok düşürmesiyle (Faz 2b, Serializable
  // transaction) KARIŞTIRILMAMALI, bu uç yalnızca admin panelinden manuel düzeltme içindir.
  server.patch(
    "/:productId/stock",
    {
      preHandler: requireSiteRole("ADMIN", "EDITOR"),
      schema: {
        params: ProductIdParamSchema,
        body: AdjustProductStockRequestSchema,
        response: { 200: ApiSuccessSchema(ProductSchema) },
      },
    },
    async (request, reply) => {
      const existing = await app.prisma.product.findUnique({ where: { id: request.params.productId } });
      if (!existing) throw new NotFoundError("Ürün bulunamadı.");

      const product = await app.prisma.product.update({
        where: { id: existing.id },
        data: { stockQuantity: request.body.stockQuantity },
        include: WITH_RELATIONS,
      });

      await logAudit(app, {
        actorId: request.user!.id,
        actorEmail: request.user!.email,
        action: "product.stock_adjust",
        targetType: "Product",
        targetId: existing.id,
        metadata: { from: existing.stockQuantity, to: request.body.stockQuantity },
        ipAddress: request.ip,
      });

      return reply.send(ok(toProductDto(product)));
    }
  );

  // Galeriye görsel ekle — aynı `mediaId` zaten galerideyse 409 (bkz. `@@unique([productId, mediaId])`).
  server.post(
    "/:productId/images",
    {
      preHandler: requireSiteRole("ADMIN", "EDITOR"),
      schema: {
        params: ProductIdParamSchema,
        body: AddProductImageRequestSchema,
        response: { 201: ApiSuccessSchema(ProductSchema) },
      },
    },
    async (request, reply) => {
      const product = await app.prisma.product.findUnique({ where: { id: request.params.productId } });
      if (!product) throw new NotFoundError("Ürün bulunamadı.");

      const media = await app.prisma.media.findUnique({ where: { id: request.body.mediaId } });
      if (!media) throw new NotFoundError("Medya bulunamadı.");

      const existingImage = await app.prisma.productImage.findUnique({
        where: { productId_mediaId: { productId: product.id, mediaId: media.id } },
      });
      if (existingImage) throw new ConflictError("Bu görsel zaten ürünün galerisinde.");

      const lastImage = await app.prisma.productImage.findFirst({
        where: { productId: product.id },
        orderBy: { order: "desc" },
      });

      await app.prisma.productImage.create({
        data: { productId: product.id, mediaId: media.id, order: lastImage ? lastImage.order + 1 : 0 },
      });

      const updated = await app.prisma.product.findUnique({ where: { id: product.id }, include: WITH_RELATIONS });
      return reply.code(201).send(ok(toProductDto(updated!)));
    }
  );

  // Galeriden görsel kaldır — `imageId`'nin GERÇEKTEN bu ürüne ait olduğu doğrulanır (IDOR koruması).
  server.delete(
    "/:productId/images/:imageId",
    {
      preHandler: requireSiteRole("ADMIN", "EDITOR"),
      schema: { params: ProductImageIdParamSchema, response: { 200: ApiSuccessSchema(ProductSchema) } },
    },
    async (request, reply) => {
      const { productId, imageId } = request.params;
      const image = await app.prisma.productImage.findUnique({ where: { id: imageId } });
      if (!image || image.productId !== productId) throw new NotFoundError("Galeri görseli bulunamadı.");

      await app.prisma.productImage.delete({ where: { id: imageId } });

      const updated = await app.prisma.product.findUnique({ where: { id: productId }, include: WITH_RELATIONS });
      if (!updated) throw new NotFoundError("Ürün bulunamadı.");
      return reply.send(ok(toProductDto(updated)));
    }
  );
}

/** `/admin/products/categories` prefix'i altında bağlanır — authenticated (bkz. blog.routes.ts::adminBlogCategoriesRoutes). */
export async function adminProductCategoriesRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>();
  server.addHook("preHandler", authenticate);

  server.get(
    "/",
    { schema: { response: { 200: ApiSuccessSchema(z.array(ProductCategorySchema)) } } },
    async (_request, reply) => {
      const rows = await app.prisma.productCategory.findMany({ orderBy: { seq: "asc" } });
      return reply.send(ok(rows.map(toProductCategoryDto)));
    }
  );

  server.post(
    "/",
    {
      preHandler: requireSiteRole("ADMIN", "EDITOR"),
      schema: { body: CreateProductCategoryRequestSchema, response: { 201: ApiSuccessSchema(ProductCategorySchema) } },
    },
    async (request, reply) => {
      const category = await app.prisma.productCategory.create({
        data: {
          name: request.body.name,
          slug: request.body.slug ? slugify(request.body.slug) : slugify(request.body.name),
        },
      });
      return reply.code(201).send(ok(toProductCategoryDto(category)));
    }
  );

  server.patch(
    "/:categoryId",
    {
      preHandler: requireSiteRole("ADMIN", "EDITOR"),
      schema: {
        params: ProductCategoryIdParamSchema,
        body: UpdateProductCategoryRequestSchema,
        response: { 200: ApiSuccessSchema(ProductCategorySchema) },
      },
    },
    async (request, reply) => {
      const { slug, ...rest } = request.body;
      const category = await app.prisma.productCategory
        .update({
          where: { id: request.params.categoryId },
          data: { ...rest, ...(slug !== undefined ? { slug: slugify(slug) } : {}) },
        })
        .catch(() => {
          throw new NotFoundError("Kategori bulunamadı.");
        });
      return reply.send(ok(toProductCategoryDto(category)));
    }
  );

  server.delete(
    "/:categoryId",
    {
      preHandler: requireSiteRole("ADMIN"),
      schema: { params: ProductCategoryIdParamSchema, response: { 204: z.undefined() } },
    },
    async (request, reply) => {
      await app.prisma.productCategory.delete({ where: { id: request.params.categoryId } }).catch(() => {
        throw new NotFoundError("Kategori bulunamadı.");
      });
      return reply.code(204).send();
    }
  );
}

/**
 * `/products` prefix'i altında bağlanır — herkese açık, yalnızca yayınlanmış VE çöpte olmayan
 * ürünler. `requireModuleEnabled("products")` — modül kapalıysa TÜM uçlar 404 döner (bkz.
 * middleware/module-guard.ts), admin uçları BU GUARD'A TABİ DEĞİLDİR (veri korunumu).
 */
export async function publicProductsRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>();
  server.addHook("preHandler", requireModuleEnabled("products"));

  server.get(
    "/",
    { schema: { querystring: CursorQuerySchema, response: { 200: ApiSuccessSchema(z.array(ProductSchema)) } } },
    async (request, reply) => {
      const { cursor, limit } = request.query;
      const cursorSeq = parseCursor(cursor);

      const rows = await app.prisma.product.findMany({
        where: { status: "PUBLISHED", deletedAt: null, ...(cursorSeq ? { seq: { gt: cursorSeq } } : {}) },
        orderBy: { seq: "asc" },
        take: limit,
        include: WITH_RELATIONS,
      });

      return reply.send(ok(rows.map(toProductDto), buildPageMeta(rows, limit)));
    }
  );

  server.get(
    "/:slug",
    { schema: { params: ProductSlugParamSchema, response: { 200: ApiSuccessSchema(ProductSchema) } } },
    async (request, reply) => {
      const product = await app.prisma.product.findFirst({
        where: { slug: request.params.slug, status: "PUBLISHED", deletedAt: null },
        include: WITH_RELATIONS,
      });
      if (!product) throw new NotFoundError("Ürün bulunamadı.");
      return reply.send(ok(toProductDto(product)));
    }
  );

  server.post(
    "/:slug/view",
    { schema: { params: ProductSlugParamSchema, response: { 204: z.undefined() } } },
    async (request, reply) => {
      const product = await app.prisma.product.findFirst({
        where: { slug: request.params.slug, status: "PUBLISHED", deletedAt: null },
        select: { id: true },
      });
      if (!product) throw new NotFoundError("Ürün bulunamadı.");

      await app.prisma.product.update({ where: { id: product.id }, data: { viewCount: { increment: 1 } } });

      return reply.code(204).send();
    }
  );
}
