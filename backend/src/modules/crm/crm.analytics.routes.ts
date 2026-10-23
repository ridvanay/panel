import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ok } from "../../lib/envelope";
import { logAudit } from "../../lib/audit";
import { NotFoundError, ValidationError } from "../../lib/errors";
import { parseOr422 } from "./crm.validate";
import {
  audienceReport,
  ClicksQuerySchema,
  clicksReport,
  heatmap,
  heatmapPages,
  HeatmapQuerySchema,
  listVisitors,
  liveSessions,
  overview,
  pageMap,
  RangeQuerySchema,
  sourcesReport,
  VisitorListQuerySchema,
  visitorDetail,
} from "./crm.analytics";

function range(query: unknown) {
  const parsed = parseOr422(RangeQuerySchema, query);
  if (parsed.from > parsed.to) throw new ValidationError("Başlangıç tarihi bitişten sonra olamaz.", { from: ["Geçersiz aralık."] });
  return parsed;
}

/** Paket N3 — `/admin/crm/analytics/*` (ADMIN + 2FA, `crmAdminRoutes` içinde kayıtlı). */
export async function registerCrmAnalyticsRoutes(app: FastifyInstance) {
  app.get("/analytics/overview", async (request, reply) => reply.send(ok(await overview(app, range(request.query)))));
  app.get("/analytics/live", async (_request, reply) => reply.send(ok(await liveSessions(app))));
  app.get("/analytics/pages", async (request, reply) => reply.send(ok(await pageMap(app, range(request.query)))));
  app.get("/analytics/sources", async (request, reply) => reply.send(ok(await sourcesReport(app, range(request.query)))));
  app.get("/analytics/audience", async (request, reply) => reply.send(ok(await audienceReport(app, range(request.query)))));
  app.get("/analytics/clicks", async (request, reply) => {
    const query = parseOr422(ClicksQuerySchema, request.query);
    return reply.send(ok(await clicksReport(app, query)));
  });
  app.get("/analytics/heatmap/pages", async (request, reply) => reply.send(ok(await heatmapPages(app, range(request.query)))));
  app.get("/analytics/heatmap", async (request, reply) => {
    const query = parseOr422(HeatmapQuerySchema, request.query);
    return reply.send(ok(await heatmap(app, query)));
  });

  app.get("/visitors", async (request, reply) => {
    const query = parseOr422(VisitorListQuerySchema, request.query);
    const result = await listVisitors(app, query);
    return reply.send(ok(result.items, { total: result.total, page: query.page, pageSize: query.pageSize, hotThreshold: result.hotThreshold }));
  });

  app.get("/visitors/:id", async (request, reply) => {
    const { id } = parseOr422(z.object({ id: z.string().regex(/^[A-Za-z0-9_-]{16,40}$/) }), request.params);
    const detail = await visitorDetail(app, id);
    if (!detail) throw new NotFoundError("Ziyaretçi bulunamadı.");
    await logAudit(app, { actorId: request.user!.id, actorEmail: request.user!.email, action: "crm.visitor.viewed", targetType: "CrmVisitor", targetId: id, ipAddress: request.ip });
    return reply.send(ok(detail));
  });
}
