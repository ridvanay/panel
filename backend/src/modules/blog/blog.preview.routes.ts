import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { authenticate } from "../../middleware/authenticate";
import { requireSiteRole } from "../../middleware/site-rbac";
import { requirePanelAccess } from "../../middleware/panel-access";
import { ROLES_PANEL } from "../../lib/site-roles";
import { ok } from "../../lib/envelope";
import { ApiSuccessSchema, LocaleQuerySchema } from "../../schemas/common";
import { NotFoundError } from "../../lib/errors";
import { logAudit } from "../../lib/audit";
import { getPreviewPostDetail } from "./lib/blog-public";
import {
  PREVIEW_SHARE_TTL_MS,
  generateShareToken,
  issueSessionToken,
  verifySessionToken,
  verifyShareToken,
} from "./lib/preview-token";
import { PostIdParamSchema } from "./blog.schemas";

/**
 * Blog taslak önizleme uçları. Önizleme HİÇBİR durumu değiştirmez (yayın/inceleme durumu, görüntülenme sayacı).
 * Audit'e ve loglara belirteç YAZILMAZ; yalnızca postId + son geçerlilik.
 */

const TokenResponseSchema = z.object({ token: z.string(), expiresAt: z.string() });
const LinkStatusSchema = z.object({ active: z.boolean(), expiresAt: z.string().nullable(), createdAt: z.string().nullable() });

/** `/admin/blog` prefix'i altında bağlanır — yazı düzenleme rolleriyle aynı yetki. */
export async function adminBlogPreviewRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>();
  server.addHook("preHandler", authenticate);
  server.addHook("preHandler", requirePanelAccess());

  const findLivePost = async (postId: string) => {
    const post = await app.prisma.blogPost.findFirst({ where: { id: postId, deletedAt: null }, select: { id: true } });
    if (!post) throw new NotFoundError("Yazı bulunamadı.");
    return post;
  };

  server.post(
    "/:postId/preview-link",
    { preHandler: requireSiteRole(...ROLES_PANEL), schema: { params: PostIdParamSchema, response: { 200: ApiSuccessSchema(TokenResponseSchema) } } },
    async (request, reply) => {
      const post = await findLivePost(request.params.postId);
      const { token, hash } = generateShareToken();
      const now = new Date();
      const expiresAt = new Date(now.getTime() + PREVIEW_SHARE_TTL_MS);
      // Yazı başına tek etkin bağlantı: yeni özet eskisinin üzerine yazılır (eski belirteç anında geçersiz).
      await app.prisma.blogPost.update({
        where: { id: post.id },
        data: { previewTokenHash: hash, previewTokenExpiresAt: expiresAt, previewTokenCreatedAt: now, previewTokenCreatedById: request.user!.id },
        select: { id: true },
      });
      await logAudit(app, {
        actorId: request.user!.id,
        actorEmail: request.user!.email,
        action: "blog.preview_link.created",
        targetType: "BlogPost",
        targetId: post.id,
        metadata: { postId: post.id, expiresAt: expiresAt.toISOString() },
        ipAddress: request.ip,
      });
      return reply.send(ok({ token, expiresAt: expiresAt.toISOString() }));
    }
  );

  server.get(
    "/:postId/preview-link",
    { preHandler: requireSiteRole(...ROLES_PANEL), schema: { params: PostIdParamSchema, response: { 200: ApiSuccessSchema(LinkStatusSchema) } } },
    async (request, reply) => {
      const post = await app.prisma.blogPost.findUnique({
        where: { id: request.params.postId },
        select: { previewTokenHash: true, previewTokenExpiresAt: true, previewTokenCreatedAt: true },
      });
      if (!post) throw new NotFoundError("Yazı bulunamadı.");
      const active = !!post.previewTokenHash && !!post.previewTokenExpiresAt && post.previewTokenExpiresAt.getTime() > Date.now();
      return reply.send(
        ok({
          active,
          expiresAt: active ? post.previewTokenExpiresAt!.toISOString() : null,
          createdAt: active && post.previewTokenCreatedAt ? post.previewTokenCreatedAt.toISOString() : null,
        })
      );
    }
  );

  server.delete(
    "/:postId/preview-link",
    { preHandler: requireSiteRole(...ROLES_PANEL), schema: { params: PostIdParamSchema, response: { 204: z.undefined() } } },
    async (request, reply) => {
      const post = await app.prisma.blogPost.findUnique({ where: { id: request.params.postId }, select: { id: true } });
      if (!post) throw new NotFoundError("Yazı bulunamadı.");
      await app.prisma.blogPost.update({
        where: { id: post.id },
        data: { previewTokenHash: null, previewTokenExpiresAt: null, previewTokenCreatedAt: null, previewTokenCreatedById: null },
        select: { id: true },
      });
      await logAudit(app, {
        actorId: request.user!.id,
        actorEmail: request.user!.email,
        action: "blog.preview_link.revoked",
        targetType: "BlogPost",
        targetId: post.id,
        metadata: { postId: post.id },
        ipAddress: request.ip,
      });
      return reply.code(204).send();
    }
  );

  server.post(
    "/:postId/preview-session",
    { preHandler: requireSiteRole(...ROLES_PANEL), schema: { params: PostIdParamSchema, response: { 200: ApiSuccessSchema(TokenResponseSchema) } } },
    async (request, reply) => {
      const post = await findLivePost(request.params.postId);
      const { token, expiresAt } = issueSessionToken(post.id, "admin");
      return reply.send(ok({ token, expiresAt: expiresAt.toISOString() }));
    }
  );
}

const PreviewQuerySchema = LocaleQuerySchema.extend({ t: z.string().max(400).optional() });

/** `/blog` prefix'i altında bağlanır — herkese açık; erişim YALNIZCA geçerli belirteçle. */
export async function publicBlogPreviewRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>();

  // 404 dahil tüm yanıtlarda önbellek yok + arama motoru dizinlemesi yok.
  server.addHook("onRequest", async (_request, reply) => {
    reply.header("Cache-Control", "no-store");
    reply.header("X-Robots-Tag", "noindex, nofollow");
  });

  server.get(
    "/preview/:postId",
    {
      config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
      schema: { params: z.object({ postId: z.string().min(1).max(100) }), querystring: PreviewQuerySchema },
    },
    async (request, reply) => {
      const { postId } = request.params;
      const { t, locale } = request.query;
      const post = await app.prisma.blogPost.findFirst({
        where: { id: postId, deletedAt: null },
        select: { id: true, previewTokenHash: true, previewTokenExpiresAt: true },
      });

      let valid = false;
      if (post && t) {
        if (t.startsWith("s_")) {
          valid = verifyShareToken(t, post.previewTokenHash) && !!post.previewTokenExpiresAt && post.previewTokenExpiresAt.getTime() > Date.now();
        } else if (t.startsWith("p_")) {
          valid = verifySessionToken(t, post.id);
        }
      }
      // Eksik/bozuk/süresi dolmuş/iptal/başka yazıya ait/çöpte: hepsi AYNI 404 (ayrım sızdırılmaz).
      if (!post || !valid) throw new NotFoundError("Önizleme bulunamadı.");

      return reply.send(ok(await getPreviewPostDetail(app, post.id, locale)));
    }
  );
}
