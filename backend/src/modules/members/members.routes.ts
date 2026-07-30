import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { authenticate } from "../../middleware/authenticate";
import { requireOrgRole } from "../../middleware/rbac";
import { ok } from "../../lib/envelope";
import { ApiSuccessSchema, CursorQuerySchema, OrgIdParamSchema, OrgMemberParamSchema } from "../../schemas/common";
import { MembershipSchema } from "../../schemas/entities";
import { toMembershipDto } from "../../mappers";
import { ConflictError, NotFoundError } from "../../lib/errors";
import { parseCursor, buildPageMeta } from "../../lib/pagination";
import { UpdateMembershipRequestSchema } from "./members.schemas";

const USER_SELECT = { id: true, name: true, email: true, avatarUrl: true } as const;

/** Bu router `/organizations/:orgId/members` prefix'i altında bağlanır (bkz. app.ts). */
export default async function membersRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>();
  server.addHook("preHandler", authenticate);

  server.get(
    "/",
    {
      preHandler: requireOrgRole(),
      schema: {
        params: OrgIdParamSchema,
        querystring: CursorQuerySchema,
        response: { 200: ApiSuccessSchema(z.array(MembershipSchema)) },
      },
    },
    async (request, reply) => {
      const { cursor, limit } = request.query;
      const cursorSeq = parseCursor(cursor);

      const rows = await app.prisma.membership.findMany({
        where: {
          organizationId: request.params.orgId,
          ...(cursorSeq ? { seq: { gt: cursorSeq } } : {}),
        },
        orderBy: { seq: "asc" },
        take: limit,
        include: { user: { select: USER_SELECT } },
      });

      return reply.send(ok(rows.map(toMembershipDto), buildPageMeta(rows, limit)));
    }
  );

  server.patch(
    "/:userId",
    {
      preHandler: requireOrgRole("OWNER", "ADMIN"),
      schema: {
        params: OrgMemberParamSchema,
        body: UpdateMembershipRequestSchema,
        response: { 200: ApiSuccessSchema(MembershipSchema) },
      },
    },
    async (request, reply) => {
      const org = await app.prisma.organization.findUnique({
        where: { id: request.params.orgId },
        select: { ownerId: true },
      });
      if (!org) throw new NotFoundError("Organizasyon bulunamadı.");
      if (org.ownerId === request.params.userId) {
        throw new ConflictError("Organizasyon sahibinin rolü bu uç noktadan değiştirilemez.");
      }

      const membership = await app.prisma.membership
        .update({
          where: { userId_organizationId: { userId: request.params.userId, organizationId: request.params.orgId } },
          data: { role: request.body.role },
          include: { user: { select: USER_SELECT } },
        })
        .catch(() => {
          throw new NotFoundError("Üyelik bulunamadı.");
        });

      return reply.send(ok(toMembershipDto(membership)));
    }
  );

  server.delete(
    "/:userId",
    {
      preHandler: requireOrgRole("OWNER", "ADMIN"),
      schema: { params: OrgMemberParamSchema, response: { 204: z.undefined() } },
    },
    async (request, reply) => {
      const org = await app.prisma.organization.findUnique({
        where: { id: request.params.orgId },
        select: { ownerId: true },
      });
      if (!org) throw new NotFoundError("Organizasyon bulunamadı.");
      if (org.ownerId === request.params.userId) {
        throw new ConflictError("Organizasyon sahibi çıkarılamaz.");
      }

      await app.prisma.membership
        .delete({
          where: { userId_organizationId: { userId: request.params.userId, organizationId: request.params.orgId } },
        })
        .catch(() => {
          throw new NotFoundError("Üyelik bulunamadı.");
        });

      return reply.code(204).send();
    }
  );
}
