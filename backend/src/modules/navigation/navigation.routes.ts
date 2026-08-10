import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { authenticate } from "../../middleware/authenticate";
import { requireSiteRole } from "../../middleware/site-rbac";
import { ok } from "../../lib/envelope";
import { ApiSuccessSchema } from "../../schemas/common";
import { NavigationConfigSchema } from "../../schemas/entities";
import { toNavigationConfigDto } from "../../mappers";
import { logAudit } from "../../lib/audit";
import { DEFAULTS, SETTINGS_ID } from "../settings/settings.routes";
import { UpdateNavigationConfigRequestSchema } from "./navigation.schemas";

async function readNavigationConfig(app: FastifyInstance) {
  const [settings, navigationItems, socialLinks, footerColumns] = await Promise.all([
    app.prisma.siteSettings.findUnique({ where: { id: SETTINGS_ID } }),
    // Kök öğeler her zaman alt öğelerden önce gelir (nulls first) — tüketici tek geçişte
    // ağacı kurabilir. Bkz. ARCHITECTURE.md §10.10.1.
    app.prisma.navigationItem.findMany({
      orderBy: [{ parentId: { sort: "asc", nulls: "first" } }, { order: "asc" }],
    }),
    app.prisma.socialLink.findMany({ orderBy: { order: "asc" } }),
    app.prisma.footerColumn.findMany({ orderBy: { order: "asc" }, include: { links: { orderBy: { order: "asc" } } } }),
  ]);
  return toNavigationConfigDto({ settings, navigationItems, socialLinks, footerColumns });
}

/** `/navigation` prefix'i altında bağlanır — herkese açık, site header/nav/footer'ı bunu okur. */
export async function publicNavigationRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>();

  server.get("/", { schema: { response: { 200: ApiSuccessSchema(NavigationConfigSchema) } } }, async (_request, reply) => {
    return reply.send(ok(await readNavigationConfig(app)));
  });
}

/** `/admin/navigation` prefix'i altında bağlanır — authenticated. */
export async function adminNavigationRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>();
  server.addHook("preHandler", authenticate);

  server.get("/", { schema: { response: { 200: ApiSuccessSchema(NavigationConfigSchema) } } }, async (_request, reply) => {
    return reply.send(ok(await readNavigationConfig(app)));
  });

  server.put(
    "/",
    {
      preHandler: requireSiteRole("ADMIN"),
      schema: { body: UpdateNavigationConfigRequestSchema, response: { 200: ApiSuccessSchema(NavigationConfigSchema) } },
    },
    async (request, reply) => {
      const body = request.body;

      const navigationConfigFields = {
        headerCtaLabel: body.headerCtaLabel,
        headerCtaHref: body.headerCtaHref,
        footerCopyrightText: body.footerCopyrightText,
      };

      await app.prisma.$transaction(async (tx) => {
        await tx.siteSettings.upsert({
          where: { id: SETTINGS_ID },
          create: { id: SETTINGS_ID, ...DEFAULTS, ...navigationConfigFields },
          update: navigationConfigFields,
        });

        await tx.navigationItem.deleteMany({});
        if (body.navigationItems.length > 0) {
          // Kararlı iki-parçalı bölme: kök öğeler (parentId === null) alt öğelerden ÖNCE
          // yazılır. Derinlik 2 olduğu için bu, genel bir topolojik sıralamaya eşdeğerdir ve
          // Prisma `createMany`'nin parametre limiti nedeniyle çoklu ifadeye bölünmesi
          // durumunda dahi FK ihlalini engeller. ATLAMA — bkz. ARCHITECTURE.md §10.10.3.
          const roots = body.navigationItems.filter((item) => item.parentId == null);
          const children = body.navigationItems.filter((item) => item.parentId != null);
          await tx.navigationItem.createMany({ data: [...roots, ...children] });
        }

        await tx.socialLink.deleteMany({});
        if (body.socialLinks.length > 0) await tx.socialLink.createMany({ data: body.socialLinks });

        // Kolonları silmek Cascade ile bağlı footerLink'leri de otomatik siler (bkz. schema.prisma).
        await tx.footerColumn.deleteMany({});
        for (const col of body.footerColumns) {
          await tx.footerColumn.create({ data: { title: col.title, order: col.order, links: { create: col.links } } });
        }
      });

      await logAudit(app, {
        actorId: request.user!.id,
        actorEmail: request.user!.email,
        action: "navigation.update",
        targetType: "NavigationConfig",
        targetId: "singleton",
        metadata: {
          itemCount: body.navigationItems.length,
          socialCount: body.socialLinks.length,
          columnCount: body.footerColumns.length,
        },
        ipAddress: request.ip,
      });

      return reply.send(ok(await readNavigationConfig(app)));
    }
  );
}
