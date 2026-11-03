import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { requireModuleEnabled } from "../../middleware/module-guard";
import { authenticate } from "../../middleware/authenticate";
import { requireSiteRole } from "../../middleware/site-rbac";
import { requirePanelAccess } from "../../middleware/panel-access";
import { ROLES_ADMIN } from "../../lib/site-roles";
import { ok } from "../../lib/envelope";
import { ApiSuccessSchema, ApiSuccessWithMeta } from "../../schemas/common";
import { MeetingNotEditableError, MeetingNotFoundError } from "../../lib/errors";
import { AdminMeetingSchema, ListAdminMeetingsQuerySchema, MeetingIdParamSchema } from "./meetings.schemas";
import { ADMIN_MEETING_INCLUDE, assertNotServiceManaged, buildMeetingListQuery, cancelMeeting, computePhase, encodeMeetingCursor, toAdminMeetingDto } from "./meetings.service";

const ADMIN_MEETINGS_RATE_LIMIT = { max: 30, timeWindow: "1 minute" };

/**
 * `/admin/meetings` prefix'i altında bağlanır. Paket AG (İş 3, S4) — ADMIN gözetimi: tüm toplantıları listeler
 * ve iptal eder. Katılım hakkı YOKTUR: bu plugin hiçbir token ucu içermez; ADMIN başkasının toplantısı için
 * `host-token` çağırırsa 404 alır (Paket E ilkesi). Misafir adları ve ev sahibinin notu bu uçlarda dönmez.
 */
export async function adminMeetingsRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>();
  server.addHook("preHandler", requireModuleEnabled("telehealth"));
  server.addHook("preHandler", authenticate);
  server.addHook("preHandler", requirePanelAccess());
  server.addHook("preHandler", requireSiteRole(...ROLES_ADMIN));

  server.get(
    "/",
    {
      schema: {
        querystring: ListAdminMeetingsQuerySchema,
        response: { 200: ApiSuccessWithMeta(z.array(AdminMeetingSchema), z.object({ nextCursor: z.string().nullable() })) },
      },
    },
    async (request, reply) => {
      const { scope, hostUserId, cursor, limit } = request.query;
      const now = new Date();
      const query = buildMeetingListQuery(scope, cursor, now);
      const rows = await app.prisma.externalMeeting.findMany({
        where: { AND: [hostUserId ? { hostUserId } : {}, query.where] },
        orderBy: query.orderBy,
        take: limit + 1,
        include: ADMIN_MEETING_INCLUDE,
      });
      const page = rows.slice(0, limit);
      const nextCursor = rows.length > limit ? encodeMeetingCursor(page[page.length - 1]!) : null;
      return reply.send(ok(page.map((m) => toAdminMeetingDto(m, now)), { nextCursor }));
    }
  );

  server.post(
    "/:id/cancel",
    {
      config: { rateLimit: ADMIN_MEETINGS_RATE_LIMIT },
      schema: { params: MeetingIdParamSchema, response: { 200: ApiSuccessSchema(AdminMeetingSchema) } },
    },
    async (request, reply) => {
      const meeting = await app.prisma.externalMeeting.findUnique({ where: { id: request.params.id }, include: ADMIN_MEETING_INCLUDE });
      if (!meeting) throw new MeetingNotFoundError();
      await assertNotServiceManaged(app, meeting.id);
      if (meeting.status !== "CANCELLED" && computePhase(meeting) === "ended") throw new MeetingNotEditableError("Biten bir toplantı iptal edilemez.");
      const updated = await cancelMeeting(app, meeting, {
        actorId: request.user!.id,
        actorEmail: request.user!.email,
        ipAddress: request.ip,
        source: "admin",
      });
      return reply.send(ok(toAdminMeetingDto({ ...updated, host: meeting.host, serviceConsultation: meeting.serviceConsultation })));
    }
  );
}
