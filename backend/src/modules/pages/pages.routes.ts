import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { authenticate } from "../../middleware/authenticate";
import { requireSiteRole } from "../../middleware/site-rbac";
import { ok } from "../../lib/envelope";
import { ApiSuccessSchema, CursorQuerySchema } from "../../schemas/common";
import { PageSchema } from "../../schemas/entities";
import { toPageDto } from "../../mappers";
import { NotFoundError } from "../../lib/errors";
import { parseCursor, buildPageMeta } from "../../lib/pagination";
import { slugify } from "../../lib/slug";
import { startOfUtcDay } from "../../lib/date";
import { detectDeviceType } from "../../lib/device";
import { detectCountry } from "../../lib/geo";
import { touchVisitor } from "../../lib/live-visitors";
import { CreatePageRequestSchema, PageIdParamSchema, PageSlugParamSchema, UpdatePageRequestSchema } from "./pages.schemas";

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
      const { title, slug, status, blocks, seoTitle, seoDescription } = request.body;

      const page = await app.prisma.page.create({
        data: {
          title,
          slug: slug ? slugify(slug) : slugify(title),
          status: status ?? "DRAFT",
          blocks: (blocks ?? []) as Prisma.InputJsonValue,
          seoTitle,
          seoDescription,
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

      const { slug, ...rest } = request.body;

      const page = await app.prisma.page.update({
        where: { id: request.params.pageId },
        data: {
          ...rest,
          blocks: rest.blocks !== undefined ? (rest.blocks as Prisma.InputJsonValue) : undefined,
          ...(slug !== undefined ? { slug: slugify(slug) } : {}),
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
    { schema: { params: PageSlugParamSchema, response: { 200: ApiSuccessSchema(PageSchema) } } },
    async (request, reply) => {
      const page = await app.prisma.page.findFirst({
        where: { slug: request.params.slug, status: "PUBLISHED" },
      });
      if (!page) throw new NotFoundError("Sayfa bulunamadı.");
      return reply.send(ok(toPageDto(page)));
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
