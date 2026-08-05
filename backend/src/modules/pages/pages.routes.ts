import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import type { Page } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { authenticate } from "../../middleware/authenticate";
import { requireSiteRole } from "../../middleware/site-rbac";
import { ok } from "../../lib/envelope";
import { ApiSuccessSchema, ApiSuccessWithMeta, ContentListQuerySchema, CursorQuerySchema } from "../../schemas/common";
import {
  BulkContentActionRequestSchema,
  BulkContentActionResultSchema,
  ContentListMetaSchema,
  ContentRevisionSchema,
  ContentRevisionSummarySchema,
  PageSchema,
} from "../../schemas/entities";
import { toContentRevisionDto, toContentRevisionSummaryDto, toPageDto } from "../../mappers";
import { ConflictError, ForbiddenError, NotFoundError } from "../../lib/errors";
import { parseCursor, encodeCursor, buildPageMetaWithCounts } from "../../lib/pagination";
import { slugify } from "../../lib/slug";
import { startOfUtcDay } from "../../lib/date";
import { detectDeviceType } from "../../lib/device";
import { detectCountry } from "../../lib/geo";
import { touchVisitor } from "../../lib/live-visitors";
import { snapshotBeforeUpdate } from "../../lib/content-revisions";
import { getPageContentCounts } from "../../lib/content-counts";
import { resolveAuthorId } from "../../lib/content-author";
import { logAudit } from "../../lib/audit";
import { sanitizePageBlocks, sanitizePageTranslations } from "./lib/sanitize-blocks";
import { SETTINGS_ID } from "../settings/settings.routes";
import {
  CreatePageRequestSchema,
  LocaleQuerySchema,
  PageIdParamSchema,
  PageRevisionIdParamSchema,
  PageSlugParamSchema,
  UpdatePageRequestSchema,
} from "./pages.schemas";

/** Sayfa detay/liste sorgularında yazar özetini de dönmek için (bkz. ARCHITECTURE.md §10.7). */
const WITH_AUTHOR = { author: true } as const;

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
function applyLocale<T extends Page>(page: T, locale?: "EN"): T {
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
      schema: {
        querystring: ContentListQuerySchema,
        response: { 200: ApiSuccessWithMeta(z.array(PageSchema), ContentListMetaSchema) },
      },
    },
    async (request, reply) => {
      const { cursor, limit, trashed, status } = request.query;
      const cursorSeq = parseCursor(cursor);

      const where: Prisma.PageWhereInput = {
        ...(cursorSeq ? { seq: { gt: cursorSeq } } : {}),
        ...(status ? { status } : {}),
        ...(trashed === "exclude" ? { deletedAt: null } : trashed === "only" ? { deletedAt: { not: null } } : {}),
      };

      const [rows, counts] = await Promise.all([
        app.prisma.page.findMany({ where, orderBy: { seq: "asc" }, take: limit, include: WITH_AUTHOR }),
        getPageContentCounts(app.prisma),
      ]);

      return reply.send(ok(rows.map(toPageDto), buildPageMetaWithCounts(rows, limit, counts)));
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

      const resolvedAuthorId = await resolveAuthorId(app, request.body.authorId, request.user!);
      const authorId = resolvedAuthorId === undefined ? request.user!.id : resolvedAuthorId;

      const page = await app.prisma.page.create({
        data: {
          title,
          slug: slug ? slugify(slug) : slugify(title),
          status: status ?? "DRAFT",
          // Stored-XSS koruması: EDITOR de yazabildiği için (ADMIN'den daha az güvenilir bir rol)
          // "text" block'larının `data.html`'i DB'ye yazılmadan önce sanitize edilir — public
          // sitede `dangerouslySetInnerHTML` ile doğrudan render edilir (bkz. lib/html-sanitize.ts).
          blocks: sanitizePageBlocks(blocks ?? []) as Prisma.InputJsonValue,
          seoTitle,
          seoDescription,
          ogTitle,
          ogImageUrl,
          canonicalUrl,
          noIndex,
          translations: (translations ? sanitizePageTranslations(translations) : {}) as Prisma.InputJsonValue,
          publishedAt: status === "PUBLISHED" ? new Date() : null,
          authorId,
        },
        include: WITH_AUTHOR,
      });

      return reply.code(201).send(ok(toPageDto(page)));
    }
  );

  server.get(
    "/:pageId",
    { schema: { params: PageIdParamSchema, response: { 200: ApiSuccessSchema(PageSchema) } } },
    async (request, reply) => {
      // Çöpteki sayfayı da döner (geri yükleme/onay ekranları için) — deletedAt filtresi YOK.
      const page = await app.prisma.page.findUnique({ where: { id: request.params.pageId }, include: WITH_AUTHOR });
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

      if (existing.deletedAt) {
        throw new ConflictError("Çöpteki içerik düzenlenemez. Önce geri yükleyin.");
      }

      await snapshotBeforeUpdate(app, "PAGE", existing.id, toPageSnapshot(existing), request.user!.id);

      const { slug, translations, authorId: requestedAuthorId, ...rest } = request.body;
      const resolvedAuthorId = await resolveAuthorId(app, requestedAuthorId, request.user!);

      // Stored-XSS koruması: gelen çeviriler merge'den ÖNCE sanitize edilir (mevcut kayıttaki
      // çeviriler zaten sanitize edilmiş halde DB'de duruyor — bkz. lib/html-sanitize.ts).
      const sanitizedTranslations = translations !== undefined ? sanitizePageTranslations(translations) : undefined;

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

      const page = await app.prisma.page.update({
        where: { id: request.params.pageId },
        data: {
          ...rest,
          blocks: rest.blocks !== undefined ? (sanitizePageBlocks(rest.blocks) as Prisma.InputJsonValue) : undefined,
          ...(slug !== undefined ? { slug: slugify(slug) } : {}),
          ...(mergedTranslations !== undefined ? { translations: mergedTranslations as Prisma.InputJsonValue } : {}),
          ...(rest.status === "PUBLISHED" && !existing.publishedAt ? { publishedAt: new Date() } : {}),
          ...(resolvedAuthorId !== undefined ? { authorId: resolvedAuthorId } : {}),
        },
        include: WITH_AUTHOR,
      });

      return reply.send(ok(toPageDto(page)));
    }
  );

  // §10.7 İçerik Yönetim Listesi — ÇÖPE TAŞI (soft-delete), KALICI SİLMEZ. İdempotenttir.
  server.delete(
    "/:pageId",
    {
      preHandler: requireSiteRole("ADMIN", "EDITOR"),
      schema: { params: PageIdParamSchema, response: { 204: z.undefined() } },
    },
    async (request, reply) => {
      const existing = await app.prisma.page.findUnique({ where: { id: request.params.pageId } });
      if (!existing) throw new NotFoundError("Sayfa bulunamadı.");

      if (!existing.deletedAt) {
        await app.prisma.$transaction(async (tx) => {
          await tx.page.update({ where: { id: existing.id }, data: { deletedAt: new Date() } });
          await tx.siteSettings.updateMany({ where: { id: SETTINGS_ID, homePageId: existing.id }, data: { homePageId: null } });
        });

        await logAudit(app, {
          actorId: request.user!.id,
          actorEmail: request.user!.email,
          action: "page.trash",
          targetType: "Page",
          targetId: existing.id,
          ipAddress: request.ip,
        });
      }

      return reply.code(204).send();
    }
  );

  // §10.7 — çöpten geri yükle. `status` DEĞİŞMEZ. İdempotenttir (çöpte değilse de 200 + mevcut kayıt).
  server.post(
    "/:pageId/restore",
    {
      preHandler: requireSiteRole("ADMIN", "EDITOR"),
      schema: { params: PageIdParamSchema, response: { 200: ApiSuccessSchema(PageSchema) } },
    },
    async (request, reply) => {
      const existing = await app.prisma.page.findUnique({ where: { id: request.params.pageId } });
      if (!existing) throw new NotFoundError("Sayfa bulunamadı.");

      if (existing.deletedAt) {
        await app.prisma.page.update({ where: { id: existing.id }, data: { deletedAt: null } });

        await logAudit(app, {
          actorId: request.user!.id,
          actorEmail: request.user!.email,
          action: "page.restore",
          targetType: "Page",
          targetId: existing.id,
          ipAddress: request.ip,
        });
      }

      const page = await app.prisma.page.findUnique({ where: { id: existing.id }, include: WITH_AUTHOR });
      return reply.send(ok(toPageDto(page!)));
    }
  );

  // §10.7 — KALICI sil (yalnızca ADMIN). Kayıt ÖNCE çöpte olmalı, değilse 409.
  server.delete(
    "/:pageId/permanent",
    {
      preHandler: requireSiteRole("ADMIN"),
      schema: { params: PageIdParamSchema, response: { 204: z.undefined() } },
    },
    async (request, reply) => {
      const existing = await app.prisma.page.findUnique({ where: { id: request.params.pageId } });
      if (!existing) throw new NotFoundError("Sayfa bulunamadı.");
      if (!existing.deletedAt) throw new ConflictError("Kalıcı silmeden önce içeriği çöpe taşıyın.");

      await app.prisma.$transaction([
        app.prisma.contentRevision.deleteMany({ where: { entityType: "PAGE", entityId: existing.id } }),
        app.prisma.page.delete({ where: { id: existing.id } }),
      ]);

      await logAudit(app, {
        actorId: request.user!.id,
        actorEmail: request.user!.email,
        action: "page.permanent_delete",
        targetType: "Page",
        targetId: existing.id,
        ipAddress: request.ip,
      });

      return reply.code(204).send();
    }
  );

  // §10.7 — toplu işlem. Kısmi başarı hata DEĞİLDİR (200 + skippedIds).
  server.post(
    "/bulk",
    {
      preHandler: requireSiteRole("ADMIN", "EDITOR"),
      schema: { body: BulkContentActionRequestSchema, response: { 200: ApiSuccessSchema(BulkContentActionResultSchema) } },
    },
    async (request, reply) => {
      const { ids: rawIds, action } = request.body;
      const ids = Array.from(new Set(rawIds));

      if (action === "permanent-delete" && request.user!.role !== "ADMIN") {
        throw new ForbiddenError("Kalıcı silme yalnızca ADMIN'e açıktır.");
      }

      const rows = await app.prisma.page.findMany({ where: { id: { in: ids } }, select: { id: true, deletedAt: true } });
      const rowById = new Map(rows.map((row) => [row.id, row]));

      const applicableIds: string[] = [];
      const skippedIds: string[] = [];

      for (const id of ids) {
        const row = rowById.get(id);
        if (!row) {
          skippedIds.push(id);
          continue;
        }

        const isTrashed = row.deletedAt !== null;
        const applicable =
          (action === "trash" && !isTrashed) ||
          (action === "restore" && isTrashed) ||
          ((action === "publish" || action === "draft") && !isTrashed) ||
          (action === "permanent-delete" && isTrashed);

        if (applicable) {
          applicableIds.push(id);
        } else {
          skippedIds.push(id);
        }
      }

      if (applicableIds.length > 0) {
        switch (action) {
          case "trash": {
            await app.prisma.$transaction(async (tx) => {
              await tx.page.updateMany({ where: { id: { in: applicableIds } }, data: { deletedAt: new Date() } });
              await tx.siteSettings.updateMany({
                where: { id: SETTINGS_ID, homePageId: { in: applicableIds } },
                data: { homePageId: null },
              });
            });
            break;
          }
          case "restore": {
            await app.prisma.page.updateMany({ where: { id: { in: applicableIds } }, data: { deletedAt: null } });
            break;
          }
          case "publish": {
            await app.prisma.$transaction([
              app.prisma.page.updateMany({
                where: { id: { in: applicableIds }, publishedAt: null },
                data: { status: "PUBLISHED", publishedAt: new Date() },
              }),
              app.prisma.page.updateMany({
                where: { id: { in: applicableIds }, publishedAt: { not: null } },
                data: { status: "PUBLISHED" },
              }),
            ]);
            break;
          }
          case "draft": {
            // Taslağa alma `publishedAt`'i TEMİZLEMEZ (ilk yayın tarihi kalıcıdır).
            await app.prisma.page.updateMany({ where: { id: { in: applicableIds } }, data: { status: "DRAFT" } });
            break;
          }
          case "permanent-delete": {
            await app.prisma.$transaction([
              app.prisma.contentRevision.deleteMany({ where: { entityType: "PAGE", entityId: { in: applicableIds } } }),
              app.prisma.page.deleteMany({ where: { id: { in: applicableIds } } }),
            ]);
            break;
          }
        }

        await logAudit(app, {
          actorId: request.user!.id,
          actorEmail: request.user!.email,
          action: `page.bulk_${action}`,
          targetType: "Page",
          metadata: { ids: applicableIds, skippedIds },
          ipAddress: request.ip,
        });
      }

      return reply.send(
        ok({
          action,
          requestedCount: ids.length,
          affectedCount: applicableIds.length,
          skippedIds,
        })
      );
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
          // Savunmada derinlik: bu sanitizasyon eklenmeden ÖNCE kaydedilmiş eski revizyonlar
          // temizlenmemiş HTML içerebilir — geri yükleme her zaman yeniden sanitize eder.
          blocks: (Array.isArray(snapshot.blocks)
            ? sanitizePageBlocks(snapshot.blocks)
            : snapshot.blocks) as Prisma.InputJsonValue,
          seoTitle: snapshot.seoTitle,
          seoDescription: snapshot.seoDescription,
          ogTitle: snapshot.ogTitle,
          ogImageUrl: snapshot.ogImageUrl,
          canonicalUrl: snapshot.canonicalUrl,
          noIndex: snapshot.noIndex,
          translations: (snapshot.translations
            ? sanitizePageTranslations(snapshot.translations as Record<string, Record<string, unknown>>)
            : {}) as Prisma.InputJsonValue,
        },
        include: WITH_AUTHOR,
      });

      return reply.send(ok(toPageDto(page)));
    }
  );
}

/** `/pages` prefix'i altında bağlanır — herkese açık, yalnızca yayınlanmış VE çöpte olmayan sayfalar. */
export async function publicPagesRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>();

  // Site nav'ı için: yayınlanmış tüm sayfaların hafif listesi.
  server.get("/", { schema: { response: { 200: ApiSuccessSchema(z.array(PageSchema)) } } }, async (_request, reply) => {
    const rows = await app.prisma.page.findMany({
      where: { status: "PUBLISHED", deletedAt: null },
      orderBy: { seq: "asc" },
      take: 100,
      include: WITH_AUTHOR,
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
        where: { slug: request.params.slug, status: "PUBLISHED", deletedAt: null },
        include: WITH_AUTHOR,
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
        where: { slug: request.params.slug, status: "PUBLISHED", deletedAt: null },
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
