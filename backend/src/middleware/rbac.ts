import type { FastifyReply, FastifyRequest } from "fastify";
import type { MembershipRole } from "@prisma/client";
import { ForbiddenError, UnauthorizedError } from "../lib/errors";

/**
 * Aktif organizasyon (:orgId path param) içindeki üyeliği yükler ve role göre yetkilendirir.
 * `allowedRoles` boş verilirse yalnızca "aktif üye mi" kontrolü yapılır (rol serbest).
 * request.user'ın önceden `authenticate` ile doldurulmuş olması gerekir.
 */
export function requireOrgRole(...allowedRoles: MembershipRole[]) {
  // Kasıtlı olarak generic'siz `FastifyRequest`: preHandler'a somut bir Params tipi
  // vermek, TypeScript'in route'un zod şemasından çıkardığı daha geniş Params tipini
  // (ör. members.routes.ts'teki :userId) preHandler'ın dar tipiyle daraltmasına yol açıyor.
  return async function rbacGuard(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
    if (!request.user) {
      throw new UnauthorizedError();
    }

    const { orgId } = request.params as { orgId: string };

    const membership = await request.server.prisma.membership.findUnique({
      where: {
        userId_organizationId: {
          userId: request.user.id,
          organizationId: orgId,
        },
      },
    });

    if (!membership || membership.status !== "ACTIVE") {
      throw new ForbiddenError("Bu organizasyona erişiminiz yok.");
    }

    if (allowedRoles.length > 0 && !allowedRoles.includes(membership.role)) {
      throw new ForbiddenError("Bu işlem için yetkiniz yok.");
    }

    request.membership = { role: membership.role, organizationId: membership.organizationId };
  };
}
