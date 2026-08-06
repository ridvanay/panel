import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { authenticate } from "../../middleware/authenticate";
import { requireSiteRole } from "../../middleware/site-rbac";
import { ok } from "../../lib/envelope";
import { ApiSuccessSchema, ApiSuccessWithMeta } from "../../schemas/common";
import { countLiveVisitors } from "../../lib/live-visitors";
import { encodeCursor, parseCursor } from "../../lib/pagination";
import { getBreakdown, getRevenueStats, getSummaryStats, getTopContent, getUsersStats, getViewsSeries, resolveStatsRange } from "../../lib/stats-query";
import {
  BreakdownSchema,
  DailyViewStatsSchema,
  LiveVisitorsSchema,
  RevenueStatsSchema,
  StatsRangeQuerySchema,
  SummaryStatsSchema,
  TopContentItemSchema,
  TopContentListMetaSchema,
  TopContentQuerySchema,
  UsersStatsSchema,
  ViewStatsQuerySchema,
} from "./stats.schemas";

/**
 * `/admin/stats` prefix'i altında bağlanır (bkz. app.ts). RBAC route-bazlıdır (§10.8.10,
 * kullanıcı tarafından onaylanmış karar) — modül-seviyesinde TEK bir `requireSiteRole`
 * hook'u YOK:
 *  - İçerik analitiği (`/views`, `/breakdown`, `/top-content`, `/live-visitors`): EDITOR + ADMIN.
 *  - Kullanıcı/gelir verisi (`/summary`, `/users`, `/revenue`): yalnızca ADMIN.
 */
export async function adminStatsRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>();
  server.addHook("preHandler", authenticate);

  const contentAnalytics = requireSiteRole("EDITOR", "ADMIN");
  const restrictedAnalytics = requireSiteRole("ADMIN");

  server.get(
    "/views",
    {
      preHandler: [contentAnalytics],
      schema: { querystring: ViewStatsQuerySchema, response: { 200: ApiSuccessSchema(z.array(DailyViewStatsSchema)) } },
    },
    async (request, reply) => {
      const range = resolveStatsRange(request.query);
      const series = await getViewsSeries(app, range, request.query.granularity);
      return reply.send(ok(series));
    }
  );

  server.get(
    "/live-visitors",
    { preHandler: [contentAnalytics], schema: { response: { 200: ApiSuccessSchema(LiveVisitorsSchema) } } },
    async (_request, reply) => {
      return reply.send(ok({ count: countLiveVisitors() }));
    }
  );

  server.get(
    "/breakdown",
    {
      preHandler: [contentAnalytics],
      schema: { querystring: ViewStatsQuerySchema, response: { 200: ApiSuccessSchema(BreakdownSchema) } },
    },
    async (request, reply) => {
      const range = resolveStatsRange(request.query);
      const result = await getBreakdown(app, range);
      return reply.send(ok(result));
    }
  );

  server.get(
    "/top-content",
    {
      preHandler: [contentAnalytics],
      schema: { querystring: TopContentQuerySchema, response: { 200: ApiSuccessWithMeta(z.array(TopContentItemSchema), TopContentListMetaSchema) } },
    },
    async (request, reply) => {
      const { cursor, limit } = request.query;
      const range = resolveStatsRange(request.query);
      const offset = parseCursor(cursor) ?? 0;

      const { items, nextOffset } = await getTopContent(app, range, offset, limit);
      const nextCursor = nextOffset !== null ? encodeCursor(nextOffset) : null;
      return reply.send(ok(items, { nextCursor }));
    }
  );

  server.get(
    "/summary",
    {
      preHandler: [restrictedAnalytics],
      schema: { querystring: StatsRangeQuerySchema, response: { 200: ApiSuccessSchema(SummaryStatsSchema) } },
    },
    async (request, reply) => {
      const range = resolveStatsRange(request.query);
      const result = await getSummaryStats(app, range, request.query.compare);
      return reply.send(
        ok({
          from: range.from.toISOString(),
          to: range.to.toISOString(),
          granularity: request.query.granularity,
          ...result,
        })
      );
    }
  );

  server.get(
    "/users",
    {
      preHandler: [restrictedAnalytics],
      schema: { querystring: StatsRangeQuerySchema, response: { 200: ApiSuccessSchema(UsersStatsSchema) } },
    },
    async (request, reply) => {
      const range = resolveStatsRange(request.query);
      const result = await getUsersStats(app, range, request.query.granularity);
      return reply.send(
        ok({
          from: range.from.toISOString(),
          to: range.to.toISOString(),
          granularity: request.query.granularity,
          ...result,
        })
      );
    }
  );

  server.get(
    "/revenue",
    {
      preHandler: [restrictedAnalytics],
      schema: { querystring: StatsRangeQuerySchema, response: { 200: ApiSuccessSchema(RevenueStatsSchema) } },
    },
    async (request, reply) => {
      const range = resolveStatsRange(request.query);
      const result = await getRevenueStats(app, range, request.query.granularity);
      return reply.send(
        ok({
          from: range.from.toISOString(),
          to: range.to.toISOString(),
          granularity: request.query.granularity,
          ...result,
        })
      );
    }
  );
}
