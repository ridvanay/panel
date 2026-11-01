import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { authenticate } from "../../middleware/authenticate";
import { ok } from "../../lib/envelope";
import { ApiSuccessSchema } from "../../schemas/common";
import { NotFoundError } from "../../lib/errors";
import { logAudit } from "../../lib/audit";
import { CACHE_TAGS, triggerTagRevalidation } from "../../lib/revalidate";
import { requireDoctorPortalAccess } from "../telehealth/telehealth.portal.routes";
import { RequestChangesBodySchema, ReviewPostIdParamSchema } from "./blog.schemas";

/**
 * Paket Z1 — doktor panelinde tıbbi inceleme kuyruğu. `/doctor` prefix'i altında bağlanır.
 * Doktor YALNIZCA kendisine atanmış (reviewerDoctorId = kendi profili) yazıları görür; başkasının yazısı 404.
 * Değişiklik yetkisi bu listeyle sınırlıdır: yalnızca `medicalReviewStatus`/`lastReviewedAt`/`medicalReviewNote`.
 * Audit'e yalnızca postId (+ not uzunluğu) yazılır; not METNİ audit'e girmez.
 */

const ReviewItemSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  excerpt: z.string().nullable(),
  status: z.enum(["DRAFT", "PUBLISHED", "SCHEDULED"]),
  medicalReviewStatus: z.enum(["pending", "changes_requested", "approved"]),
  medicalReviewNote: z.string().nullable(),
  category: z.object({ name: z.string(), slug: z.string() }).nullable(),
  readingMinutes: z.number().int().nullable(),
  keyTakeaways: z.array(z.string()),
  contentHtml: z.string(),
  lastReviewedAt: z.string().nullable(),
  updatedAt: z.string(),
});

type ReviewRow = {
  id: string;
  title: string;
  excerpt: string | null;
  status: "DRAFT" | "PUBLISHED" | "SCHEDULED";
  medicalReviewStatus: string | null;
  medicalReviewNote: string | null;
  category: { name: string; slug: string } | null;
  readingMinutes: number | null;
  keyTakeaways: unknown;
  contentHtml: string;
  lastReviewedAt: Date | null;
  updatedAt: Date;
};

const REVIEW_SELECT = {
  id: true,
  title: true,
  excerpt: true,
  status: true,
  medicalReviewStatus: true,
  medicalReviewNote: true,
  category: { select: { name: true, slug: true } },
  readingMinutes: true,
  keyTakeaways: true,
  contentHtml: true,
  lastReviewedAt: true,
  updatedAt: true,
} as const;

function toReviewItem(row: ReviewRow) {
  return {
    id: row.id,
    title: row.title,
    excerpt: row.excerpt,
    status: row.status,
    medicalReviewStatus: (row.medicalReviewStatus ?? "pending") as "pending" | "changes_requested" | "approved",
    medicalReviewNote: row.medicalReviewNote,
    category: row.category,
    readingMinutes: row.readingMinutes,
    keyTakeaways: Array.isArray(row.keyTakeaways) ? (row.keyTakeaways as string[]) : [],
    contentHtml: row.contentHtml,
    lastReviewedAt: row.lastReviewedAt ? row.lastReviewedAt.toISOString() : null,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function doctorBlogReviewRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>();
  server.addHook("preHandler", authenticate);

  /** Kendi atanmış, çöpte olmayan ve sırası gelen (onay bekleyen/değişiklik istenen) yazılar. */
  const ownReviewable = (doctorProfileId: string, id?: string) => ({
    ...(id ? { id } : {}),
    reviewerDoctorId: doctorProfileId,
    deletedAt: null,
    OR: [{ medicalReviewStatus: null }, { medicalReviewStatus: { in: ["pending", "changes_requested"] } }],
  });

  server.get("/blog-reviews", { schema: { response: { 200: ApiSuccessSchema(z.array(ReviewItemSchema)) } } }, async (request, reply) => {
    const { doctorProfileId } = await requireDoctorPortalAccess(app, request.user!.id);
    const rows = await app.prisma.blogPost.findMany({
      where: ownReviewable(doctorProfileId),
      orderBy: [{ updatedAt: "desc" }],
      take: 100,
      select: REVIEW_SELECT,
    });
    return reply.send(ok(rows.map(toReviewItem)));
  });

  server.post(
    "/blog-reviews/:id/approve",
    { schema: { params: ReviewPostIdParamSchema, response: { 200: ApiSuccessSchema(ReviewItemSchema) } } },
    async (request, reply) => {
      const { user, doctorProfileId } = await requireDoctorPortalAccess(app, request.user!.id);
      const post = await app.prisma.blogPost.findFirst({ where: ownReviewable(doctorProfileId, request.params.id), select: { id: true } });
      if (!post) throw new NotFoundError("İncelenecek yazı bulunamadı.");

      const updated = await app.prisma.blogPost.update({
        where: { id: post.id },
        data: { medicalReviewStatus: "approved", lastReviewedAt: new Date(), medicalReviewNote: null },
        select: REVIEW_SELECT,
      });
      await logAudit(app, {
        actorId: user.id,
        actorEmail: user.email,
        action: "blog.medical_review.approved",
        targetType: "BlogPost",
        targetId: post.id,
        metadata: { postId: post.id, doctorProfileId },
        ipAddress: request.ip,
      });
      // Yayındaki yazıda hekim onayı satırı görünür hâle gelir.
      await triggerTagRevalidation(app, [CACHE_TAGS.blog]);
      return reply.send(ok(toReviewItem(updated)));
    }
  );

  server.post(
    "/blog-reviews/:id/request-changes",
    { schema: { params: ReviewPostIdParamSchema, body: RequestChangesBodySchema, response: { 200: ApiSuccessSchema(ReviewItemSchema) } } },
    async (request, reply) => {
      const { user, doctorProfileId } = await requireDoctorPortalAccess(app, request.user!.id);
      const post = await app.prisma.blogPost.findFirst({ where: ownReviewable(doctorProfileId, request.params.id), select: { id: true } });
      if (!post) throw new NotFoundError("İncelenecek yazı bulunamadı.");

      const updated = await app.prisma.blogPost.update({
        where: { id: post.id },
        data: { medicalReviewStatus: "changes_requested", medicalReviewNote: request.body.note },
        select: REVIEW_SELECT,
      });
      await logAudit(app, {
        actorId: user.id,
        actorEmail: user.email,
        action: "blog.medical_review.changes_requested",
        targetType: "BlogPost",
        targetId: post.id,
        // Not metni audit'e YAZILMAZ; yalnızca uzunluğu.
        metadata: { postId: post.id, doctorProfileId, noteLength: request.body.note.length },
        ipAddress: request.ip,
      });
      await triggerTagRevalidation(app, [CACHE_TAGS.blog]);
      return reply.send(ok(toReviewItem(updated)));
    }
  );
}
