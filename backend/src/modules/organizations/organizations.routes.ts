import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { authenticate } from "../../middleware/authenticate";
import { requireOrgRole } from "../../middleware/rbac";
import { ok } from "../../lib/envelope";
import { ApiSuccessSchema, CursorQuerySchema, OrgIdParamSchema } from "../../schemas/common";
import { OrganizationSchema } from "../../schemas/entities";
import { toOrganizationDto } from "../../mappers";
import { NotFoundError } from "../../lib/errors";
import { parseCursor, buildPageMeta } from "../../lib/pagination";
import { slugWithSuffix } from "../../lib/slug";
import { CreateOrganizationRequestSchema, UpdateOrganizationRequestSchema } from "./organizations.schemas";

export default async function organizationsRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>();
  server.addHook("preHandler", authenticate);

  server.get(
    "/",
    {
      schema: { querystring: CursorQuerySchema, response: { 200: ApiSuccessSchema(z.array(OrganizationSchema)) } },
    },
    async (request, reply) => {
      const { cursor, limit } = request.query;
      const cursorSeq = parseCursor(cursor);

      const rows = await app.prisma.organization.findMany({
        where: {
          memberships: { some: { userId: request.user!.id, status: "ACTIVE" } },
          ...(cursorSeq ? { seq: { gt: cursorSeq } } : {}),
        },
        orderBy: { seq: "asc" },
        take: limit,
      });

      return reply.send(ok(rows.map(toOrganizationDto), buildPageMeta(rows, limit)));
    }
  );

  server.post(
    "/",
    { schema: { body: CreateOrganizationRequestSchema, response: { 201: ApiSuccessSchema(OrganizationSchema) } } },
    async (request, reply) => {
      const slug = slugWithSuffix(request.body.name);

      const org = await app.prisma.$transaction(async (tx) => {
        const created = await tx.organization.create({
          data: { name: request.body.name, slug, ownerId: request.user!.id },
        });
        await tx.membership.create({
          data: { userId: request.user!.id, organizationId: created.id, role: "OWNER", status: "ACTIVE" },
        });
        return created;
      });

      return reply.code(201).send(ok(toOrganizationDto(org)));
    }
  );

  server.get(
    "/:orgId",
    {
      preHandler: requireOrgRole(),
      schema: { params: OrgIdParamSchema, response: { 200: ApiSuccessSchema(OrganizationSchema) } },
    },
    async (request, reply) => {
      const org = await app.prisma.organization.findUnique({ where: { id: request.params.orgId } });
      if (!org) throw new NotFoundError("Organizasyon bulunamadı.");
      return reply.send(ok(toOrganizationDto(org)));
    }
  );

  server.patch(
    "/:orgId",
    {
      preHandler: requireOrgRole("OWNER", "ADMIN"),
      schema: {
        params: OrgIdParamSchema,
        body: UpdateOrganizationRequestSchema,
        response: { 200: ApiSuccessSchema(OrganizationSchema) },
      },
    },
    async (request, reply) => {
      const org = await app.prisma.organization.update({
        where: { id: request.params.orgId },
        data: request.body,
      });
      return reply.send(ok(toOrganizationDto(org)));
    }
  );

  server.delete(
    "/:orgId",
    {
      preHandler: requireOrgRole("OWNER"),
      schema: { params: OrgIdParamSchema, response: { 204: z.undefined() } },
    },
    async (request, reply) => {
      await app.prisma.organization.delete({ where: { id: request.params.orgId } });
      return reply.code(204).send();
    }
  );
}
