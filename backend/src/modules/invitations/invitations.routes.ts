import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { authenticate } from "../../middleware/authenticate";
import { requireOrgRole } from "../../middleware/rbac";
import { ok } from "../../lib/envelope";
import { ApiSuccessSchema, OrgIdParamSchema } from "../../schemas/common";
import { InvitationSchema, MembershipSchema } from "../../schemas/entities";
import { toInvitationDto, toMembershipDto } from "../../mappers";
import { ApiError, ConflictError, ForbiddenError } from "../../lib/errors";
import { generateOpaqueToken, hashToken } from "../../lib/tokens";
import { env } from "../../config/env";
import { CreateInvitationRequestSchema, InvitationTokenParamSchema } from "./invitations.schemas";

const USER_SELECT = { id: true, name: true, email: true, avatarUrl: true } as const;
const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** `/organizations/:orgId/invitations` prefix'i altında bağlanır (bkz. app.ts). */
export async function orgInvitationsRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>();
  server.addHook("preHandler", authenticate);

  server.get(
    "/",
    {
      preHandler: requireOrgRole("OWNER", "ADMIN"),
      schema: { params: OrgIdParamSchema, response: { 200: ApiSuccessSchema(z.array(InvitationSchema)) } },
    },
    async (request, reply) => {
      const invitations = await app.prisma.invitation.findMany({
        where: { organizationId: request.params.orgId, status: "PENDING" },
        orderBy: { createdAt: "asc" },
      });
      return reply.send(ok(invitations.map(toInvitationDto)));
    }
  );

  server.post(
    "/",
    {
      preHandler: requireOrgRole("OWNER", "ADMIN"),
      schema: {
        params: OrgIdParamSchema,
        body: CreateInvitationRequestSchema,
        response: { 201: ApiSuccessSchema(InvitationSchema) },
      },
    },
    async (request, reply) => {
      const email = request.body.email.toLowerCase();
      const organizationId = request.params.orgId;

      const existingMember = await app.prisma.membership.findFirst({
        where: { organizationId, user: { email } },
      });
      if (existingMember) throw new ConflictError("Bu e-posta zaten organizasyon üyesi.");

      const existingInvite = await app.prisma.invitation.findFirst({
        where: { organizationId, email, status: "PENDING" },
      });
      if (existingInvite) throw new ConflictError("Bu e-postaya zaten bekleyen bir davet var.");

      const rawToken = generateOpaqueToken();
      const invitation = await app.prisma.invitation.create({
        data: {
          organizationId,
          email,
          role: request.body.role,
          tokenHash: hashToken(rawToken),
          expiresAt: new Date(Date.now() + INVITATION_TTL_MS),
        },
      });

      // TODO(email-provider): Resend/SES bağlanana kadar davet bağlantısı loglanır.
      app.log.info(
        { acceptUrl: `${env.FRONTEND_URL}/invitations/${rawToken}/accept` },
        "Organizasyon daveti (dev-log)"
      );

      return reply.code(201).send(ok(toInvitationDto(invitation)));
    }
  );
}

/** `/invitations` prefix'i altında bağlanır — orgId gerektirmez, token kendini kanıtlar. */
export async function acceptInvitationRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>();

  server.post(
    "/:token/accept",
    {
      preHandler: authenticate,
      schema: { params: InvitationTokenParamSchema, response: { 200: ApiSuccessSchema(MembershipSchema) } },
    },
    async (request, reply) => {
      const tokenHash = hashToken(request.params.token);
      const invitation = await app.prisma.invitation.findUnique({ where: { tokenHash } });

      if (!invitation || invitation.status !== "PENDING" || invitation.expiresAt.getTime() < Date.now()) {
        throw new ApiError(410, "NOT_FOUND", "Davet süresi dolmuş veya geçersiz.");
      }

      if (invitation.email.toLowerCase() !== request.user!.email.toLowerCase()) {
        throw new ForbiddenError("Bu davet başka bir e-posta adresine gönderilmiş.");
      }

      const membership = await app.prisma.$transaction(async (tx) => {
        const membershipRow = await tx.membership.upsert({
          where: { userId_organizationId: { userId: request.user!.id, organizationId: invitation.organizationId } },
          create: {
            userId: request.user!.id,
            organizationId: invitation.organizationId,
            role: invitation.role,
            status: "ACTIVE",
          },
          update: { role: invitation.role, status: "ACTIVE" },
          include: { user: { select: USER_SELECT } },
        });
        await tx.invitation.update({ where: { id: invitation.id }, data: { status: "ACCEPTED" } });
        return membershipRow;
      });

      return reply.send(ok(toMembershipDto(membership)));
    }
  );
}
