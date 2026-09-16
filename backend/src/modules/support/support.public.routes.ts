import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { authenticateOptional } from "../../middleware/authenticate";
import { ok } from "../../lib/envelope";
import { ApiSuccessSchema, ApiSuccessWithMeta } from "../../schemas/common";
import { CreateSupportSessionResponseSchema, SupportChatMessagePublicSchema, SupportSessionStatusSchema } from "../../schemas/entities";
import { toSupportChatMessagePublicDto } from "../../mappers";
import { NotFoundError } from "../../lib/errors";
import { SUPPORT_SESSION_CREATE_RATE_LIMIT, SUPPORT_MESSAGE_RATE_LIMIT, SUPPORT_POLL_RATE_LIMIT } from "../../lib/rate-limit";
import { CreateSupportSessionRequestSchema, SendSupportMessageRequestSchema, SessionIdParamSchema, SupportAccessTokenQuerySchema, SupportAfterSeqQuerySchema } from "./support.schemas";
import { appendVisitorMessage, createSupportSessionWithFirstMessage, findSessionByAccessToken, isInternalLiveChatEnabled } from "./support.service";

const SupportMessagesQuerySchema = SupportAccessTokenQuerySchema.merge(SupportAfterSeqQuerySchema);
const SupportMessagesMetaSchema = z.object({
  status: SupportSessionStatusSchema,
  lastSeq: z.number().int().nullable(),
});

/**
 * `/support` prefix'i altında bağlanır (bkz. app.ts) — herkese açık, kimlik doğrulama YOK
 * (openapi.yaml: `security: []`). `.claude/architect-scope-support-desk-and-reminders.md` §3.5 —
 * `liveChatEnabled && liveChatProvider === "internal"` DEĞİLSE TÜM uçlar `404` (modül kapalı
 * davranışıyla AYNI, ayrım yapılmaz).
 */
export async function supportPublicRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>();
  // §7.3 (2026-09-16) — `checkout.routes.ts:64` İLE AYNI desen: header YOKSA/geçersizse 401
  // FIRLATILMAZ, misafir akışı aynen çalışır (`security: []` DOĞRU kalır, DEĞİŞMEZ).
  server.addHook("preHandler", authenticateOptional);

  server.post(
    "/sessions",
    {
      // §3.6 madde 4 — 3 istek/dakika/IP.
      config: { rateLimit: SUPPORT_SESSION_CREATE_RATE_LIMIT },
      schema: {
        body: CreateSupportSessionRequestSchema,
        response: { 201: ApiSuccessSchema(CreateSupportSessionResponseSchema) },
      },
    },
    async (request, reply) => {
      if (!(await isInternalLiveChatEnabled(app))) throw new NotFoundError();

      const { session, message, rawAccessToken } = await createSupportSessionWithFirstMessage(app, {
        message: request.body.message,
        // §7.3 (2026-09-16) — `request.user` DOLUYSA (`authenticateOptional`) bu üç alan
        // servis katmanında `User.name`/`User.phone`/`User.email`'den YENİDEN DOLDURULUR ve
        // buradaki gövde değerleri YOKSAYILIR; misafirde (`request.user` yok) aynen kullanılır.
        visitorName: request.body.visitorName ?? null,
        visitorPhone: request.body.visitorPhone ?? null,
        visitorEmail: request.body.visitorEmail ?? null,
        authenticatedUserId: request.user?.id ?? null,
        pageUrl: request.body.pageUrl ?? null,
        locale: request.body.locale ?? null,
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"] ?? null,
      });

      return reply.code(201).send(
        ok({
          sessionId: session.id,
          accessToken: rawAccessToken,
          status: session.status,
          message: toSupportChatMessagePublicDto(message),
        })
      );
    }
  );

  server.get(
    "/sessions/:sessionId/messages",
    {
      // §3.6 madde 4 — 60 istek/dakika/IP.
      config: { rateLimit: SUPPORT_POLL_RATE_LIMIT },
      schema: {
        params: SessionIdParamSchema,
        querystring: SupportMessagesQuerySchema,
        response: { 200: ApiSuccessWithMeta(z.array(SupportChatMessagePublicSchema), SupportMessagesMetaSchema) },
      },
    },
    async (request, reply) => {
      if (!(await isInternalLiveChatEnabled(app))) throw new NotFoundError();

      const session = await findSessionByAccessToken(app, request.params.sessionId, request.query.t);
      if (!session) throw new NotFoundError();

      const messages = await app.prisma.supportChatMessage.findMany({
        where: {
          sessionId: session.id,
          ...(request.query.afterSeq !== undefined ? { seq: { gt: request.query.afterSeq } } : {}),
        },
        orderBy: { seq: "asc" },
        take: 200,
      });
      const lastSeq = messages.length > 0 ? messages[messages.length - 1]!.seq : null;

      return reply.send(ok(messages.map(toSupportChatMessagePublicDto), { status: session.status, lastSeq }));
    }
  );

  server.post(
    "/sessions/:sessionId/messages",
    {
      // §3.6 madde 4 — 10 istek/dakika/IP.
      config: { rateLimit: SUPPORT_MESSAGE_RATE_LIMIT },
      schema: {
        params: SessionIdParamSchema,
        querystring: SupportAccessTokenQuerySchema,
        body: SendSupportMessageRequestSchema,
        response: { 201: ApiSuccessSchema(SupportChatMessagePublicSchema) },
      },
    },
    async (request, reply) => {
      if (!(await isInternalLiveChatEnabled(app))) throw new NotFoundError();

      const session = await findSessionByAccessToken(app, request.params.sessionId, request.query.t);
      if (!session) throw new NotFoundError();

      const message = await appendVisitorMessage(app, session, request.body.body);
      return reply.code(201).send(ok(toSupportChatMessagePublicDto(message)));
    }
  );
}
