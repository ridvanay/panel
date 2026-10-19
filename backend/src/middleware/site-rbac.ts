import type { FastifyReply, FastifyRequest } from "fastify";
import type { SiteRole } from "@prisma/client";
import { ForbiddenError, TwoFactorSetupRequiredError, UnauthorizedError } from "../lib/errors";
import { getStaffTwoFactorRequiredAt, isStaffRole, isStaffTwoFactorEnforced } from "../lib/staff-two-factor";
import { logAudit } from "../lib/audit";

/**
 * `/admin/*` CMS uçları için org'dan bağımsız site-geneli rol kontrolü.
 * `middleware/rbac.ts::requireOrgRole` ile KARIŞTIRILMAMALI — o organizasyon
 * üyeliğine bakar, bu ise `request.user.role` (SiteRole) alanına bakar.
 * `allowedRoles` boş verilirse yalnızca "kimlik doğrulanmış mı" kontrolü yapılır.
 */
export function requireSiteRole(...allowedRoles: SiteRole[]) {
  return async function siteRbacGuard(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
    if (!request.user) throw new UnauthorizedError();

    if (allowedRoles.length > 0 && !allowedRoles.includes(request.user.role)) {
      await logAudit(request.server, {
        actorId: request.user.id,
        actorEmail: request.user.email,
        action: `${request.method} ${request.routeOptions?.url ?? request.url}`,
        status: "FORBIDDEN",
        ipAddress: request.ip,
      });
      throw new ForbiddenError("Bu işlem için yetkiniz yok.");
    }

    // Paket G — personel için zorunlu 2FA. 2FA'sı açık kullanıcı için ek sorgu YOK; ayar yalnızca
    // 2FA'sı kapalı ADMIN/MANAGER için okunur.
    if (request.user.twoFactorEnabled !== true && isStaffRole(request.user.role)) {
      const requiredAt = await getStaffTwoFactorRequiredAt(request.server.prisma);
      if (isStaffTwoFactorEnforced(requiredAt)) {
        throw new TwoFactorSetupRequiredError();
      }
    }
  };
}
