import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { authenticate } from "../../middleware/authenticate";
import { ok } from "../../lib/envelope";
import { ApiSuccessSchema } from "../../schemas/common";
import { addUtcDays, startOfUtcDay, toDateKey } from "../../lib/date";
import { DailyViewStatsSchema, ViewStatsQuerySchema } from "./stats.schemas";

/** `/admin/stats` prefix'i altında bağlanır (bkz. app.ts) — authenticated. */
export async function adminStatsRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>();
  server.addHook("preHandler", authenticate);

  server.get(
    "/views",
    {
      schema: { querystring: ViewStatsQuerySchema, response: { 200: ApiSuccessSchema(z.array(DailyViewStatsSchema)) } },
    },
    async (request, reply) => {
      const { days } = request.query;
      const since = addUtcDays(startOfUtcDay(), -(days - 1));

      const rows = await app.prisma.pageView.findMany({
        where: { date: { gte: since } },
        select: { date: true, count: true, pageId: true },
      });

      const byDate = new Map<string, { pageViews: number; postViews: number }>();
      for (let i = 0; i < days; i++) {
        byDate.set(toDateKey(addUtcDays(since, i)), { pageViews: 0, postViews: 0 });
      }

      for (const row of rows) {
        const bucket = byDate.get(toDateKey(row.date));
        if (!bucket) continue;
        if (row.pageId) bucket.pageViews += row.count;
        else bucket.postViews += row.count;
      }

      const result = Array.from(byDate.entries()).map(([date, counts]) => ({ date, ...counts }));
      return reply.send(ok(result));
    }
  );
}
