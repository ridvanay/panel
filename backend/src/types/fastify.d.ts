import "fastify";
import type { PrismaClient, MembershipRole, SiteRole } from "@prisma/client";

declare module "fastify" {
  interface FastifyInstance {
    prisma: PrismaClient;
  }

  interface FastifyRequest {
    user?: { id: string; email: string; role: SiteRole };
    membership?: { role: MembershipRole; organizationId: string };
  }
}
