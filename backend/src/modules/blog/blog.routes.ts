import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { authenticate } from "../../middleware/authenticate";
import { requireSiteRole } from "../../middleware/site-rbac";
import { ok } from "../../lib/envelope";
import { ApiSuccessSchema, CursorQuerySchema } from "../../schemas/common";
import { BlogCategorySchema, BlogPostSchema } from "../../schemas/entities";
import { toBlogCategoryDto, toBlogPostDto } from "../../mappers";
import { NotFoundError } from "../../lib/errors";
import { parseCursor, buildPageMeta } from "../../lib/pagination";
import { slugify } from "../../lib/slug";
import { startOfUtcDay } from "../../lib/date";
import {
  CategoryIdParamSchema,
  CreateBlogCategoryRequestSchema,
  CreateBlogPostRequestSchema,
  PostIdParamSchema,
  PostSlugParamSchema,
  UpdateBlogCategoryRequestSchema,
  UpdateBlogPostRequestSchema,
} from "./blog.schemas";

const WITH_CATEGORY = { category: true } as const;

/** `/admin/blog` prefix'i altında bağlanır (bkz. app.ts) — tüm durumlar (taslak dahil), authenticated. */
export async function adminBlogPostsRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>();
  server.addHook("preHandler", authenticate);

  server.get(
    "/",
    { schema: { querystring: CursorQuerySchema, response: { 200: ApiSuccessSchema(z.array(BlogPostSchema)) } } },
    async (request, reply) => {
      const { cursor, limit } = request.query;
      const cursorSeq = parseCursor(cursor);

      const rows = await app.prisma.blogPost.findMany({
        where: cursorSeq ? { seq: { gt: cursorSeq } } : {},
        orderBy: { seq: "asc" },
        take: limit,
        include: WITH_CATEGORY,
      });

      return reply.send(ok(rows.map(toBlogPostDto), buildPageMeta(rows, limit)));
    }
  );

  server.post(
    "/",
    {
      preHandler: requireSiteRole("ADMIN", "EDITOR"),
      schema: { body: CreateBlogPostRequestSchema, response: { 201: ApiSuccessSchema(BlogPostSchema) } },
    },
    async (request, reply) => {
      const { title, slug, excerpt, contentHtml, coverImageUrl, status, categoryId } = request.body;

      const post = await app.prisma.blogPost.create({
        data: {
          title,
          slug: slug ? slugify(slug) : slugify(title),
          excerpt,
          contentHtml: contentHtml ?? "",
          coverImageUrl,
          status: status ?? "DRAFT",
          categoryId: categoryId ?? undefined,
          authorId: request.user!.id,
          publishedAt: status === "PUBLISHED" ? new Date() : null,
        },
        include: WITH_CATEGORY,
      });

      return reply.code(201).send(ok(toBlogPostDto(post)));
    }
  );

  server.get(
    "/:postId",
    { schema: { params: PostIdParamSchema, response: { 200: ApiSuccessSchema(BlogPostSchema) } } },
    async (request, reply) => {
      const post = await app.prisma.blogPost.findUnique({
        where: { id: request.params.postId },
        include: WITH_CATEGORY,
      });
      if (!post) throw new NotFoundError("Yazı bulunamadı.");
      return reply.send(ok(toBlogPostDto(post)));
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

      const { slug, ...rest } = request.body;

      const post = await app.prisma.blogPost.update({
        where: { id: request.params.postId },
        data: {
          ...rest,
          ...(slug !== undefined ? { slug: slugify(slug) } : {}),
          ...(rest.status === "PUBLISHED" && !existing.publishedAt ? { publishedAt: new Date() } : {}),
        },
        include: WITH_CATEGORY,
      });

      return reply.send(ok(toBlogPostDto(post)));
    }
  );

  server.delete(
    "/:postId",
    {
      preHandler: requireSiteRole("ADMIN"),
      schema: { params: PostIdParamSchema, response: { 204: z.undefined() } },
    },
    async (request, reply) => {
      await app.prisma.blogPost.delete({ where: { id: request.params.postId } }).catch(() => {
        throw new NotFoundError("Yazı bulunamadı.");
      });
      return reply.code(204).send();
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

/** `/blog` prefix'i altında bağlanır — herkese açık, yalnızca yayınlanmış yazılar. */
export async function publicBlogRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>();

  server.get(
    "/",
    { schema: { querystring: CursorQuerySchema, response: { 200: ApiSuccessSchema(z.array(BlogPostSchema)) } } },
    async (request, reply) => {
      const { cursor, limit } = request.query;
      const cursorSeq = parseCursor(cursor);

      const rows = await app.prisma.blogPost.findMany({
        where: { status: "PUBLISHED", ...(cursorSeq ? { seq: { gt: cursorSeq } } : {}) },
        orderBy: { seq: "asc" },
        take: limit,
        include: WITH_CATEGORY,
      });

      return reply.send(ok(rows.map(toBlogPostDto), buildPageMeta(rows, limit)));
    }
  );

  server.get(
    "/:slug",
    { schema: { params: PostSlugParamSchema, response: { 200: ApiSuccessSchema(BlogPostSchema) } } },
    async (request, reply) => {
      const post = await app.prisma.blogPost.findFirst({
        where: { slug: request.params.slug, status: "PUBLISHED" },
        include: WITH_CATEGORY,
      });
      if (!post) throw new NotFoundError("Yazı bulunamadı.");
      return reply.send(ok(toBlogPostDto(post)));
    }
  );

  server.post(
    "/:slug/view",
    { schema: { params: PostSlugParamSchema, response: { 204: z.undefined() } } },
    async (request, reply) => {
      const post = await app.prisma.blogPost.findFirst({
        where: { slug: request.params.slug, status: "PUBLISHED" },
        select: { id: true },
      });
      if (!post) throw new NotFoundError("Yazı bulunamadı.");

      const date = startOfUtcDay();
      await app.prisma.$transaction([
        app.prisma.pageView.upsert({
          where: { postId_date: { postId: post.id, date } },
          create: { postId: post.id, date, count: 1 },
          update: { count: { increment: 1 } },
        }),
        app.prisma.blogPost.update({ where: { id: post.id }, data: { viewCount: { increment: 1 } } }),
      ]);

      return reply.code(204).send();
    }
  );
}
