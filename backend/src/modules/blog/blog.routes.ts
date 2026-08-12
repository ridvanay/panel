import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import type { BlogPost } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { authenticate } from "../../middleware/authenticate";
import { requireSiteRole } from "../../middleware/site-rbac";
import { ok } from "../../lib/envelope";
import {
  ApiSuccessSchema,
  ApiSuccessWithMeta,
  AutosaveResponseSchema,
  ContentListQuerySchema,
  CursorQuerySchema,
} from "../../schemas/common";
import {
  BlogCategorySchema,
  BlogPostSchema,
  BulkContentActionRequestSchema,
  BulkContentActionResultSchema,
  ContentListMetaSchema,
  ContentRevisionSchema,
  ContentRevisionSummarySchema,
} from "../../schemas/entities";
import { toBlogCategoryDto, toBlogPostDto, toContentRevisionDto, toContentRevisionSummaryDto } from "../../mappers";
import { ConflictError, NotFoundError } from "../../lib/errors";
import { parseCursor, buildPageMeta, buildPageMetaWithCounts } from "../../lib/pagination";
import { slugify } from "../../lib/slug";
import { startOfUtcDay } from "../../lib/date";
import { detectDeviceType } from "../../lib/device";
import { detectCountry } from "../../lib/geo";
import { touchVisitor } from "../../lib/live-visitors";
import { snapshotBeforeUpdate, listContentRevisions, getContentRevisionOrThrow } from "../../lib/content-revisions";
import { runBulkContentAction, type BulkContentDelegate } from "../../lib/bulk-content-actions";
import { getBlogPostContentCounts } from "../../lib/content-counts";
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
import { sanitizeBlogTranslations } from "./lib/sanitize-content";
import {
  AutosaveBlogPostRequestSchema,
  CategoryIdParamSchema,
  CreateBlogCategoryRequestSchema,
  CreateBlogPostRequestSchema,
  LocaleQuerySchema,
  PostIdParamSchema,
  PostRevisionIdParamSchema,
  PostSlugParamSchema,
  UpdateBlogCategoryRequestSchema,
  UpdateBlogPostRequestSchema,
} from "./blog.schemas";

/** Yazı detay/liste sorgularında kategori + yazar özetini de dönmek için (bkz. ARCHITECTURE.md §10.7). */
const WITH_RELATIONS = { category: true, author: true } as const;

/** Güncellemeden HEMEN ÖNCEKİ alan setini döner (bkz. ARCHITECTURE.md §10.1). */
function toBlogPostSnapshot(post: BlogPost): Record<string, unknown> {
  return {
    title: post.title,
    slug: post.slug,
    excerpt: post.excerpt,
    contentHtml: post.contentHtml,
    coverImageUrl: post.coverImageUrl,
    categoryId: post.categoryId,
    seoTitle: post.seoTitle,
    seoDescription: post.seoDescription,
    ogTitle: post.ogTitle,
    ogImageUrl: post.ogImageUrl,
    canonicalUrl: post.canonicalUrl,
    noIndex: post.noIndex,
    translations: post.translations,
  };
}

const BLOG_POST_STRING_FIELDS = [
  "title",
  "seoTitle",
  "seoDescription",
  "ogTitle",
  "canonicalUrl",
  "excerpt",
  "contentHtml",
] as const;

/**
 * §10.5 Çoklu Dil & Yerelleştirme — `lib/localization.ts`'teki ortak yardımcıyı sarar (bkz.
 * .claude/architect-scope-i18n.md §9 backend-agent madde 2). `BlogPost`'ta §5.1 istisnası
 * YOKTUR (yalnızca `Page.isLegalDocument`) — düz alan bazlı sessiz fallback uygulanır.
 */
function applyBlogPostLocale<T extends BlogPost>(post: T, effectiveLocale: string | undefined): T {
  if (!effectiveLocale) return post;
  return applyFieldLocalization(post, effectiveLocale, BLOG_POST_STRING_FIELDS);
}

async function toBlogPostDtoLocalized(app: FastifyInstance, post: Parameters<typeof toBlogPostDto>[0]) {
  const localizations = await attachLocalizationsOne(app, "BLOG_POST", post);
  return toBlogPostDto(post, localizations);
}

async function toBlogPostDtosLocalized(app: FastifyInstance, posts: Parameters<typeof toBlogPostDto>[0][]) {
  const map = await attachLocalizations(app, "BLOG_POST", posts);
  return posts.map((post) => toBlogPostDto(post, map.get(post.id) ?? []));
}

/** `/admin/blog` prefix'i altında bağlanır (bkz. app.ts) — tüm durumlar (taslak dahil), authenticated. */
export async function adminBlogPostsRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>();
  server.addHook("preHandler", authenticate);

  server.get(
    "/",
    {
      schema: {
        querystring: ContentListQuerySchema,
        response: { 200: ApiSuccessWithMeta(z.array(BlogPostSchema), ContentListMetaSchema) },
      },
    },
    async (request, reply) => {
      const { cursor, limit, trashed, status } = request.query;
      const cursorSeq = parseCursor(cursor);

      const where: Prisma.BlogPostWhereInput = {
        ...(cursorSeq ? { seq: { gt: cursorSeq } } : {}),
        ...(status ? { status } : {}),
        ...(trashed === "exclude" ? { deletedAt: null } : trashed === "only" ? { deletedAt: { not: null } } : {}),
      };

      const [rows, counts] = await Promise.all([
        app.prisma.blogPost.findMany({ where, orderBy: { seq: "asc" }, take: limit, include: WITH_RELATIONS }),
        getBlogPostContentCounts(app.prisma),
      ]);

      return reply.send(ok(await toBlogPostDtosLocalized(app, rows), buildPageMetaWithCounts(rows, limit, counts)));
    }
  );

  server.post(
    "/",
    {
      preHandler: requireSiteRole("ADMIN", "EDITOR"),
      schema: { body: CreateBlogPostRequestSchema, response: { 201: ApiSuccessSchema(BlogPostSchema) } },
    },
    async (request, reply) => {
      const {
        title,
        slug,
        excerpt,
        contentHtml,
        coverImageUrl,
        status,
        categoryId,
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

      const { enabled: enabledLocales } = await getLocaleSet(app);
      const sanitizedTranslations = translations ? sanitizeBlogTranslations(translations) : {};

      const post = await app.prisma.$transaction(async (tx) => {
        const created = await tx.blogPost.create({
          data: {
            title,
            slug: slug ? slugify(slug) : slugify(title),
            excerpt,
            // Stored-XSS koruması: EDITOR de yazabildiği için (ADMIN'den daha az güvenilir bir rol)
            // içerik DB'ye yazılmadan önce sanitize edilir — public sitede `dangerouslySetInnerHTML`
            // ile doğrudan render edilir (bkz. lib/html-sanitize.ts).
            contentHtml: sanitizeRichHtml(contentHtml),
            coverImageUrl,
            status: status ?? "DRAFT",
            categoryId: categoryId ?? undefined,
            authorId,
            seoTitle,
            seoDescription,
            ogTitle,
            ogImageUrl,
            canonicalUrl,
            noIndex,
            translations: sanitizedTranslations as Prisma.InputJsonValue,
            publishedAt: status === "PUBLISHED" ? new Date() : null,
            // Faz 4 (zamanlanmış yayın) — `CreateBlogPostRequestSchema`'nın `refine`'ı zaten
            // `status === "SCHEDULED"` iken `scheduledAt`'in gelecekte dolu olmasını garanti eder.
            scheduledAt: status === "SCHEDULED" && scheduledAt ? new Date(scheduledAt) : null,
          },
          include: WITH_RELATIONS,
        });

        await syncContentSlugs(tx, enabledLocales, "BLOG_POST", created.id, created.slug, created.translations);

        return created;
      });

      return reply.code(201).send(ok(await toBlogPostDtoLocalized(app, post)));
    }
  );

  server.get(
    "/:postId",
    { schema: { params: PostIdParamSchema, response: { 200: ApiSuccessSchema(BlogPostSchema) } } },
    async (request, reply) => {
      // Çöpteki yazıyı da döner (geri yükleme/onay ekranları için) — deletedAt filtresi YOK.
      const post = await app.prisma.blogPost.findUnique({
        where: { id: request.params.postId },
        include: WITH_RELATIONS,
      });
      if (!post) throw new NotFoundError("Yazı bulunamadı.");
      return reply.send(ok(await toBlogPostDtoLocalized(app, post)));
    }
  );

  server.patch(
    "/:postId",
    {
      preHandler: requireSiteRole("ADMIN", "EDITOR"),
      schema: {
        params: PostIdParamSchema,
        body: UpdateBlogPostRequestSchema,
        response: { 200: ApiSuccessSchema(BlogPostSchema) },
      },
    },
    async (request, reply) => {
      const existing = await app.prisma.blogPost.findUnique({ where: { id: request.params.postId } });
      if (!existing) throw new NotFoundError("Yazı bulunamadı.");

      if (existing.deletedAt) {
        throw new ConflictError("Çöpteki içerik düzenlenemez. Önce geri yükleyin.");
      }

      await snapshotBeforeUpdate(app, "BLOG_POST", existing.id, toBlogPostSnapshot(existing), request.user!.id);

      const { slug, translations, authorId: requestedAuthorId, scheduledAt, ...rest } = request.body;
      const resolvedAuthorId = await resolveAuthorId(app, requestedAuthorId, request.user!);

      // Stored-XSS koruması: gelen çeviriler merge'den ÖNCE sanitize edilir (mevcut kayıttaki
      // çeviriler zaten sanitize edilmiş halde DB'de duruyor — bkz. lib/html-sanitize.ts).
      const sanitizedTranslations = translations !== undefined ? sanitizeBlogTranslations(translations) : undefined;
      const mergedTranslations =
        sanitizedTranslations !== undefined ? mergeTranslations(existing.translations, sanitizedTranslations) : undefined;

      const { enabled: enabledLocales } = await getLocaleSet(app);

      const post = await app.prisma.$transaction(async (tx) => {
        const updated = await tx.blogPost.update({
          where: { id: request.params.postId },
          data: {
            ...rest,
            ...(rest.contentHtml !== undefined ? { contentHtml: sanitizeRichHtml(rest.contentHtml) } : {}),
            ...(slug !== undefined ? { slug: slugify(slug) } : {}),
            ...(mergedTranslations !== undefined ? { translations: mergedTranslations as Prisma.InputJsonValue } : {}),
            ...(rest.status === "PUBLISHED" && !existing.publishedAt ? { publishedAt: new Date() } : {}),
            // Faz 4 (zamanlanmış yayın) — yalnızca bu istekte `status` GÖNDERİLMİŞSE dokunulur (aksi
            // halde ilgisiz bir alan güncellemesi mevcut bir zamanlamayı bozardı). `status ===
            // "SCHEDULED"` ise `UpdateBlogPostRequestSchema`'nın `refine`'ı `scheduledAt`'in
            // gelecekte dolu olmasını garanti eder; `PUBLISHED`/`DRAFT`'a manuel geçişte ise eski
            // zamanlama artığı kalmasın diye `null`'a temizlenir.
            ...(rest.status !== undefined
              ? { scheduledAt: rest.status === "SCHEDULED" && scheduledAt ? new Date(scheduledAt) : null }
              : {}),
            ...(resolvedAuthorId !== undefined ? { authorId: resolvedAuthorId } : {}),
          },
          include: WITH_RELATIONS,
        });

        if (slug !== undefined || mergedTranslations !== undefined) {
          await syncContentSlugs(tx, enabledLocales, "BLOG_POST", updated.id, updated.slug, updated.translations);
        }

        return updated;
      });

      return reply.send(ok(await toBlogPostDtoLocalized(app, post)));
    }
  );

  // Faz 3 (autosave) — 3sn debounce ile frontend'den çağrılır. Bilinçli olarak `PATCH`'ten
  // AYRIDIR: `snapshotBeforeUpdate` (revizyon) ve `logAudit` ÇAĞIRMAZ — aksi halde her
  // otomatik kayıt entity başına 50'lik revizyon tavanını (MAX_REVISIONS_PER_ENTITY) doldurup
  // kullanıcının bilinçli "Kaydet" ile ürettiği anlamlı geçmişi silerdi (bkz. lib/content-revisions.ts).
  server.post(
    "/:postId/autosave",
    {
      preHandler: requireSiteRole("ADMIN", "EDITOR"),
      schema: {
        params: PostIdParamSchema,
        body: AutosaveBlogPostRequestSchema,
        response: { 200: ApiSuccessSchema(AutosaveResponseSchema) },
      },
    },
    async (request, reply) => {
      const existing = await app.prisma.blogPost.findUnique({ where: { id: request.params.postId } });
      if (!existing) throw new NotFoundError("Yazı bulunamadı.");

      if (existing.deletedAt) {
        throw new ConflictError("Çöpteki içerik düzenlenemez. Önce geri yükleyin.");
      }

      const { title, excerpt, contentHtml } = request.body;

      await app.prisma.blogPost.update({
        where: { id: request.params.postId },
        data: {
          ...(title !== undefined ? { title } : {}),
          ...(excerpt !== undefined ? { excerpt } : {}),
          ...(contentHtml !== undefined ? { contentHtml: sanitizeRichHtml(contentHtml) } : {}),
        },
      });

      return reply.send(ok({ savedAt: new Date().toISOString() }));
    }
  );

  // §10.7 İçerik Yönetim Listesi — ÇÖPE TAŞI (soft-delete), KALICI SİLMEZ. İdempotenttir.
  server.delete(
    "/:postId",
    {
      preHandler: requireSiteRole("ADMIN", "EDITOR"),
      schema: { params: PostIdParamSchema, response: { 204: z.undefined() } },
    },
    async (request, reply) => {
      const existing = await app.prisma.blogPost.findUnique({ where: { id: request.params.postId } });
      if (!existing) throw new NotFoundError("Yazı bulunamadı.");

      if (!existing.deletedAt) {
        await app.prisma.blogPost.update({ where: { id: existing.id }, data: { deletedAt: new Date() } });

        await logAudit(app, {
          actorId: request.user!.id,
          actorEmail: request.user!.email,
          action: "blog_post.trash",
          targetType: "BlogPost",
          targetId: existing.id,
          ipAddress: request.ip,
        });
      }

      return reply.code(204).send();
    }
  );

  // §10.7 — çöpten geri yükle. `status` DEĞİŞMEZ. İdempotenttir (çöpte değilse de 200 + mevcut kayıt).
  server.post(
    "/:postId/restore",
    {
      preHandler: requireSiteRole("ADMIN", "EDITOR"),
      schema: { params: PostIdParamSchema, response: { 200: ApiSuccessSchema(BlogPostSchema) } },
    },
    async (request, reply) => {
      const existing = await app.prisma.blogPost.findUnique({ where: { id: request.params.postId } });
      if (!existing) throw new NotFoundError("Yazı bulunamadı.");

      if (existing.deletedAt) {
        await app.prisma.blogPost.update({ where: { id: existing.id }, data: { deletedAt: null } });

        await logAudit(app, {
          actorId: request.user!.id,
          actorEmail: request.user!.email,
          action: "blog_post.restore",
          targetType: "BlogPost",
          targetId: existing.id,
          ipAddress: request.ip,
        });
      }

      const post = await app.prisma.blogPost.findUnique({ where: { id: existing.id }, include: WITH_RELATIONS });
      return reply.send(ok(await toBlogPostDtoLocalized(app, post!)));
    }
  );

  // §10.7 — KALICI sil (yalnızca ADMIN). Kayıt ÖNCE çöpte olmalı, değilse 409.
  server.delete(
    "/:postId/permanent",
    {
      preHandler: requireSiteRole("ADMIN"),
      schema: { params: PostIdParamSchema, response: { 204: z.undefined() } },
    },
    async (request, reply) => {
      const existing = await app.prisma.blogPost.findUnique({ where: { id: request.params.postId } });
      if (!existing) throw new NotFoundError("Yazı bulunamadı.");
      if (!existing.deletedAt) throw new ConflictError("Kalıcı silmeden önce içeriği çöpe taşıyın.");

      await app.prisma.$transaction(async (tx) => {
        await tx.contentRevision.deleteMany({ where: { entityType: "BLOG_POST", entityId: existing.id } });
        await deleteContentSlugsForEntity(tx, "BLOG_POST", existing.id);
        await tx.blogPost.delete({ where: { id: existing.id } });
      });

      await logAudit(app, {
        actorId: request.user!.id,
        actorEmail: request.user!.email,
        action: "blog_post.permanent_delete",
        targetType: "BlogPost",
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
      const result = await runBulkContentAction(
        app,
        {
          getDelegate: (client) => client.blogPost as unknown as BulkContentDelegate,
          entityType: "BLOG_POST",
          targetType: "BlogPost",
          auditActionPrefix: "blog_post.",
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

  // §10.1 İçerik Sürüm Kontrolü — yetki eşiği yazı düzenleme ile aynı (ADMIN+EDITOR).
  server.get(
    "/:postId/revisions",
    {
      preHandler: requireSiteRole("ADMIN", "EDITOR"),
      schema: {
        params: PostIdParamSchema,
        querystring: CursorQuerySchema,
        response: { 200: ApiSuccessSchema(z.array(ContentRevisionSummarySchema)) },
      },
    },
    async (request, reply) => {
      const { rows, nextCursor } = await listContentRevisions(app, "BLOG_POST", request.params.postId, request.query);
      return reply.send(ok(rows.map(toContentRevisionSummaryDto), { nextCursor }));
    }
  );

  server.get(
    "/:postId/revisions/:revisionId",
    {
      preHandler: requireSiteRole("ADMIN", "EDITOR"),
      schema: { params: PostRevisionIdParamSchema, response: { 200: ApiSuccessSchema(ContentRevisionSchema) } },
    },
    async (request, reply) => {
      const revision = await getContentRevisionOrThrow(app, "BLOG_POST", request.params.postId, request.params.revisionId);
      return reply.send(ok(toContentRevisionDto(revision)));
    }
  );

  server.post(
    "/:postId/revisions/:revisionId/restore",
    {
      preHandler: requireSiteRole("ADMIN", "EDITOR"),
      schema: { params: PostRevisionIdParamSchema, response: { 200: ApiSuccessSchema(BlogPostSchema) } },
    },
    async (request, reply) => {
      const existing = await app.prisma.blogPost.findUnique({ where: { id: request.params.postId } });
      if (!existing) throw new NotFoundError("Yazı bulunamadı.");

      if (existing.deletedAt) {
        throw new ConflictError("Çöpteki içerik düzenlenemez. Önce geri yükleyin.");
      }

      const revision = await getContentRevisionOrThrow(app, "BLOG_POST", request.params.postId, request.params.revisionId);

      // Geri dönüş de geri alınabilir olsun diye önce mevcut state'i yeni bir revizyon olarak kaydet.
      await snapshotBeforeUpdate(app, "BLOG_POST", existing.id, toBlogPostSnapshot(existing), request.user!.id);

      const snapshot = revision.snapshot as {
        title: string;
        slug: string;
        excerpt: string | null;
        contentHtml: string;
        coverImageUrl: string | null;
        categoryId: string | null;
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
        ? sanitizeBlogTranslations(snapshot.translations as Record<string, Record<string, unknown> | null>)
        : {};

      const post = await app.prisma.$transaction(async (tx) => {
        const updated = await tx.blogPost.update({
          where: { id: request.params.postId },
          data: {
            title: snapshot.title,
            slug: snapshot.slug,
            excerpt: snapshot.excerpt,
            // Savunmada derinlik: bu sanitizasyon eklenmeden ÖNCE kaydedilmiş eski revizyonlar
            // temizlenmemiş HTML içerebilir — geri yükleme her zaman yeniden sanitize eder.
            contentHtml: sanitizeRichHtml(snapshot.contentHtml),
            coverImageUrl: snapshot.coverImageUrl,
            categoryId: snapshot.categoryId,
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

        await syncContentSlugs(tx, enabledLocales, "BLOG_POST", updated.id, updated.slug, updated.translations);

        return updated;
      });

      return reply.send(ok(await toBlogPostDtoLocalized(app, post)));
    }
  );
}

/** `/admin/blog/categories` prefix'i altında bağlanır — authenticated. */
export async function adminBlogCategoriesRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>();
  server.addHook("preHandler", authenticate);

  server.get(
    "/",
    { schema: { response: { 200: ApiSuccessSchema(z.array(BlogCategorySchema)) } } },
    async (_request, reply) => {
      const rows = await app.prisma.blogCategory.findMany({ orderBy: { seq: "asc" } });
      return reply.send(ok(rows.map(toBlogCategoryDto)));
    }
  );

  server.post(
    "/",
    {
      preHandler: requireSiteRole("ADMIN", "EDITOR"),
      schema: { body: CreateBlogCategoryRequestSchema, response: { 201: ApiSuccessSchema(BlogCategorySchema) } },
    },
    async (request, reply) => {
      const category = await app.prisma.blogCategory.create({
        data: {
          name: request.body.name,
          slug: request.body.slug ? slugify(request.body.slug) : slugify(request.body.name),
        },
      });
      return reply.code(201).send(ok(toBlogCategoryDto(category)));
    }
  );

  server.patch(
    "/:categoryId",
    {
      preHandler: requireSiteRole("ADMIN", "EDITOR"),
      schema: {
        params: CategoryIdParamSchema,
        body: UpdateBlogCategoryRequestSchema,
        response: { 200: ApiSuccessSchema(BlogCategorySchema) },
      },
    },
    async (request, reply) => {
      const { slug, ...rest } = request.body;
      const category = await app.prisma.blogCategory
        .update({
          where: { id: request.params.categoryId },
          data: { ...rest, ...(slug !== undefined ? { slug: slugify(slug) } : {}) },
        })
        .catch(() => {
          throw new NotFoundError("Kategori bulunamadı.");
        });
      return reply.send(ok(toBlogCategoryDto(category)));
    }
  );

  server.delete(
    "/:categoryId",
    {
      preHandler: requireSiteRole("ADMIN"),
      schema: { params: CategoryIdParamSchema, response: { 204: z.undefined() } },
    },
    async (request, reply) => {
      await app.prisma.blogCategory.delete({ where: { id: request.params.categoryId } }).catch(() => {
        throw new NotFoundError("Kategori bulunamadı.");
      });
      return reply.code(204).send();
    }
  );
}

/** `/blog` prefix'i altında bağlanır — herkese açık, yalnızca yayınlanmış VE çöpte olmayan yazılar. */
export async function publicBlogRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>();

  server.get(
    "/",
    {
      schema: {
        querystring: CursorQuerySchema.merge(LocaleQuerySchema),
        response: { 200: ApiSuccessSchema(z.array(BlogPostSchema)) },
      },
    },
    async (request, reply) => {
      const { cursor, limit } = request.query;
      const cursorSeq = parseCursor(cursor);

      const rows = await app.prisma.blogPost.findMany({
        where: { status: "PUBLISHED", deletedAt: null, ...(cursorSeq ? { seq: { gt: cursorSeq } } : {}) },
        orderBy: { seq: "asc" },
        take: limit,
        include: WITH_RELATIONS,
      });

      const localeSet = await getLocaleSet(app);
      const effectiveLocale = resolveEffectiveLocaleCode(localeSet, request.query.locale);
      const localizationsByEntity = await attachLocalizations(app, "BLOG_POST", rows);

      const dtos = rows.map((row) =>
        toBlogPostDto(applyBlogPostLocale(row, effectiveLocale), localizationsByEntity.get(row.id) ?? [])
      );

      return reply.send(ok(dtos, buildPageMeta(rows, limit)));
    }
  );

  server.get(
    "/:slug",
    {
      schema: { params: PostSlugParamSchema, querystring: LocaleQuerySchema, response: { 200: ApiSuccessSchema(BlogPostSchema) } },
    },
    async (request, reply) => {
      const localeSet = await getLocaleSet(app);
      const effectiveLocale = resolveEffectiveLocaleCode(localeSet, request.query.locale);

      // §4/§12.2 — slug çözümlemesi `/pages/{slug}` ile BİREBİR AYNIDIR.
      const translatedEntityId = await resolveEntityIdBySlug(app, "BLOG_POST", request.params.slug, effectiveLocale);
      const post = translatedEntityId
        ? await app.prisma.blogPost.findFirst({
            where: { id: translatedEntityId, status: "PUBLISHED", deletedAt: null },
            include: WITH_RELATIONS,
          })
        : null;
      const resolvedPost =
        post ??
        (await app.prisma.blogPost.findFirst({
          where: { slug: request.params.slug, status: "PUBLISHED", deletedAt: null },
          include: WITH_RELATIONS,
        }));
      if (!resolvedPost) throw new NotFoundError("Yazı bulunamadı.");

      const localizations = await attachLocalizationsOne(app, "BLOG_POST", resolvedPost);
      return reply.send(ok(toBlogPostDto(applyBlogPostLocale(resolvedPost, effectiveLocale), localizations)));
    }
  );

  server.post(
    "/:slug/view",
    { schema: { params: PostSlugParamSchema, response: { 204: z.undefined() } } },
    async (request, reply) => {
      const post = await app.prisma.blogPost.findFirst({
        where: { slug: request.params.slug, status: "PUBLISHED", deletedAt: null },
        select: { id: true },
      });
      if (!post) throw new NotFoundError("Yazı bulunamadı.");

      const deviceType = detectDeviceType(request.headers["user-agent"]);
      const country = detectCountry(request.ip);
      touchVisitor(request.ip, request.headers["user-agent"]);

      const date = startOfUtcDay();
      await app.prisma.$transaction([
        app.prisma.pageView.upsert({
          where: { postId_date_deviceType_country: { postId: post.id, date, deviceType, country } },
          create: { postId: post.id, date, deviceType, country, count: 1 },
          update: { count: { increment: 1 } },
        }),
        app.prisma.blogPost.update({ where: { id: post.id }, data: { viewCount: { increment: 1 } } }),
      ]);

      return reply.code(204).send();
    }
  );
}
