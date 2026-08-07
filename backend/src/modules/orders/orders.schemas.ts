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
 * §10.9.3 — yalnızca İKİ geçişe izin verilir (bkz. orders.routes.ts): `PAID -> FULFILLED`
 * (kargoya verildi/teslim edildi) ve `PENDING -> CANCELLED` (admin ödeme beklenmeden manuel
 * iptal eder). Diğer TÜM durum kombinasyonları (ör. `FAILED -> FULFILLED`, `CANCELLED -> PAID`)
 * route handler'da 409 ile reddedilir.
 */
export const UpdateOrderStatusRequestSchema = z.object({
  status: z.enum(["FULFILLED", "CANCELLED"]),
});
