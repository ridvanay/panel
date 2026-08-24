import os from "node:os";
import { performance } from "node:perf_hooks";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { authenticate } from "../../middleware/authenticate";
import { requireSiteRole } from "../../middleware/site-rbac";
import { requirePanelAccess } from "../../middleware/panel-access";
import { ROLES_ADMIN } from "../../lib/site-roles";
import { ok } from "../../lib/envelope";
import { ApiSuccessSchema } from "../../schemas/common";
import { env } from "../../config/env";
import { SystemHealthSchema } from "./system.schemas";

/**
 * `/admin` prefix'i altında bağlanır (bkz. app.ts), path `/health` — nihai uç `/admin/health`.
 * Hassas sistem verisi (DB boyutu, sunucu belleği/yükü) döndürdüğü için `SiteRole=ADMIN`
 * ile sınırlıdır (bkz. `media.routes.ts`'teki aynı desen).
 */
export async function systemRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>();
  server.addHook("preHandler", authenticate);
  server.addHook("preHandler", requirePanelAccess());

  server.get(
    "/health",
    {
      preHandler: requireSiteRole(...ROLES_ADMIN),
      schema: { response: { 200: ApiSuccessSchema(SystemHealthSchema) } },
    },
    async (_request, reply) => {
      const t0 = performance.now();
      await app.prisma.$queryRaw`SELECT 1`;
      const dbPingMs = performance.now() - t0;

      const dbSizeRows = await app.prisma.$queryRaw<
        { size: bigint }[]
      >`SELECT pg_database_size(current_database()) as size`;
      const dbSizeBytes = Number(dbSizeRows[0]?.size ?? 0);

      const mediaAgg = await app.prisma.media.aggregate({ _sum: { sizeBytes: true } });
      const mediaStorageBytes = mediaAgg._sum.sizeBytes ?? 0;

      const memoryTotalBytes = os.totalmem();
      const memoryUsedBytes = memoryTotalBytes - os.freemem();

      return reply.send(
        ok({
          dbPingMs,
          dbSizeBytes,
          dbQuotaBytes: env.DB_STORAGE_QUOTA_MB ? env.DB_STORAGE_QUOTA_MB * 1024 * 1024 : null,
          mediaStorageBytes,
          mediaStorageQuotaBytes: env.MEDIA_STORAGE_QUOTA_MB ? env.MEDIA_STORAGE_QUOTA_MB * 1024 * 1024 : null,
          memoryUsedBytes,
          memoryTotalBytes,
          processMemoryBytes: process.memoryUsage().rss,
          loadAverage: os.loadavg() as [number, number, number],
          platform: process.platform,
          uptimeSeconds: process.uptime(),
          checkedAt: new Date().toISOString(),
        })
      );
    }
  );
}
