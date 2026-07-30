import "fastify";
import type { PrismaClient, MembershipRole } from "@prisma/client";

declare module "fastify" {
  interface FastifyInstance {
    prisma: PrismaClient;
  }

  interface FastifyRequest {
    user?: { id: string; email: string };
    membership?: { role: MembershipRole; organizationId: string };
  }
}
