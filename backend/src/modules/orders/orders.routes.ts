import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import type { OrderStatus } from "@prisma/client";
import Stripe from "stripe";
import { z } from "zod";
import { authenticate } from "../../middleware/authenticate";
import { requireSiteRole } from "../../middleware/site-rbac";
import { stripe } from "../../lib/stripe";
import { ok } from "../../lib/envelope";
import { ApiSuccessSchema, ApiSuccessWithMeta } from "../../schemas/common";
import { OrderSchema } from "../../schemas/entities";
import { toOrderDto } from "../../mappers";
import { ConflictError, NotFoundError } from "../../lib/errors";
import { parseCursor, buildPageMeta } from "../../lib/pagination";
import { maskEmail } from "../../lib/pii-mask";
import { logAudit } from "../../lib/audit";
import { emitWebhookEvent } from "../../lib/webhook-emitter";
import { buildWebhookOrderPayload } from "../../lib/webhook-order-payload";
import {
  ListOrdersQuerySchema,
  OrderIdParamSchema,
  RefundOrderRequestSchema,
  UpdateOrderStatusRequestSchema,
} from "./orders.schemas";

/** Manuel iade ile hedeflenebilecek kaynak durumlar — bkz. orders.routes.ts::server.post("/:orderId/refund"). */
const REFUNDABLE_STATUSES: OrderStatus[] = ["PAID", "FULFILLED"];

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

      // §10.13.8 — `ORDER_STATUS_CHANGED`, durum güncellemesi commit'inden SONRA tetiklenir.
      await emitWebhookEvent(app, "ORDER_STATUS_CHANGED", await buildWebhookOrderPayload(app, order, existing.status));

      return reply.send(ok(toOrderDto(order)));
    }
  );

  /**
   * Manuel iade — yalnızca ADMIN (router seviyesindeki `requireSiteRole("ADMIN")` hook'u zaten
   * uygulanıyor). Gerçek parayı Stripe üzerinden GERİ ÖDER (`stripe.refunds.create`,
   * `Order.stripePaymentIntentId` üzerinden) — yalnızca DB durumunu değiştirip parayı olduğu
   * gibi bırakan "sahte" bir iade DEĞİLDİR.
   *
   * Çifte iade / race koruması: durum geçişi `updateMany({ where: { status: { in: PAID|FULFILLED } } })`
   * ile ATOMİK "claim" edilir (bkz. `Postgres.README` yok — standart satır kilidi semantiği: aynı
   * satıra eşzamanlı gelen ikinci `UPDATE`, birincinin commit'ini bekler ve `WHERE`'i YENİDEN
   * değerlendirir). Bu sayede iki eşzamanlı `POST /refund` isteğinden yalnızca BİRİ Stripe'a gerçek
   * iade isteği gönderebilir — diğeri `claim.count === 0` ile 409 alır ve Stripe'a HİÇ gitmez.
   * (Faz 2b'deki `runSerializable` — bkz. lib/serializable-tx.ts — burada gerekli DEĞİL: o, birden
   * çok tabloyu/satırı kapsayan çok adımlı okuma+yazmalar için; burada tek satırlık koşullu UPDATE
   * yeterli ve dış bir ağ çağrısını [Stripe] bir DB transaction'ı içinde tutmaktan kaçınır.)
   *
   * Ayrıca `stripe.refunds.create`'e siparişe göre DETERMİNİSTİK bir `idempotencyKey` verilir —
   * ağ hatası/timeout sonrası bir retry (istemci ya da Stripe SDK'sının kendi iç retry mekanizması)
   * AYNI Stripe iade kaydını döner, ikinci bir gerçek para hareketi TETİKLEMEZ.
   */
  server.post(
    "/:orderId/refund",
    {
      schema: {
        params: OrderIdParamSchema,
        body: RefundOrderRequestSchema,
        response: { 200: ApiSuccessSchema(OrderSchema) },
      },
    },
    async (request, reply) => {
      const existing = await app.prisma.order.findUnique({ where: { id: request.params.orderId } });
      if (!existing) throw new NotFoundError("Sipariş bulunamadı.");

      if (!REFUNDABLE_STATUSES.includes(existing.status)) {
        throw new ConflictError(`"${existing.status}" durumundaki bir sipariş iade edilemez.`);
      }
      if (!existing.stripePaymentIntentId) {
        throw new ConflictError("Sipariş için bir Stripe ödeme kaydı bulunamadı, iade edilemez.");
      }

      const claim = await app.prisma.order.updateMany({
        where: { id: existing.id, status: { in: REFUNDABLE_STATUSES } },
        data: { status: "REFUNDED" },
      });
      if (claim.count === 0) {
        throw new ConflictError("Sipariş durumu değişti, iade edilemedi. Lütfen sayfayı yenileyip tekrar deneyin.");
      }

      let refund: Stripe.Refund;
      try {
        refund = await stripe.refunds.create(
          { payment_intent: existing.stripePaymentIntentId, reason: "requested_by_customer" },
          { idempotencyKey: `order-refund-${existing.id}` }
        );
      } catch (err) {
        // Stripe isteği başarısız oldu — claim'i GERİ AL, sipariş yeniden iade edilebilir kalsın.
        await app.prisma.order.update({ where: { id: existing.id }, data: { status: existing.status } });
        const message = err instanceof Stripe.errors.StripeError ? err.message : "Stripe iade isteği başarısız oldu.";
        throw new ConflictError(`İade işlemi Stripe tarafından reddedildi: ${message}`);
      }

      const { reason } = request.body;
      const order = await app.prisma.order.findUnique({ where: { id: existing.id }, include: WITH_ITEMS });

      await logAudit(app, {
        actorId: request.user!.id,
        actorEmail: request.user!.email,
        action: "order.refund",
        targetType: "Order",
        targetId: existing.id,
        metadata: { from: existing.status, to: "REFUNDED", reason: reason ?? null, stripeRefundId: refund.id },
        ipAddress: request.ip,
      });

      // §10.13.8 — iade de bir `ORDER_STATUS_CHANGED`dir (orders.routes.ts status PATCH ile AYNI olay).
      await emitWebhookEvent(app, "ORDER_STATUS_CHANGED", await buildWebhookOrderPayload(app, order!, existing.status));

      return reply.send(ok(toOrderDto(order!)));
    }
  );
}
