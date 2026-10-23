import type { FastifyReply, FastifyRequest } from "fastify";
import { requireSiteRole } from "../../middleware/site-rbac";
import { TwoFactorRequiredError } from "../../lib/errors";

/**
 * Paket N — CRM erişimi: YALNIZCA ADMIN rolü VE hesabında 2FA açık olan kullanıcı. Talep notları ve
 * kişi bilgisi sağlık verisi içerebileceği için MANAGER/EDITOR erişemez; 2FA'sı kapalı ADMIN 403
 * (`TWO_FACTOR_REQUIRED`) alır. Rol reddi `requireSiteRole` üzerinden FORBIDDEN olarak audit'e yazılır.
 */
export function requireCrmAccess() {
  const adminOnly = requireSiteRole("ADMIN");
  return async function crmAccessGuard(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    await adminOnly(request, reply);
    if (request.user?.twoFactorEnabled !== true) {
      throw new TwoFactorRequiredError("CRM'e erişmek için hesabınızda iki adımlı doğrulama (2FA) açık olmalı.");
    }
  };
}
