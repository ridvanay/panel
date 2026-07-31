import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import type { Page } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { authenticate } from "../../middleware/authenticate";
import { requireSiteRole } from "../../middleware/site-rbac";
import { ok } from "../../lib/envelope";
import { ApiSuccessSchema, CursorQuerySchema } from "../../schemas/common";
import { ContentRevisionSchema, ContentRevisionSummarySchema, PageSchema } from "../../schemas/entities";
import { toContentRevisionDto, toContentRevisionSummaryDto, toPageDto } from "../../mappers";
import { NotFoundError } from "../../lib/errors";
import { parseCursor, encodeCursor, buildPageMeta } from "../../lib/pagination";
import { slugify } from "../../lib/slug";
import { startOfUtcDay } from "../../lib/date";
import { detectDeviceType } from "../../lib/device";
import { detectCountry } from "../../lib/geo";
import { touchVisitor } from "../../lib/live-visitors";
import { snapshotBeforeUpdate } from "../../lib/content-revisions";
import {
  CreatePageRequestSchema,
  LocaleQuerySchema,
  PageIdParamSchema,
  PageRevisionIdParamSchema,
  PageSlugParamSchema,
  UpdatePageRequestSchema,
} from "./pages.schemas";

/** Güncellemeden HEMEN ÖNCEKİ alan setini döner (bkz. ARCHITECTURE.md §10.1). */
function toPageSnapshot(page: Page): Record<string, unknown> {
  return {
    title: page.title,
    slug: page.slug,
    blocks: page.blocks,
    seoTitle: page.seoTitle,
    seoDescription: page.seoDescription,
    ogTitle: page.ogTitle,
    ogImageUrl: page.ogImageUrl,
    canonicalUrl: page.canonicalUrl,
    noIndex: page.noIndex,
    translations: page.translations,
  };
}

/**
 * §10.5 Çoklu Dil & Yerelleştirme — `locale=EN` verildiğinde `translations.EN`'deki
 * alan bazlı override'ları uygular (eksik alan TR/kanonik kolondan gelir).
 */
function applyLocale(page: Page, locale?: "EN"): Page {
  if (locale !== "EN") return page;
  const translations = (page.translations as Record<string, Record<string, unknown>> | null) ?? {};
  const en = translations.EN;
  if (!en) return page;

  return {
    ...page,
    title: typeof en.title === "string" ? en.title : page.title,
    seoTitle: typeof en.seoTitle === "string" ? en.seoTitle : page.seoTitle,
    seoDescription: typeof en.seoDescription === "string" ? en.seoDescription : page.seoDescription,
    ogTitle: typeof en.ogTitle === "string" ? en.ogTitle : page.ogTitle,
    canonicalUrl: typeof en.canonicalUrl === "string" ? en.canonicalUrl : page.canonicalUrl,
    blocks: Array.isArray(en.blocks) ? (en.blocks as Prisma.JsonValue) : page.blocks,
  };
}

/** `/admin/pages` prefix'i altında bağlanır (bkz. app.ts) — tüm durumlar (taslak dahil), authenticated. */
export async function adminPagesRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>();
  server.addHook("preHandler", authenticate);

  server.get(
    "/",
    {
      schema: { querystring: CursorQuerySchema, response: { 200: ApiSuccessSchema(z.array(PageSchema)) } },
    },
    async (request, reply) => {
      const { cursor, limit } = request.query;
      const cursorSeq = parseCursor(cursor);

      const rows = await app.prisma.page.findMany({
        where: cursorSeq ? { seq: { gt: cursorSeq } } : {},
        orderBy: { seq: "asc" },
        take: limit,
      });

      return reply.send(ok(rows.map(toPageDto), buildPageMeta(rows, limit)));
    }
  );

  server.post(
    "/",
    {
      preHandler: requireSiteRole("ADMIN", "EDITOR"),
      schema: { body: CreatePageRequestSchema, response: { 201: ApiSuccessSchema(PageSchema) } },
    },
    async (request, reply) => {
      const { title, slug, status, blocks, seoTitle, seoDescription, ogTitle, ogImageUrl, canonicalUrl, noIndex, translations } =
        request.body;

      const page = await app.prisma.page.create({
        data: {
          title,
          slug: slug ? slugify(slug) : slugify(title),
          status: status ?? "DRAFT",
          blocks: (blocks ?? []) as Prisma.InputJsonValue,
          seoTitle,
          seoDescription,
          ogTitle,
          ogImageUrl,
          canonicalUrl,
          noIndex,
          translations: (translations ?? {}) as Prisma.InputJsonValue,
          publishedAt: status === "PUBLISHED" ? new Date() : null,
        },
      });

      return reply.code(201).send(ok(toPageDto(page)));
    }
  );

  server.get(
    "/:pageId",
    { schema: { params: PageIdParamSchema, response: { 200: ApiSuccessSchema(PageSchema) } } },
    async (request, reply) => {
      const page = await app.prisma.page.findUnique({ where: { id: request.params.pageId } });
      if (!page) throw new NotFoundError("Sayfa bulunamadı.");
      return reply.send(ok(toPageDto(page)));
    }
  );

  server.patch(
    "/:pageId",
    {
      preHandler: requireSiteRole("ADMIN", "EDITOR"),
      schema: { params: PageIdParamSchema, body: UpdatePageRequestSchema, response: { 200: ApiSuccessSchema(PageSchema) } },
    },
    async (request, reply) => {
      const existing = await app.prisma.page.findUnique({ where: { id: request.params.pageId } });
      if (!existing) throw new NotFoundError("Sayfa bulunamadı.");

      await snapshotBeforeUpdate(app, "PAGE", existing.id, toPageSnapshot(existing), request.user!.id);

      const { slug, translations, ...rest } = request.body;

      const mergedTranslations =
        translations !== undefined
          ? {
              ...((existing.translations as Record<string, Record<string, unknown>>) ?? {}),
              ...Object.fromEntries(
                Object.entries(translations).map(([locale, fields]) => [
                  locale,
                  { ...(((existing.translations as Record<string, Record<string, unknown>>) ?? {})[locale] ?? {}), ...fields },
                ])
              ),
            }
          : undefined;

      const page = await app.prisma.page.update({
        where: { id: request.params.pageId },
        data: {
          ...rest,
          blocks: rest.blocks !== undefined ? (rest.blocks as Prisma.InputJsonValue) : undefined,
          ...(slug !== undefined ? { slug: slugify(slug) } : {}),
          ...(mergedTranslations !== undefined ? { translations: mergedTranslations as Prisma.InputJsonValue } : {}),
          ...(rest.status === "PUBLISHED" && !existing.publishedAt ? { publishedAt: new Date() } : {}),
        },
      });

      return reply.send(ok(toPageDto(page)));
    }
  );

  server.delete(
    "/:pageId",
    {
      preHandler: requireSiteRole("ADMIN"),
      schema: { params: PageIdParamSchema, response: { 204: z.undefined() } },
    },
    async (request, reply) => {
      await app.prisma.page.delete({ where: { id: request.params.pageId } }).catch(() => {
        throw new NotFoundError("Sayfa bulunamadı.");
      });
      return reply.code(204).send();
    }
  );

  // §10.1 İçerik Sürüm Kontrolü — yetki eşiği sayfa düzenleme ile aynı (ADMIN+EDITOR).
  server.get(
    "/:pageId/revisions",
    {
      preHandler: requireSiteRole("ADMIN", "EDITOR"),
      schema: {
        params: PageIdParamSchema,
        querystring: CursorQuerySchema,
        response: { 200: ApiSuccessSchema(z.array(ContentRevisionSummarySchema)) },
      },
    },
    async (request, reply) => {
      const { cursor, limit } = request.query;
      const cursorSeq = parseCursor(cursor);

      const rows = await app.prisma.contentRevision.findMany({
        where: {
          entityType: "PAGE",
          entityId: request.params.pageId,
          ...(cursorSeq ? { seq: { lt: cursorSeq } } : {}),
        },
        orderBy: { seq: "desc" },
        take: limit,
      });

      const nextCursor = rows.length === limit ? encodeCursor(rows[rows.length - 1]!.seq) : null;

      return reply.send(ok(rows.map(toContentRevisionSummaryDto), { nextCursor }));
    }
  );

  server.get(
    "/:pageId/revisions/:revisionId",
    {
      preHandler: requireSiteRole("ADMIN", "EDITOR"),
      schema: { params: PageRevisionIdParamSchema, response: { 200: ApiSuccessSchema(ContentRevisionSchema) } },
    },
    async (request, reply) => {
      const revision = await app.prisma.contentRevision.findUnique({ where: { id: request.params.revisionId } });
      if (!revision || revision.entityType !== "PAGE" || revision.entityId !== request.params.pageId) {
        throw new NotFoundError("Revizyon bulunamadı.");
      }
      return reply.send(ok(toContentRevisionDto(revision)));
    }
  );

  server.post(
    "/:pageId/revisions/:revisionId/restore",
    {
      preHandler: requireSiteRole("ADMIN", "EDITOR"),
      schema: { params: PageRevisionIdParamSchema, response: { 200: ApiSuccessSchema(PageSchema) } },
    },
    async (request, reply) => {
      const existing = await app.prisma.page.findUnique({ where: { id: request.params.pageId } });
      if (!existing) throw new NotFoundError("Sayfa bulunamadı.");

      const revision = await app.prisma.contentRevision.findUnique({ where: { id: request.params.revisionId } });
      if (!revision || revision.entityType !== "PAGE" || revision.entityId !== request.params.pageId) {
        throw new NotFoundError("Revizyon bulunamadı.");
      }

      // Geri dönüş de geri alınabilir olsun diye önce mevcut state'i yeni bir revizyon olarak kaydet.
      await snapshotBeforeUpdate(app, "PAGE", existing.id, toPageSnapshot(existing), request.user!.id);

      const snapshot = revision.snapshot as {
        title: string;
        slug: string;
        blocks: unknown;
        seoTitle: string | null;
        seoDescription: string | null;
        ogTitle: string | null;
        ogImageUrl: string | null;
        canonicalUrl: string | null;
        noIndex: boolean;
        translations: unknown;
      };

      const page = await app.prisma.page.update({
        where: { id: request.params.pageId },
        data: {
          title: snapshot.title,
          slug: snapshot.slug,
          blocks: snapshot.blocks as Prisma.InputJsonValue,
          seoTitle: snapshot.seoTitle,
          seoDescription: snapshot.seoDescription,
          ogTitle: snapshot.ogTitle,
          ogImageUrl: snapshot.ogImageUrl,
          canonicalUrl: snapshot.canonicalUrl,
          noIndex: snapshot.noIndex,
          translations: (snapshot.translations ?? {}) as Prisma.InputJsonValue,
        },
      });

      return reply.send(ok(toPageDto(page)));
    }
  );
}

/** `/pages` prefix'i altında bağlanır — herkese açık, yalnızca yayınlanmış sayfalar. */
export async function publicPagesRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>();

  // Site nav'ı için: yayınlanmış tüm sayfaların hafif listesi.
  server.get("/", { schema: { response: { 200: ApiSuccessSchema(z.array(PageSchema)) } } }, async (_request, reply) => {
    const rows = await app.prisma.page.findMany({
      where: { status: "PUBLISHED" },
      orderBy: { seq: "asc" },
      take: 100,
    });
    return reply.send(ok(rows.map(toPageDto)));
  });

  server.get(
    "/:slug",
    {
      schema: { params: PageSlugParamSchema, querystring: LocaleQuerySchema, response: { 200: ApiSuccessSchema(PageSchema) } },
    },
    async (request, reply) => {
      const page = await app.prisma.page.findFirst({
        where: { slug: request.params.slug, status: "PUBLISHED" },
      });
      if (!page) throw new NotFoundError("Sayfa bulunamadı.");
      return reply.send(ok(toPageDto(applyLocale(page, request.query.locale))));
    }
  );

  server.post(
    "/:slug/view",
    { schema: { params: PageSlugParamSchema, response: { 204: z.undefined() } } },
    async (request, reply) => {
      const page = await app.prisma.page.findFirst({
        where: { slug: request.params.slug, status: "PUBLISHED" },
        select: { id: true },
      });
      if (!page) throw new NotFoundError("Sayfa bulunamadı.");

      const deviceType = detectDeviceType(request.headers["user-agent"]);
      const country = detectCountry(request.ip);
      touchVisitor(request.ip, request.headers["user-agent"]);

      const date = startOfUtcDay();
      await app.prisma.$transaction([
        app.prisma.pageView.upsert({
          where: { pageId_date_deviceType_country: { pageId: page.id, date, deviceType, country } },
          create: { pageId: page.id, date, deviceType, country, count: 1 },
          update: { count: { increment: 1 } },
        }),
        app.prisma.page.update({ where: { id: page.id }, data: { viewCount: { increment: 1 } } }),
      ]);

      return reply.code(204).send();
    }
  );
}
