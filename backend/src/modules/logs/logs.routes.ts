import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { authenticate } from "../../middleware/authenticate";
import { requireSiteRole } from "../../middleware/site-rbac";
import { requirePanelAccess } from "../../middleware/panel-access";
import { ROLES_ADMIN } from "../../lib/site-roles";
import { ok } from "../../lib/envelope";
import { ApiSuccessSchema } from "../../schemas/common";
import { AuditLogSchema } from "../../schemas/entities";
import { toAuditLogDto } from "../../mappers";
import { parseCursor, buildPageMeta } from "../../lib/pagination";
import { LogsQuerySchema } from "./logs.schemas";

// Diğer admin listeleme uçlarıyla paylaşılan global limitten (env.RATE_LIMIT_MAX) bağımsız,
// bu uca özel orta seviye üst sınır — hem savunma derinliği (hızlı veri dökümü/scraping'e karşı)
// hem de diğer admin trafiğinin (health polling, dashboard) global bütçeyi tüketmesi durumunda
// bu ucun erişiminin garanti altında kalması için (bkz. security.routes.ts::SENSITIVE_ACTION_RATE_LIMIT).
const LOGS_RATE_LIMIT = { max: 120, timeWindow: "1 minute" };

/**
 * `/admin/logs` prefix'i altında bağlanır (bkz. app.ts) — yalnızca ADMIN.
 * SAPMA: diğer tüm sayfalanan listelerin aksine (bkz. media/pages/blog: `orderBy seq:"asc"`
 * + `seq: {gt: cursor}`), loglar EN YENİ ÖNCE gösterilir → `orderBy seq:"desc"` + `seq: {lt: cursor}`.
 * `parseCursor`/`buildPageMeta` yön-bağımsız çalıştığı için bu tersine çevirme sorunsuz.
 */
export async function logsRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>();
  server.addHook("preHandler", authenticate);
  server.addHook("preHandler", requirePanelAccess());
  server.addHook("preHandler", requireSiteRole(...ROLES_ADMIN));

  server.get(
    "/",
    {
      config: { rateLimit: LOGS_RATE_LIMIT },
      schema: { querystring: LogsQuerySchema, response: { 200: ApiSuccessSchema(z.array(AuditLogSchema)) } },
    },
    async (request, reply) => {
      const { cursor, limit, status, action } = request.query;
      const cursorSeq = parseCursor(cursor);

      const rows = await app.prisma.auditLog.findMany({
        where: {
          ...(status ? { status } : {}),
          ...(action ? { action: { startsWith: action } } : {}),
          ...(cursorSeq ? { seq: { lt: cursorSeq } } : {}),
        },
        orderBy: { seq: "desc" },
        take: limit,
      });

      return reply.send(ok(rows.map(toAuditLogDto), buildPageMeta(rows, limit)));
    }
  );
}
