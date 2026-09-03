import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import type { Media, Product } from "@prisma/client";
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
import { isImageMimeType } from "../../lib/mime-detect";
import { resolveEffectivePrice } from "../../lib/product-pricing";
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
import {
  assertOptionValuesMatchAxes,
  assertVariantCountWithinLimit,
  deriveVariantKey,
  type ProductVariantOption,
} from "./lib/variants";
import { emitWebhookEvent } from "../../lib/webhook-emitter";
import { toPublicProductDto } from "../public-api/public-api.mappers";
import {
  AddProductDocumentRequestSchema,
  AddProductImageRequestSchema,
  AdjustProductStockRequestSchema,
  AutosaveProductRequestSchema,
  CreateProductCategoryRequestSchema,
  CreateProductRequestSchema,
  CreateProductVariantRequestSchema,
  ListProductsQuerySchema,
  LocaleQuerySchema,
  ProductCategoryIdParamSchema,
  ProductDocumentIdParamSchema,
  ProductIdParamSchema,
  ProductImageIdParamSchema,
  ProductRevisionIdParamSchema,
  ProductSlugParamSchema,
  ProductVariantIdParamSchema,
  UpdateProductCategoryRequestSchema,
  UpdateProductRequestSchema,
  UpdateProductVariantRequestSchema,
} from "./products.schemas";

/**
 * §2.2 madde 5 (.claude/architect-scope-ecommerce-pro-template.md, bağlayıcı) — görsel bekleyen
 * FK slotu (`Product.coverMediaId`, `ProductImage.mediaId`, `ProductVariant.mediaId`)
 * `mimeType` `image/` ile başlamıyorsa 422. `mediaId` bulunamazsa 404.
 */
async function assertImageMedia(app: FastifyInstance, mediaId: string): Promise<void> {
  const media = await app.prisma.media.findUnique({ where: { id: mediaId } });
  if (!media) throw new NotFoundError("Medya bulunamadı.");
  if (!isImageMimeType(media.mimeType)) {
    throw new ValidationError("Bu alan yalnızca görsel medya kabul eder.", {
      mediaId: ["Seçilen dosya bir görsel değil."],
    });
  }
}

/** `ProductDocument.mediaId` `application/pdf` DEĞİLSE 422 (§2.2 madde 5). Bulunan `Media` satırını döner. */
async function assertPdfMedia(app: FastifyInstance, mediaId: string): Promise<Media> {
  const media = await app.prisma.media.findUnique({ where: { id: mediaId } });
  if (!media) throw new NotFoundError("Medya bulunamadı.");
  if (media.mimeType !== "application/pdf") {
    throw new ValidationError("Bu alan yalnızca PDF döküman kabul eder.", {
      mediaId: ["Seçilen dosya bir PDF değil."],
    });
  }
  return media;
}

/** `discountPriceCents` (varsa) etkin `priceCents`'ten (miras/mutlak kuralı uygulanmış) KÜÇÜK olmalı (openapi.yaml::ProductVariant notu). */
function assertVariantDiscountBelowPrice(product: Product, finalPriceCents: number | null, finalDiscountPriceCents: number | null): void {
  if (finalDiscountPriceCents === null) return;
  const { priceCents: effectivePriceCents } = resolveEffectivePrice(product, { priceCents: finalPriceCents, discountPriceCents: null });
  if (finalDiscountPriceCents >= effectivePriceCents) {
    throw new ValidationError("discountPriceCents, etkin priceCents değerinden küçük olmalıdır.", {
      discountPriceCents: ["discountPriceCents, etkin priceCents değerinden küçük olmalıdır."],
    });
  }
}

/** Ürün detay/liste sorgularında kategori + kapak görseli + galeri + yazar özetini de dönmek için.
 * §1/§2 (.claude/architect-scope-ecommerce-pro-template.md) — varyasyon + döküman de AYNI şekilde eklenir. */
const WITH_RELATIONS = {
  category: true,
  coverMedia: true,
  author: true,
  images: { include: { media: true }, orderBy: { order: "asc" as const } },
  variants: { include: { media: true }, orderBy: { order: "asc" as const } },
  documents: { include: { media: true }, orderBy: { order: "asc" as const } },
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
  server.addHook("preHandler", requirePanelAccess());

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
      preHandler: requireSiteRole(...ROLES_ADMIN_MANAGER),
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
        variantOptions,
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

      // §2.2 madde 5 — kapak görseli slotu görsel DIŞINDAKİ medyayı reddeder (422).
      if (coverMediaId) {
        await assertImageMedia(app, coverMediaId);
      }

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
            // §1 — verilmezse Prisma `@default("[]")` kolonu kullanır.
            variantOptions: (variantOptions ?? []) as Prisma.InputJsonValue,
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
      preHandler: requireSiteRole(...ROLES_ADMIN_MANAGER),
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

      // §2.2 madde 5 — kapak görseli slotu görsel DIŞINDAKİ medyayı reddeder (422). `null`
      // (kapağı kaldır) doğrulama GEREKTİRMEZ.
      if (request.body.coverMediaId) {
        await assertImageMedia(app, request.body.coverMediaId);
      }

      const { slug, translations, authorId: requestedAuthorId, scheduledAt, variantOptions, ...rest } = request.body;

      // §1 — eksen tanımları TAMAMEN DEĞİŞTİRİLİYORSA (tam-replace), mevcut `ProductVariant`
      // satırlarından herhangi biri yeni tanımla UYUŞMUYORSA 409 (sessizce yetim varyasyon
      // BIRAKILMAZ — openapi.yaml::UpdateProductRequest.variantOptions notu).
      if (variantOptions !== undefined) {
        const existingVariants = await app.prisma.productVariant.findMany({ where: { productId: existing.id } });
        for (const variant of existingVariants) {
          try {
            assertOptionValuesMatchAxes(variant.optionValues as Record<string, string>, variantOptions as ProductVariantOption[]);
          } catch {
            throw new ConflictError(
              "Mevcut varyasyonlardan en az biri yeni `variantOptions` tanımıyla uyuşmuyor. Önce ilgili varyasyonları silin."
            );
          }
        }
      }

      await snapshotBeforeUpdate(app, "PRODUCT", existing.id, toProductSnapshot(existing), request.user!.id);

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
            ...(variantOptions !== undefined ? { variantOptions: variantOptions as Prisma.InputJsonValue } : {}),
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
      preHandler: requireSiteRole(...ROLES_ADMIN_MANAGER),
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
      preHandler: requireSiteRole(...ROLES_ADMIN_MANAGER),
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
      preHandler: requireSiteRole(...ROLES_ADMIN_MANAGER),
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
      preHandler: requireSiteRole(...ROLES_ADMIN_MANAGER),
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
      preHandler: requireSiteRole(...ROLES_ADMIN_MANAGER),
      schema: {
        params: ProductIdParamSchema,
        body: AdjustProductStockRequestSchema,
        response: { 200: ApiSuccessSchema(ProductSchema) },
      },
    },
    async (request, reply) => {
      const existing = await app.prisma.product.findUnique({ where: { id: request.params.productId } });
      if (!existing) throw new NotFoundError("Ürün bulunamadı.");

      // §1.2 (bağlayıcı) — varyasyonlu üründe ürün seviyesi stok SALT-OKUNURDUR; stok
      // varyasyondan okunur/yönetilir (bkz. `POST/PATCH .../variants`). Sessizce yok sayılan bir
      // yazma yerine 409 CONFLICT.
      const variantCount = await app.prisma.productVariant.count({ where: { productId: existing.id } });
      if (variantCount > 0) {
        throw new ConflictError(
          "Bu ürün varyasyonlu — stok varyasyon seviyesinde yönetilir. Ürün seviyesi stok salt-okunurdur."
        );
      }

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
      preHandler: requireSiteRole(...ROLES_ADMIN_MANAGER),
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

      // §2.2 madde 5 — galeri yalnızca görsel kabul eder (422).
      if (!isImageMimeType(media.mimeType)) {
        throw new ValidationError("Galeriye yalnızca görsel medya eklenebilir.", {
          mediaId: ["Seçilen dosya bir görsel değil."],
        });
      }

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
      preHandler: requireSiteRole(...ROLES_ADMIN_MANAGER),
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

  // ---------------------------------------------------------------------------
  // §1 (.claude/architect-scope-ecommerce-pro-template.md, bağlayıcı) — varyasyon CRUD.
  // `optionValues` sunucu tarafından `Product.variantOptions` eksen tanımına göre doğrulanır,
  // `variantKey` sunucu türetir (istemci ASLA göndermez).
  // ---------------------------------------------------------------------------

  server.post(
    "/:productId/variants",
    {
      preHandler: requireSiteRole(...ROLES_ADMIN_MANAGER),
      schema: {
        params: ProductIdParamSchema,
        body: CreateProductVariantRequestSchema,
        response: { 201: ApiSuccessSchema(ProductSchema) },
      },
    },
    async (request, reply) => {
      const product = await app.prisma.product.findUnique({ where: { id: request.params.productId } });
      if (!product) throw new NotFoundError("Ürün bulunamadı.");

      const axes = (product.variantOptions as ProductVariantOption[] | null) ?? [];
      if (axes.length === 0) {
        throw new ValidationError("Bu ürünün varyasyon ekseni tanımlı değil. Önce `variantOptions` tanımlayın.", {
          optionValues: ["Ürünün `variantOptions` tanımı boş."],
        });
      }

      assertOptionValuesMatchAxes(request.body.optionValues, axes);
      const variantKey = deriveVariantKey(request.body.optionValues);

      const currentCount = await app.prisma.productVariant.count({ where: { productId: product.id } });
      assertVariantCountWithinLimit(currentCount);

      // `@@unique([productId, variantKey])` — özel ön kontrol, genel P2002 fallback'inden daha
      // anlamlı bir mesaj verir (bkz. plugins/error-handler.ts).
      const existingByKey = await app.prisma.productVariant.findUnique({
        where: { productId_variantKey: { productId: product.id, variantKey } },
      });
      if (existingByKey) throw new ConflictError("Bu eksen kombinasyonu zaten mevcut.");

      if (request.body.sku) {
        const skuClash = await app.prisma.productVariant.findUnique({ where: { sku: request.body.sku } });
        if (skuClash) throw new ConflictError("Bu SKU başka bir varyasyonda kullanılıyor.");
      }

      if (request.body.mediaId) {
        await assertImageMedia(app, request.body.mediaId);
      }

      const finalPriceCents = request.body.priceCents ?? null;
      const finalDiscountPriceCents = request.body.discountPriceCents ?? null;
      assertVariantDiscountBelowPrice(product, finalPriceCents, finalDiscountPriceCents);

      await app.prisma.productVariant.create({
        data: {
          productId: product.id,
          variantKey,
          optionValues: request.body.optionValues,
          sku: request.body.sku ?? null,
          priceCents: finalPriceCents,
          discountPriceCents: finalDiscountPriceCents,
          stockQuantity: request.body.stockQuantity ?? 0,
          mediaId: request.body.mediaId ?? null,
          order: request.body.order ?? 0,
          isActive: request.body.isActive ?? true,
        },
      });

      const updated = await app.prisma.product.findUnique({ where: { id: product.id }, include: WITH_RELATIONS });
      return reply.code(201).send(ok(await toProductDtoLocalized(app, updated!)));
    }
  );

  server.patch(
    "/:productId/variants/:variantId",
    {
      preHandler: requireSiteRole(...ROLES_ADMIN_MANAGER),
      schema: {
        params: ProductVariantIdParamSchema,
        body: UpdateProductVariantRequestSchema,
        response: { 200: ApiSuccessSchema(ProductSchema) },
      },
    },
    async (request, reply) => {
      const { productId, variantId } = request.params;
      const product = await app.prisma.product.findUnique({ where: { id: productId } });
      if (!product) throw new NotFoundError("Ürün bulunamadı.");

      // IDOR koruması — `variantId`'nin GERÇEKTEN bu `productId`'ye ait olduğu doğrulanır
      // (`.../images/{imageId}` ile AYNI kural).
      const variant = await app.prisma.productVariant.findUnique({ where: { id: variantId } });
      if (!variant || variant.productId !== productId) throw new NotFoundError("Varyasyon bulunamadı.");

      const { sku, priceCents, discountPriceCents, stockQuantity, mediaId, order, isActive } = request.body;

      if (sku) {
        const skuClash = await app.prisma.productVariant.findFirst({ where: { sku, id: { not: variant.id } } });
        if (skuClash) throw new ConflictError("Bu SKU başka bir varyasyonda kullanılıyor.");
      }

      if (mediaId) {
        await assertImageMedia(app, mediaId);
      }

      const finalPriceCents = priceCents !== undefined ? priceCents : variant.priceCents;
      const finalDiscountPriceCents = discountPriceCents !== undefined ? discountPriceCents : variant.discountPriceCents;
      assertVariantDiscountBelowPrice(product, finalPriceCents, finalDiscountPriceCents);

      await app.prisma.productVariant.update({
        where: { id: variant.id },
        data: {
          ...(sku !== undefined ? { sku } : {}),
          ...(priceCents !== undefined ? { priceCents } : {}),
          ...(discountPriceCents !== undefined ? { discountPriceCents } : {}),
          ...(stockQuantity !== undefined ? { stockQuantity } : {}),
          ...(mediaId !== undefined ? { mediaId } : {}),
          ...(order !== undefined ? { order } : {}),
          ...(isActive !== undefined ? { isActive } : {}),
        },
      });

      const updated = await app.prisma.product.findUnique({ where: { id: productId }, include: WITH_RELATIONS });
      return reply.send(ok(await toProductDtoLocalized(app, updated!)));
    }
  );

  server.delete(
    "/:productId/variants/:variantId",
    {
      preHandler: requireSiteRole(...ROLES_ADMIN_MANAGER),
      schema: { params: ProductVariantIdParamSchema, response: { 200: ApiSuccessSchema(ProductSchema) } },
    },
    async (request, reply) => {
      const { productId, variantId } = request.params;
      const variant = await app.prisma.productVariant.findUnique({ where: { id: variantId } });
      if (!variant || variant.productId !== productId) throw new NotFoundError("Varyasyon bulunamadı.");

      // `CartItem` satırları `Cascade` ile silinir; `OrderItem.variantId` `SetNull` olur ve
      // `variantLabel` SNAPSHOT'ı KALIR — sipariş geçmişi BOZULMAZ (bkz. schema.prisma notu).
      await app.prisma.productVariant.delete({ where: { id: variant.id } });

      const updated = await app.prisma.product.findUnique({ where: { id: productId }, include: WITH_RELATIONS });
      if (!updated) throw new NotFoundError("Ürün bulunamadı.");
      return reply.send(ok(await toProductDtoLocalized(app, updated)));
    }
  );

  // ---------------------------------------------------------------------------
  // §2 (.claude/architect-scope-ecommerce-pro-template.md, bağlayıcı) — teknik döküman (PDF) CRUD.
  // `POST .../images` ile BİREBİR AYNI davranış; EK KURAL: `mediaId` `application/pdf` DEĞİLSE 422.
  // ---------------------------------------------------------------------------

  server.post(
    "/:productId/documents",
    {
      preHandler: requireSiteRole(...ROLES_ADMIN_MANAGER),
      schema: {
        params: ProductIdParamSchema,
        body: AddProductDocumentRequestSchema,
        response: { 201: ApiSuccessSchema(ProductSchema) },
      },
    },
    async (request, reply) => {
      const product = await app.prisma.product.findUnique({ where: { id: request.params.productId } });
      if (!product) throw new NotFoundError("Ürün bulunamadı.");

      const media = await assertPdfMedia(app, request.body.mediaId);

      const existingDoc = await app.prisma.productDocument.findUnique({
        where: { productId_mediaId: { productId: product.id, mediaId: media.id } },
      });
      if (existingDoc) throw new ConflictError("Bu döküman zaten ürüne ekli.");

      const lastDoc = await app.prisma.productDocument.findFirst({
        where: { productId: product.id },
        orderBy: { order: "desc" },
      });

      await app.prisma.productDocument.create({
        data: {
          productId: product.id,
          mediaId: media.id,
          // Boş bırakılırsa `media.filename` kullanılır (openapi.yaml::ProductDocument.title notu).
          title: request.body.title?.trim() || media.filename,
          order: lastDoc ? lastDoc.order + 1 : 0,
        },
      });

      const updated = await app.prisma.product.findUnique({ where: { id: product.id }, include: WITH_RELATIONS });
      return reply.code(201).send(ok(await toProductDtoLocalized(app, updated!)));
    }
  );

  server.delete(
    "/:productId/documents/:documentId",
    {
      preHandler: requireSiteRole(...ROLES_ADMIN_MANAGER),
      schema: { params: ProductDocumentIdParamSchema, response: { 200: ApiSuccessSchema(ProductSchema) } },
    },
    async (request, reply) => {
      const { productId, documentId } = request.params;
      const doc = await app.prisma.productDocument.findUnique({ where: { id: documentId } });
      if (!doc || doc.productId !== productId) throw new NotFoundError("Döküman bulunamadı.");

      // Yalnızca BAĞ kaldırılır — `Media` satırı ve diskteki dosya SİLİNMEZ (§10.11.3 ile aynı ilke).
      await app.prisma.productDocument.delete({ where: { id: doc.id } });

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
      preHandler: requireSiteRole(...ROLES_ADMIN_MANAGER),
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
      preHandler: requireSiteRole(...ROLES_ADMIN_MANAGER),
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
      preHandler: requireSiteRole(...ROLES_ADMIN_MANAGER),
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
      preHandler: requireSiteRole(...ROLES_ADMIN_MANAGER),
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
  server.addHook("preHandler", requirePanelAccess());

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
      preHandler: requireSiteRole(...ROLES_ADMIN_MANAGER),
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
      preHandler: requireSiteRole(...ROLES_ADMIN_MANAGER),
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
      preHandler: requireSiteRole(...ROLES_ADMIN_MANAGER),
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
