import type { FastifyReply, FastifyRequest } from "fastify";
import { ForbiddenError, UnauthorizedError } from "../lib/errors";
import { logAudit } from "../lib/audit";
import { canUseAdvancedBuilder } from "../lib/builder-capability";

/**
 * §10.20 — İKİNCİ yetki eksenİ (bkz. `.claude/architect-scope-page-editor-roles.md` §4.1).
 * `middleware/site-rbac.ts::requireSiteRole`'DEN SONRA çalışacak şekilde preHandler
 * zincirine eklenir (yani `request.user` zaten dolu VE rol kontrolünden geçmiş varsayılır) —
 * o dosyadaki desenin BİREBİR AYNISI: `canUseAdvancedBuilder(request.user)` false ise
 * `ForbiddenError` + `FORBIDDEN` statülü audit kaydı.
 */
export function requireAdvancedBuilder() {
  return async function advancedBuilderGuard(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
    if (!request.user) throw new UnauthorizedError();

    if (!canUseAdvancedBuilder(request.user)) {
      await logAudit(request.server, {
        actorId: request.user.id,
        actorEmail: request.user.email,
        action: `${request.method} ${request.routeOptions?.url ?? request.url}`,
        status: "FORBIDDEN",
        ipAddress: request.ip,
      });
      throw new ForbiddenError("Bu işlem için Gelişmiş Düzenleyici yetkisi gerekli.");
    }
  };
}
