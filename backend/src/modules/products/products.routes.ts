import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import type { Product } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { authenticate } from "../../middleware/authenticate";
import { requireSiteRole } from "../../middleware/site-rbac";
import { requireModuleEnabled } from "../../middleware/module-guard";
import { ok } from "../../lib/envelope";
import { ApiSuccessSchema, ApiSuccessWithMeta, AutosaveResponseSchema, CursorQuerySchema } from "../../schemas/common";
import {
  BulkContentActionRequestSchema,
  BulkContentActionResultSchema,
  ContentListMetaSchema,
  ContentRevisionSchema,
  ContentRevisionSummarySchema,
  ProductCategorySchema,
  ProductSchema,
} from "../../schemas/entities";
import { toContentRevisionDto, toContentRevisionSummaryDto, toProductCategoryDto, toProductDto } from "../../mappers";
import { ConflictError, NotFoundError, ValidationError } from "../../lib/errors";
import { parseCursor, buildPageMeta, buildPageMetaWithCounts } from "../../lib/pagination";
import { slugify } from "../../lib/slug";
import { snapshotBeforeUpdate, listContentRevisions, getContentRevisionOrThrow } from "../../lib/content-revisions";
import { runBulkContentAction, type BulkContentDelegate } from "../../lib/bulk-content-actions";
import { getProductContentCounts } from "../../lib/content-counts";
import { resolveAuthorId } from "../../lib/content-author";
import { logAudit } from "../../lib/audit";
import { sanitizeRichHtml } from "../../lib/html-sanitize";
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
import { sanitizeProductTranslations } from "./lib/sanitize-content";
import { emitWebhookEvent } from "../../lib/webhook-emitter";
import { toPublicProductDto } from "../public-api/public-api.mappers";
import {
  AddProductImageRequestSchema,
  AdjustProductStockRequestSchema,
  AutosaveProductRequestSchema,
  CreateProductCategoryRequestSchema,
  CreateProductRequestSchema,
  ListProductsQuerySchema,
  LocaleQuerySchema,
  ProductCategoryIdParamSchema,
  ProductIdParamSchema,
  ProductImageIdParamSchema,
  ProductRevisionIdParamSchema,
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

const PRODUCT_STRING_FIELDS = [
  "title",
  "seoTitle",
  "seoDescription",
  "ogTitle",
  "canonicalUrl",
  "excerpt",
  "descriptionHtml",
] as const;

/**
 * §0.1b — ÖNCELİK 1: `Product` public GET'lerinde `translations` YAZILABİLİYORDU ama
 * OKUNAMIYORDU (`applyLocale()` hiç YOKTU). Artık `BlogPost`/`Page` ile AYNI ortak yardımcıyı
 * kullanır (bkz. lib/localization.ts).
 */
function applyProductLocale<T extends Product>(product: T, effectiveLocale: string | undefined): T {
  if (!effectiveLocale) return product;
  return applyFieldLocalization(product, effectiveLocale, PRODUCT_STRING_FIELDS);
}

async function toProductDtoLocalized(app: FastifyInstance, product: Parameters<typeof toProductDto>[0]) {
  const localizations = await attachLocalizationsOne(app, "PRODUCT", product);
  return toProductDto(product, localizations);
}

async function toProductDtosLocalized(app: FastifyInstance, products: Parameters<typeof toProductDto>[0][]) {
  const map = await attachLocalizations(app, "PRODUCT", products);
  return products.map((product) => toProductDto(product, map.get(product.id) ?? []));
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

      return reply.send(ok(await toProductDtosLocalized(app, rows), buildPageMetaWithCounts(rows, limit, counts)));
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

      const { enabled: enabledLocales } = await getLocaleSet(app);
      const sanitizedTranslations = translations ? sanitizeProductTranslations(translations) : {};

      const product = await app.prisma.$transaction(async (tx) => {
        const created = await tx.product.create({
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
            translations: sanitizedTranslations as Prisma.InputJsonValue,
            publishedAt: status === "PUBLISHED" ? new Date() : null,
            // Faz 4 (zamanlanmış yayın) — `CreateProductRequestSchema`'nın `refine`'ı zaten
            // `status === "SCHEDULED"` iken `scheduledAt`'in gelecekte dolu olmasını garanti eder.
            scheduledAt: status === "SCHEDULED" && scheduledAt ? new Date(scheduledAt) : null,
          },
          include: WITH_RELATIONS,
        });

        await syncContentSlugs(tx, enabledLocales, "PRODUCT", created.id, created.slug, created.translations);

        return created;
      });

      // §10.13.8 — `PRODUCT_CREATED` diğer içerik türlerinin aksine yayın durumuna BAĞLI DEĞİLDİR
      // (`Product`'ın bir `*_PUBLISHED` olayı YOKTUR); her başarılı `POST` tetikler.
      await emitWebhookEvent(app, "PRODUCT_CREATED", toPublicProductDto(product));

      return reply.code(201).send(ok(await toProductDtoLocalized(app, product)));
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
      return reply.send(ok(await toProductDtoLocalized(app, product)));
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
        sanitizedTranslations !== undefined ? mergeTranslations(existing.translations, sanitizedTranslations) : undefined;

      const { enabled: enabledLocales } = await getLocaleSet(app);

      const product = await app.prisma.$transaction(async (tx) => {
        const updated = await tx.product.update({
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

        if (slug !== undefined || mergedTranslations !== undefined) {
          await syncContentSlugs(tx, enabledLocales, "PRODUCT", updated.id, updated.slug, updated.translations);
        }

        return updated;
      });

      // §10.13.8 — `PRODUCT_UPDATED` yayın durumundan BAĞIMSIZ, her başarılı `PATCH`'te tetiklenir.
      await emitWebhookEvent(app, "PRODUCT_UPDATED", toPublicProductDto(product));

      return reply.send(ok(await toProductDtoLocalized(app, product)));
    }
  );

  // Faz 3 (autosave) — 3sn debounce ile frontend'den çağrılır. Bilinçli olarak `PATCH`'ten
  // AYRIDIR: `snapshotBeforeUpdate` (revizyon) ve `logAudit` ÇAĞIRMAZ (bkz. pages.routes.ts'teki
  // AYNI gerekçe). Ticari alanlar (fiyat/indirim/SKU/stok/durum/slug) BU UÇTAN DEĞİŞTİRİLEMEZ —
  // `AutosaveProductRequestSchema` şema seviyesinde zaten yalnızca title/excerpt/descriptionHtml içerir.
  server.post(
    "/:productId/autosave",
    {
      preHandler: requireSiteRole("ADMIN", "EDITOR"),
      schema: {
        params: ProductIdParamSchema,
        body: AutosaveProductRequestSchema,
        response: { 200: ApiSuccessSchema(AutosaveResponseSchema) },
      },
    },
    async (request, reply) => {
      const existing = await app.prisma.product.findUnique({ where: { id: request.params.productId } });
      if (!existing) throw new NotFoundError("Ürün bulunamadı.");

      if (existing.deletedAt) {
        throw new ConflictError("Çöpteki içerik düzenlenemez. Önce geri yükleyin.");
      }

      const { title, excerpt, descriptionHtml } = request.body;

      await app.prisma.product.update({
        where: { id: request.params.productId },
        data: {
          ...(title !== undefined ? { title } : {}),
          ...(excerpt !== undefined ? { excerpt } : {}),
          ...(descriptionHtml !== undefined ? { descriptionHtml: sanitizeRichHtml(descriptionHtml) } : {}),
        },
      });

      return reply.send(ok({ savedAt: new Date().toISOString() }));
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
      return reply.send(ok(await toProductDtoLocalized(app, product!)));
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

      await app.prisma.$transaction(async (tx) => {
        await tx.contentRevision.deleteMany({ where: { entityType: "PRODUCT", entityId: existing.id } });
        await deleteContentSlugsForEntity(tx, "PRODUCT", existing.id);
        await tx.product.delete({ where: { id: existing.id } });
      });

      // §10.13.8 — `PRODUCT_DELETED` = KALICI silme (soft-delete/çöp DEĞİL). `data = { id, slug }`
      // (kaynak artık yok, tam DTO üretilemez, bkz. ARCHITECTURE.md §10.13.9 istisnaları).
      await emitWebhookEvent(app, "PRODUCT_DELETED", { id: existing.id, slug: existing.slug });

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

      return reply.send(ok(await toProductDtoLocalized(app, product)));
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
      return reply.code(201).send(ok(await toProductDtoLocalized(app, updated!)));
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
      return reply.send(ok(await toProductDtoLocalized(app, updated)));
    }
  );

  // §10.1/§10.7 — toplu işlem. Ortak helper (bkz. ARCHITECTURE.md §10.1 karar 1A) — dört route
  // (page/blog_post/product/portfolio_item) BİREBİR aynı davranışı paylaşır.
  server.post(
    "/bulk",
    {
      preHandler: requireSiteRole("ADMIN", "EDITOR"),
      schema: { body: BulkContentActionRequestSchema, response: { 200: ApiSuccessSchema(BulkContentActionResultSchema) } },
    },
    async (request, reply) => {
      const result = await runBulkContentAction(
        app,
        {
          getDelegate: (client) => client.product as unknown as BulkContentDelegate,
          entityType: "PRODUCT",
          targetType: "Product",
          auditActionPrefix: "product.",
        },
        {
          ids: request.body.ids,
          action: request.body.action,
          actor: { id: request.user!.id, email: request.user!.email, role: request.user!.role },
          ip: request.ip,
        }
      );

      return reply.send(ok(result));
    }
  );

  // §10.1 İçerik Sürüm Kontrolü — yetki eşiği ürün düzenleme ile aynı (ADMIN+EDITOR). `Page`/
  // `BlogPost` ile BİREBİR AYNI sözleşme (bkz. lib/content-revisions.ts::listContentRevisions).
  server.get(
    "/:productId/revisions",
    {
      preHandler: requireSiteRole("ADMIN", "EDITOR"),
      schema: {
        params: ProductIdParamSchema,
        querystring: CursorQuerySchema,
        response: { 200: ApiSuccessSchema(z.array(ContentRevisionSummarySchema)) },
      },
    },
    async (request, reply) => {
      const { rows, nextCursor } = await listContentRevisions(app, "PRODUCT", request.params.productId, request.query);
      return reply.send(ok(rows.map(toContentRevisionSummaryDto), { nextCursor }));
    }
  );

  server.get(
    "/:productId/revisions/:revisionId",
    {
      preHandler: requireSiteRole("ADMIN", "EDITOR"),
      schema: { params: ProductRevisionIdParamSchema, response: { 200: ApiSuccessSchema(ContentRevisionSchema) } },
    },
    async (request, reply) => {
      const revision = await getContentRevisionOrThrow(app, "PRODUCT", request.params.productId, request.params.revisionId);
      return reply.send(ok(toContentRevisionDto(revision)));
    }
  );

  // `Page`/`BlogPost`'tan TEK FARK — 422 dalı vardır (çapraz-alan doğrulaması, bkz.
  // ARCHITECTURE.md §10.1). Ayrıca `Product`'a özgü: snapshot uygulanmadan önce çöp kontrolü de
  // yapılır (öğe çöpteyse 409) — bkz. openapi.yaml bu ucun 409 açıklaması.
  server.post(
    "/:productId/revisions/:revisionId/restore",
    {
      preHandler: requireSiteRole("ADMIN", "EDITOR"),
      schema: { params: ProductRevisionIdParamSchema, response: { 200: ApiSuccessSchema(ProductSchema) } },
    },
    async (request, reply) => {
      const existing = await app.prisma.product.findUnique({ where: { id: request.params.productId } });
      if (!existing) throw new NotFoundError("Ürün bulunamadı.");

      if (existing.deletedAt) {
        throw new ConflictError("Çöpteki içerik düzenlenemez. Önce geri yükleyin.");
      }

      const revision = await getContentRevisionOrThrow(app, "PRODUCT", request.params.productId, request.params.revisionId);

      const snapshot = revision.snapshot as {
        title: string;
        slug: string;
        excerpt: string | null;
        descriptionHtml: string;
        priceCents: number;
        currency: string;
        taxRatePercent: number | null;
        discountPriceCents: number | null;
        sku: string | null;
        stockQuantity: number;
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

      // `PATCH /admin/products/{productId}` ile AYNI çapraz-alan doğrulaması — düşerse hiçbir
      // şey yazılmaz (henüz hiçbir write yapılmadı) ve 422 döner.
      assertDiscountBelowPrice(snapshot.priceCents, snapshot.discountPriceCents);

      // Geri dönüş de geri alınabilir olsun diye önce mevcut state'i yeni bir revizyon olarak kaydet.
      await snapshotBeforeUpdate(app, "PRODUCT", existing.id, toProductSnapshot(existing), request.user!.id);

      const { enabled: enabledLocales } = await getLocaleSet(app);
      const sanitizedTranslations = snapshot.translations
        ? sanitizeProductTranslations(snapshot.translations as Record<string, Record<string, unknown> | null>)
        : {};

      const product = await app.prisma.$transaction(async (tx) => {
        const updated = await tx.product.update({
          where: { id: request.params.productId },
          data: {
            title: snapshot.title,
            slug: snapshot.slug,
            excerpt: snapshot.excerpt,
            // Savunmada derinlik: bu sanitizasyon eklenmeden ÖNCE kaydedilmiş eski revizyonlar
            // temizlenmemiş HTML içerebilir — geri yükleme her zaman yeniden sanitize eder.
            descriptionHtml: sanitizeRichHtml(snapshot.descriptionHtml),
            priceCents: snapshot.priceCents,
            currency: snapshot.currency,
            taxRatePercent: snapshot.taxRatePercent,
            discountPriceCents: snapshot.discountPriceCents,
            sku: snapshot.sku,
            stockQuantity: snapshot.stockQuantity,
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

        await syncContentSlugs(tx, enabledLocales, "PRODUCT", updated.id, updated.slug, updated.translations);

        return updated;
      });

      return reply.send(ok(await toProductDtoLocalized(app, product)));
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
    {
      schema: {
        querystring: CursorQuerySchema.merge(LocaleQuerySchema),
        response: { 200: ApiSuccessSchema(z.array(ProductSchema)) },
      },
    },
    async (request, reply) => {
      const { cursor, limit } = request.query;
      const cursorSeq = parseCursor(cursor);

      const rows = await app.prisma.product.findMany({
        where: { status: "PUBLISHED", deletedAt: null, ...(cursorSeq ? { seq: { gt: cursorSeq } } : {}) },
        orderBy: { seq: "asc" },
        take: limit,
        include: WITH_RELATIONS,
      });

      const localeSet = await getLocaleSet(app);
      const effectiveLocale = resolveEffectiveLocaleCode(localeSet, request.query.locale);
      const localizationsByEntity = await attachLocalizations(app, "PRODUCT", rows);

      const dtos = rows.map((row) =>
        toProductDto(applyProductLocale(row, effectiveLocale), localizationsByEntity.get(row.id) ?? [])
      );

      return reply.send(ok(dtos, buildPageMeta(rows, limit)));
    }
  );

  server.get(
    "/:slug",
    {
      schema: { params: ProductSlugParamSchema, querystring: LocaleQuerySchema, response: { 200: ApiSuccessSchema(ProductSchema) } },
    },
    async (request, reply) => {
      const localeSet = await getLocaleSet(app);
      const effectiveLocale = resolveEffectiveLocaleCode(localeSet, request.query.locale);

      // §0.1b/§4 — ÖNCELİK 1 düzeltmesi: artık `/pages`/`/blog` ile BİREBİR AYNI slug çözümlemesi.
      const translatedEntityId = await resolveEntityIdBySlug(app, "PRODUCT", request.params.slug, effectiveLocale);
      const product = translatedEntityId
        ? await app.prisma.product.findFirst({
            where: { id: translatedEntityId, status: "PUBLISHED", deletedAt: null },
            include: WITH_RELATIONS,
          })
        : null;
      const resolvedProduct =
        product ??
        (await app.prisma.product.findFirst({
          where: { slug: request.params.slug, status: "PUBLISHED", deletedAt: null },
          include: WITH_RELATIONS,
        }));
      if (!resolvedProduct) throw new NotFoundError("Ürün bulunamadı.");

      const localizations = await attachLocalizationsOne(app, "PRODUCT", resolvedProduct);
      return reply.send(ok(toProductDto(applyProductLocale(resolvedProduct, effectiveLocale), localizations)));
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
