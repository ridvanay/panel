import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { requireApiKey } from "../../middleware/api-key-auth";
import { requireModuleEnabled } from "../../middleware/module-guard";
import { checkApiKeyRateLimit } from "../../lib/api-key-rate-limit";
import { PUBLIC_API_IP_RATE_LIMIT } from "../../lib/rate-limit";
import { ApiError, NotFoundError } from "../../lib/errors";
import { ok } from "../../lib/envelope";
import { ApiSuccessSchema } from "../../schemas/common";
import {
  PublicApiKeyInfoSchema,
  PublicBlogPostSchema,
  PublicCategorySchema,
  PublicPageSchema,
  PublicPortfolioItemSchema,
  PublicProductSchema,
} from "../../schemas/entities";
import { parseCursor, buildPageMeta } from "../../lib/pagination";
import {
  applyFieldLocalization,
  getLocaleSet,
  isLocaleTranslated,
  resolveEffectiveLocaleCode,
  resolveEntityIdBySlug,
} from "../../lib/localization";
import {
  toPublicBlogPostDto,
  toPublicCategoryDto,
  toPublicPageDto,
  toPublicPortfolioItemDto,
  toPublicProductDto,
} from "./public-api.mappers";
import { PublicListQuerySchema, PublicListWithCategoryQuerySchema, PublicSlugParamSchema } from "./public-api.schemas";

/**
 * `/public` prefix'i altında bağlanır (nihai: `/api/v1/public/*`, bkz. app.ts). §10.13.4/§10.13.5
 * — SALT-OKUNUR (yalnızca GET), kimlik doğrulama `X-Api-Key` (`Authorization: Bearer` KABUL
 * EDİLMEZ). CORS mevcut global politika DEĞİŞTİRİLMEZ (`/public/*` için `origin: "*"` AÇILMAZ) —
 * bu katman sunucudan-sunucuya kullanım içindir.
 */

const IP_LAYER = { rateLimit: PUBLIC_API_IP_RATE_LIMIT };

const PRODUCT_WITH_RELATIONS = { category: true, coverMedia: true, images: { include: { media: true }, orderBy: { order: "asc" as const } } };
const PORTFOLIO_WITH_RELATIONS = { category: true, coverMedia: true, images: { include: { media: true }, orderBy: { order: "asc" as const } } };

/**
 * §10.13.6 Katman 2 — doğrulanmış `ApiKey.id` başına kota, `requireApiKey` preHandler'ından
 * SONRA çalışır. `x-ratelimit-*` header'ları HER `/public/*` yanıtında (başarı VEYA 429) döner
 * ve Katman 2'nin değerlerini taşır (Katman 1 sessiz bir tabandır).
 */
async function enforceApiKeyRateLimit(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const result = checkApiKeyRateLimit(request.apiKey!.id);
  request.apiKeyRateLimit = result;

  reply.header("x-ratelimit-limit", String(result.limit));
  reply.header("x-ratelimit-remaining", String(result.remaining));
  reply.header("x-ratelimit-reset", String(result.resetSeconds));

  if (!result.allowed) {
    reply.header("retry-after", String(result.resetSeconds));
    throw new ApiError(429, "RATE_LIMITED", `Çok fazla istek. ${result.resetSeconds} saniye sonra tekrar deneyin.`);
  }
}

export async function publicApiRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>();
  server.addHook("preHandler", requireApiKey("READ"));
  server.addHook("preHandler", enforceApiKeyRateLimit);

  server.get(
    "/me",
    { config: IP_LAYER, schema: { response: { 200: ApiSuccessSchema(PublicApiKeyInfoSchema) } } },
    async (request, reply) => {
      const rateLimit = request.apiKeyRateLimit!;
      return reply.send(
        ok({
          name: request.apiKey!.name,
          scope: request.apiKey!.scope,
          expiresAt: request.apiKey!.expiresAt ? request.apiKey!.expiresAt.toISOString() : null,
          rateLimit,
        })
      );
    }
  );

  // ---------------------------------------------------------------------------
  // Sayfalar
  // ---------------------------------------------------------------------------

  server.get(
    "/pages",
    { config: IP_LAYER, schema: { querystring: PublicListQuerySchema, response: { 200: ApiSuccessSchema(z.array(PublicPageSchema)) } } },
    async (request, reply) => {
      const { cursor, limit, locale } = request.query;
      const cursorSeq = parseCursor(cursor);
      const localeSet = await getLocaleSet(app);
      const effectiveLocale = resolveEffectiveLocaleCode(localeSet, locale);

      const rows = await app.prisma.page.findMany({
        where: { status: "PUBLISHED", deletedAt: null, ...(cursorSeq ? { seq: { gt: cursorSeq } } : {}) },
        orderBy: { seq: "asc" },
        take: limit,
      });

      const dtos = rows.map((row) => {
        const translated = effectiveLocale ? isLocaleTranslated(row.translations, effectiveLocale) : true;
        const localized = applyPublicPageLocale(row, effectiveLocale, translated);
        return toPublicPageDto(localized);
      });

      return reply.send(ok(dtos, buildPageMeta(rows, limit)));
    }
  );

  server.get(
    "/pages/:slug",
    {
      config: IP_LAYER,
      schema: { params: PublicSlugParamSchema, querystring: PublicListQuerySchema.pick({ locale: true }), response: { 200: ApiSuccessSchema(PublicPageSchema) } },
    },
    async (request, reply) => {
      const localeSet = await getLocaleSet(app);
      const effectiveLocale = resolveEffectiveLocaleCode(localeSet, request.query.locale);

      const translatedEntityId = await resolveEntityIdBySlug(app, "PAGE", request.params.slug, effectiveLocale);
      const page = translatedEntityId
        ? await app.prisma.page.findFirst({ where: { id: translatedEntityId, status: "PUBLISHED", deletedAt: null } })
        : null;
      const resolved = page ?? (await app.prisma.page.findFirst({ where: { slug: request.params.slug, status: "PUBLISHED", deletedAt: null } }));
      if (!resolved) throw new NotFoundError("Sayfa bulunamadı.");

      const translated = effectiveLocale ? isLocaleTranslated(resolved.translations, effectiveLocale) : true;
      return reply.send(ok(toPublicPageDto(applyPublicPageLocale(resolved, effectiveLocale, translated))));
    }
  );

  // ---------------------------------------------------------------------------
  // Blog
  // ---------------------------------------------------------------------------

  server.get(
    "/blog",
    {
      config: IP_LAYER,
      schema: { querystring: PublicListWithCategoryQuerySchema, response: { 200: ApiSuccessSchema(z.array(PublicBlogPostSchema)) } },
    },
    async (request, reply) => {
      const { cursor, limit, locale, category } = request.query;
      const cursorSeq = parseCursor(cursor);
      const localeSet = await getLocaleSet(app);
      const effectiveLocale = resolveEffectiveLocaleCode(localeSet, locale);

      const rows = await app.prisma.blogPost.findMany({
        where: {
          status: "PUBLISHED",
          deletedAt: null,
          ...(cursorSeq ? { seq: { gt: cursorSeq } } : {}),
          ...(category ? { category: { slug: category } } : {}),
        },
        orderBy: { seq: "asc" },
        take: limit,
        include: { category: true },
      });

      const dtos = rows.map((row) => toPublicBlogPostDto(applyPublicBlogPostLocale(row, effectiveLocale)));
      return reply.send(ok(dtos, buildPageMeta(rows, limit)));
    }
  );

  server.get(
    "/blog/categories",
    { config: IP_LAYER, schema: { response: { 200: ApiSuccessSchema(z.array(PublicCategorySchema)) } } },
    async (_request, reply) => {
      const rows = await app.prisma.blogCategory.findMany({ orderBy: { seq: "asc" } });
      return reply.send(ok(rows.map(toPublicCategoryDto)));
    }
  );

  server.get(
    "/blog/:slug",
    {
      config: IP_LAYER,
      schema: { params: PublicSlugParamSchema, querystring: PublicListQuerySchema.pick({ locale: true }), response: { 200: ApiSuccessSchema(PublicBlogPostSchema) } },
    },
    async (request, reply) => {
      const localeSet = await getLocaleSet(app);
      const effectiveLocale = resolveEffectiveLocaleCode(localeSet, request.query.locale);

      const translatedEntityId = await resolveEntityIdBySlug(app, "BLOG_POST", request.params.slug, effectiveLocale);
      const post = translatedEntityId
        ? await app.prisma.blogPost.findFirst({ where: { id: translatedEntityId, status: "PUBLISHED", deletedAt: null }, include: { category: true } })
        : null;
      const resolved =
        post ?? (await app.prisma.blogPost.findFirst({ where: { slug: request.params.slug, status: "PUBLISHED", deletedAt: null }, include: { category: true } }));
      if (!resolved) throw new NotFoundError("Blog yazısı bulunamadı.");

      return reply.send(ok(toPublicBlogPostDto(applyPublicBlogPostLocale(resolved, effectiveLocale))));
    }
  );

  // ---------------------------------------------------------------------------
  // Ürünler — `requireModuleEnabled("products")` guard'lı (modül kapalıysa 404).
  // ---------------------------------------------------------------------------

  server.get(
    "/products",
    {
      config: IP_LAYER,
      preHandler: requireModuleEnabled("products"),
      schema: {
        querystring: PublicListWithCategoryQuerySchema.extend({ search: z.string().min(1).optional() }),
        response: { 200: ApiSuccessSchema(z.array(PublicProductSchema)) },
      },
    },
    async (request, reply) => {
      const { cursor, limit, locale, category, search } = request.query;
      const cursorSeq = parseCursor(cursor);
      const localeSet = await getLocaleSet(app);
      const effectiveLocale = resolveEffectiveLocaleCode(localeSet, locale);

      const rows = await app.prisma.product.findMany({
        where: {
          status: "PUBLISHED",
          deletedAt: null,
          ...(cursorSeq ? { seq: { gt: cursorSeq } } : {}),
          ...(category ? { category: { slug: category } } : {}),
          ...(search
            ? { OR: [{ title: { contains: search, mode: "insensitive" } }, { sku: { contains: search, mode: "insensitive" } }] }
            : {}),
        },
        orderBy: { seq: "asc" },
        take: limit,
        include: PRODUCT_WITH_RELATIONS,
      });

      const dtos = rows.map((row) => toPublicProductDto(applyPublicProductLocale(row, effectiveLocale)));
      return reply.send(ok(dtos, buildPageMeta(rows, limit)));
    }
  );

  server.get(
    "/products/categories",
    {
      config: IP_LAYER,
      preHandler: requireModuleEnabled("products"),
      schema: { response: { 200: ApiSuccessSchema(z.array(PublicCategorySchema)) } },
    },
    async (_request, reply) => {
      const rows = await app.prisma.productCategory.findMany({ orderBy: { seq: "asc" } });
      return reply.send(ok(rows.map(toPublicCategoryDto)));
    }
  );

  server.get(
    "/products/:slug",
    {
      config: IP_LAYER,
      preHandler: requireModuleEnabled("products"),
      schema: { params: PublicSlugParamSchema, querystring: PublicListQuerySchema.pick({ locale: true }), response: { 200: ApiSuccessSchema(PublicProductSchema) } },
    },
    async (request, reply) => {
      const localeSet = await getLocaleSet(app);
      const effectiveLocale = resolveEffectiveLocaleCode(localeSet, request.query.locale);

      const translatedEntityId = await resolveEntityIdBySlug(app, "PRODUCT", request.params.slug, effectiveLocale);
      const product = translatedEntityId
        ? await app.prisma.product.findFirst({ where: { id: translatedEntityId, status: "PUBLISHED", deletedAt: null }, include: PRODUCT_WITH_RELATIONS })
        : null;
      const resolved =
        product ??
        (await app.prisma.product.findFirst({ where: { slug: request.params.slug, status: "PUBLISHED", deletedAt: null }, include: PRODUCT_WITH_RELATIONS }));
      if (!resolved) throw new NotFoundError("Ürün bulunamadı.");

      return reply.send(ok(toPublicProductDto(applyPublicProductLocale(resolved, effectiveLocale))));
    }
  );

  // ---------------------------------------------------------------------------
  // Portföy — `requireModuleEnabled("portfolio")` guard'lı. Manuel `order asc` sıralanır (§10.9.4).
  // ---------------------------------------------------------------------------

  server.get(
    "/portfolio",
    {
      config: IP_LAYER,
      preHandler: requireModuleEnabled("portfolio"),
      schema: { querystring: PublicListWithCategoryQuerySchema, response: { 200: ApiSuccessSchema(z.array(PublicPortfolioItemSchema)) } },
    },
    async (request, reply) => {
      const { cursor, limit, locale, category } = request.query;
      const cursorSeq = parseCursor(cursor);
      const localeSet = await getLocaleSet(app);
      const effectiveLocale = resolveEffectiveLocaleCode(localeSet, locale);

      const rows = await app.prisma.portfolioItem.findMany({
        where: {
          status: "PUBLISHED",
          deletedAt: null,
          ...(cursorSeq ? { seq: { gt: cursorSeq } } : {}),
          ...(category ? { category: { slug: category } } : {}),
        },
        orderBy: { order: "asc" },
        take: limit,
        include: PORTFOLIO_WITH_RELATIONS,
      });

      const dtos = rows.map((row) => toPublicPortfolioItemDto(applyPublicPortfolioLocale(row, effectiveLocale)));
      // Portföy `order asc` ile sıralanır — cursor `seq` bazlı OLMADIĞI için `buildPageMeta`
      // (seq'e dayalı) burada KULLANILAMAZ; mevcut `/portfolio` public ucuyla AYNI kısıt: liste
      // tek sayfada `limit` kadar döner, `nextCursor` her zaman `null` (§10.9.4 ile tutarlı).
      return reply.send(ok(dtos, { nextCursor: null }));
    }
  );

  server.get(
    "/portfolio/categories",
    {
      config: IP_LAYER,
      preHandler: requireModuleEnabled("portfolio"),
      schema: { response: { 200: ApiSuccessSchema(z.array(PublicCategorySchema)) } },
    },
    async (_request, reply) => {
      const rows = await app.prisma.portfolioCategory.findMany({ orderBy: { seq: "asc" } });
      return reply.send(ok(rows.map(toPublicCategoryDto)));
    }
  );

  server.get(
    "/portfolio/:slug",
    {
      config: IP_LAYER,
      preHandler: requireModuleEnabled("portfolio"),
      schema: { params: PublicSlugParamSchema, querystring: PublicListQuerySchema.pick({ locale: true }), response: { 200: ApiSuccessSchema(PublicPortfolioItemSchema) } },
    },
    async (request, reply) => {
      const localeSet = await getLocaleSet(app);
      const effectiveLocale = resolveEffectiveLocaleCode(localeSet, request.query.locale);

      const translatedEntityId = await resolveEntityIdBySlug(app, "PORTFOLIO_ITEM", request.params.slug, effectiveLocale);
      const item = translatedEntityId
        ? await app.prisma.portfolioItem.findFirst({ where: { id: translatedEntityId, status: "PUBLISHED", deletedAt: null }, include: PORTFOLIO_WITH_RELATIONS })
        : null;
      const resolved =
        item ??
        (await app.prisma.portfolioItem.findFirst({ where: { slug: request.params.slug, status: "PUBLISHED", deletedAt: null }, include: PORTFOLIO_WITH_RELATIONS }));
      if (!resolved) throw new NotFoundError("Portföy öğesi bulunamadı.");

      return reply.send(ok(toPublicPortfolioItemDto(applyPublicPortfolioLocale(resolved, effectiveLocale))));
    }
  );
}

// ---------------------------------------------------------------------------
// Yerelleştirme yardımcıları — `pages.routes.ts`/`blog.routes.ts`/`products.routes.ts`/
// `portfolio.routes.ts` ile BİREBİR AYNI semantik (§10.13.5 madde 4), yalnızca admin
// route dosyalarındaki private fonksiyonlar buraya (public katmana) KOPYALANMADAN tekrar
// yazılmıştır (döngüsel modül bağımlılığı kurmamak için — admin route dosyaları export etmez).
// ---------------------------------------------------------------------------

type PageRow = Parameters<typeof toPublicPageDto>[0];
function applyPublicPageLocale(page: PageRow, effectiveLocale: string | undefined, translatedInLocale: boolean): PageRow {
  if (!effectiveLocale) return page;
  if (page.isLegalDocument && !translatedInLocale) {
    const seoLocalized = applyFieldLocalization(page, effectiveLocale, ["seoTitle", "seoDescription", "ogTitle", "canonicalUrl"] as const);
    return { ...seoLocalized, blocks: [] };
  }
  return applyFieldLocalization(page, effectiveLocale, ["title", "seoTitle", "seoDescription", "ogTitle", "canonicalUrl"] as const, ["blocks"] as const);
}

type BlogPostRow = Parameters<typeof toPublicBlogPostDto>[0];
function applyPublicBlogPostLocale(post: BlogPostRow, effectiveLocale: string | undefined): BlogPostRow {
  if (!effectiveLocale) return post;
  return applyFieldLocalization(post, effectiveLocale, ["title", "seoTitle", "seoDescription", "ogTitle", "canonicalUrl", "excerpt", "contentHtml"] as const);
}

type ProductRow = Parameters<typeof toPublicProductDto>[0];
function applyPublicProductLocale(product: ProductRow, effectiveLocale: string | undefined): ProductRow {
  if (!effectiveLocale) return product;
  return applyFieldLocalization(
    product,
    effectiveLocale,
    ["title", "seoTitle", "seoDescription", "ogTitle", "canonicalUrl", "excerpt", "descriptionHtml"] as const
  );
}

type PortfolioItemRow = Parameters<typeof toPublicPortfolioItemDto>[0];
function applyPublicPortfolioLocale(item: PortfolioItemRow, effectiveLocale: string | undefined): PortfolioItemRow {
  if (!effectiveLocale) return item;
  return applyFieldLocalization(item, effectiveLocale, ["title", "seoTitle", "seoDescription", "ogTitle", "canonicalUrl", "summary", "contentHtml"] as const);
}
