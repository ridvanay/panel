import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { authenticate } from "../../middleware/authenticate";
import { requireSiteRole } from "../../middleware/site-rbac";
import { ok } from "../../lib/envelope";
import { ApiSuccessSchema } from "../../schemas/common";
import { AuditLogSchema } from "../../schemas/entities";
import { toAuditLogDto } from "../../mappers";
import { parseCursor, buildPageMeta } from "../../lib/pagination";
import { LogsQuerySchema } from "./logs.schemas";

/**
 * `/admin/logs` prefix'i altında bağlanır (bkz. app.ts) — yalnızca ADMIN.
 * SAPMA: diğer tüm sayfalanan listelerin aksine (bkz. media/pages/blog: `orderBy seq:"asc"`
 * + `seq: {gt: cursor}`), loglar EN YENİ ÖNCE gösterilir → `orderBy seq:"desc"` + `seq: {lt: cursor}`.
 * `parseCursor`/`buildPageMeta` yön-bağımsız çalıştığı için bu tersine çevirme sorunsuz.
 */
export async function logsRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>();
  server.addHook("preHandler", authenticate);
  server.addHook("preHandler", requireSiteRole("ADMIN"));

  server.get(
    "/",
    { schema: { querystring: LogsQuerySchema, response: { 200: ApiSuccessSchema(z.array(AuditLogSchema)) } } },
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
