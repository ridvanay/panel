import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { authenticate } from "../../middleware/authenticate";
import { ok } from "../../lib/envelope";
import { ApiSuccessSchema } from "../../schemas/common";
import { addUtcDays, startOfUtcDay, toDateKey } from "../../lib/date";
import { countLiveVisitors } from "../../lib/live-visitors";
import { BreakdownSchema, DailyViewStatsSchema, LiveVisitorsSchema, ViewStatsQuerySchema } from "./stats.schemas";

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

      // Artık gün başına birden fazla PageView satırı (deviceType/country kırılımı) olabilir,
      // bilerek toplanıyor — "günde 1 satır" varsayımı yapılmıyor.
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

  server.get(
    "/live-visitors",
    { schema: { response: { 200: ApiSuccessSchema(LiveVisitorsSchema) } } },
    async (_request, reply) => {
      return reply.send(ok({ count: countLiveVisitors() }));
    }
  );

  server.get(
    "/breakdown",
    { schema: { querystring: ViewStatsQuerySchema, response: { 200: ApiSuccessSchema(BreakdownSchema) } } },
    async (request, reply) => {
      const { days } = request.query;
      const since = addUtcDays(startOfUtcDay(), -(days - 1));

      const deviceRows = await app.prisma.pageView.groupBy({
        by: ["deviceType"],
        where: { date: { gte: since } },
        _sum: { count: true },
      });

      const countryRowsRaw = await app.prisma.pageView.groupBy({
        by: ["country"],
        where: { date: { gte: since } },
        _sum: { count: true },
        orderBy: { _sum: { count: "desc" } },
      });

      const top10 = countryRowsRaw.slice(0, 10).map((r) => ({ country: r.country, count: r._sum.count ?? 0 }));
      const otherCount = countryRowsRaw.slice(10).reduce((sum, r) => sum + (r._sum.count ?? 0), 0);
      const countries = otherCount > 0 ? [...top10, { country: "OTHER", count: otherCount }] : top10;

      const devices = deviceRows.map((r) => ({ type: r.deviceType, count: r._sum.count ?? 0 }));

      return reply.send(ok({ devices, countries }));
    }
  );
}
