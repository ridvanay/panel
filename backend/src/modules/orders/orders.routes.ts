import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import type { OrderStatus } from "@prisma/client";
import { z } from "zod";
import { authenticate } from "../../middleware/authenticate";
import { requireSiteRole } from "../../middleware/site-rbac";
import { ok } from "../../lib/envelope";
import { ApiSuccessSchema, ApiSuccessWithMeta } from "../../schemas/common";
import { OrderSchema } from "../../schemas/entities";
import { toOrderDto } from "../../mappers";
import { ConflictError, NotFoundError } from "../../lib/errors";
import { parseCursor, buildPageMeta } from "../../lib/pagination";
import { maskEmail } from "../../lib/pii-mask";
import { logAudit } from "../../lib/audit";
import { ListOrdersQuerySchema, OrderIdParamSchema, UpdateOrderStatusRequestSchema } from "./orders.schemas";

const WITH_ITEMS = { items: true } as const;

/**
 * `PENDING -> CANCELLED` ve `PAID -> FULFILLED` DIŞINDA hiçbir geçişe izin verilmez (bkz.
 * orders.schemas.ts::UpdateOrderStatusRequestSchema notu) — ör. `FAILED`/`EXPIRED`/`REFUNDED`
 * durumundaki bir siparişin durumu bu uçtan DEĞİŞTİRİLEMEZ (iade/manuel düzeltme bu fazın
 * kapsamı DIŞINDA, bkz. görev notu).
 */
const ALLOWED_TRANSITIONS: Record<string, OrderStatus> = {
  PAID: "FULFILLED",
  PENDING: "CANCELLED",
};

/**
 * `/admin/orders` prefix'i altında bağlanır (bkz. app.ts) — yalnızca ADMIN.
 *
 * PII maskeleme kararı: `customerEmail` LİSTEDE (`GET /`) maskelenir (`lib/pii-mask.ts::maskEmail`,
 * `a***@domain.com`), DETAYDA (`GET /:orderId`) maskesiz döner. Gerekçe: liste ekranı toplu
 * göz atma/triage amaçlıdır (ör. ekran paylaşımı, çoklu sipariş taraması) ve tam e-posta ORADA
 * gerekli değildir; detay ekranı ise fiilen kargo/iletişim amacıyla AÇILIR ve admin'in müşteriyle
 * iletişime geçmesi (ör. teslimat sorunu) için tam adrese ihtiyacı vardır — maskeli bir adresle
 * bu iş akışı imkânsız hale gelir. Bu, mevcut RBAC hardening turundaki "liste maskeli, detay
 * açık" kararıyla AYNI yaklaşımdır.
 */
export async function ordersRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>();
  server.addHook("preHandler", authenticate);
  server.addHook("preHandler", requireSiteRole("ADMIN"));

  server.get(
    "/",
    {
      schema: {
        querystring: ListOrdersQuerySchema,
        response: { 200: ApiSuccessWithMeta(z.array(OrderSchema), z.object({ nextCursor: z.string().nullable() })) },
      },
    },
    async (request, reply) => {
      const { cursor, limit, status } = request.query;
      const cursorSeq = parseCursor(cursor);

      const rows = await app.prisma.order.findMany({
        where: { ...(cursorSeq ? { seq: { gt: cursorSeq } } : {}), ...(status ? { status } : {}) },
        orderBy: { seq: "asc" },
        take: limit,
        include: WITH_ITEMS,
      });

      const dtos = rows.map((row) => ({ ...toOrderDto(row), customerEmail: maskEmail(row.customerEmail) }));
      return reply.send(ok(dtos, buildPageMeta(rows, limit)));
    }
  );

  server.get(
    "/:orderId",
    { schema: { params: OrderIdParamSchema, response: { 200: ApiSuccessSchema(OrderSchema) } } },
    async (request, reply) => {
      const order = await app.prisma.order.findUnique({ where: { id: request.params.orderId }, include: WITH_ITEMS });
      if (!order) throw new NotFoundError("Sipariş bulunamadı.");

      return reply.send(ok(toOrderDto(order)));
    }
  );

  server.patch(
    "/:orderId/status",
    {
      schema: {
        params: OrderIdParamSchema,
        body: UpdateOrderStatusRequestSchema,
        response: { 200: ApiSuccessSchema(OrderSchema) },
      },
    },
    async (request, reply) => {
      const existing = await app.prisma.order.findUnique({ where: { id: request.params.orderId } });
      if (!existing) throw new NotFoundError("Sipariş bulunamadı.");

      const { status: targetStatus } = request.body;
      if (ALLOWED_TRANSITIONS[existing.status] !== targetStatus) {
        throw new ConflictError(`"${existing.status}" durumundaki bir sipariş "${targetStatus}" durumuna geçirilemez.`);
      }

      const order = await app.prisma.order.update({
        where: { id: existing.id },
        data: { status: targetStatus },
        include: WITH_ITEMS,
      });

      await logAudit(app, {
        actorId: request.user!.id,
        actorEmail: request.user!.email,
        action: "order.status_change",
        targetType: "Order",
        targetId: order.id,
        metadata: { from: existing.status, to: targetStatus },
        ipAddress: request.ip,
      });

      return reply.send(ok(toOrderDto(order)));
    }
  );
}
