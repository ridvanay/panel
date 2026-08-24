import { z } from "zod";
import { OrderStatusSchema } from "../../schemas/entities";
import { CursorQuerySchema } from "../../schemas/common";

export const ListOrdersQuerySchema = CursorQuerySchema.extend({
  status: OrderStatusSchema.optional(),
});

export const OrderIdParamSchema = z.object({
  orderId: z.string().uuid(),
});

/**
 * `.claude/architect-scope-customer-portal.md` §6 — geçiş tablosu genişledi: `PENDING ->
 * CANCELLED`, `PAID -> SHIPPED|FULFILLED`, `SHIPPED -> FULFILLED`. Diğer TÜM durum
 * kombinasyonları (ör. `FAILED -> FULFILLED`, `CANCELLED -> PAID`) route handler'da (bkz.
 * orders.routes.ts::ALLOWED_TRANSITIONS) 409 ile reddedilir.
 *
 * `status: SHIPPED` iken `trackingNumber` ZORUNLUDUR (§2.4) — eksikse 422. `shippingCarrier`
 * her zaman opsiyoneldir (serbest metin, enum v1'de açılmaz).
 */
export const UpdateOrderStatusRequestSchema = z
  .object({
    status: z.enum(["SHIPPED", "FULFILLED", "CANCELLED"]),
    trackingNumber: z.string().min(1).max(100).optional(),
    shippingCarrier: z.string().min(1).max(100).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.status === "SHIPPED" && !data.trackingNumber) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["trackingNumber"],
        message: "SHIPPED durumuna geçişte kargo takip numarası zorunludur.",
      });
    }
  });

/** `POST /:orderId/refund` — yalnızca `PAID`/`FULFILLED` siparişlerde kabul edilir (bkz. orders.routes.ts). */
export const RefundOrderRequestSchema = z.object({
  reason: z.string().min(1).max(500).optional(),
});
