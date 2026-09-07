import { apiFetch, apiFetchPage } from "./client";
import type {
  AdminOrder,
  OrderActivityEntry,
  OrderStatus,
  Page,
  RefundOrderRequest,
  UpdateOrderRequest,
  UpdateOrderStatusRequest,
} from "./types";

export interface ListOrdersParams {
  cursor?: string;
  limit?: number;
  status?: OrderStatus;
}

/** `GET /admin/orders` — ADMIN+MANAGER, cursor sayfalı, listedeki `customerEmail` MASKELİ. */
export function listOrders(params: ListOrdersParams = {}): Promise<Page<AdminOrder>> {
  return apiFetchPage<AdminOrder>("/admin/orders", {
    query: { cursor: params.cursor, limit: params.limit ?? 50, status: params.status },
  });
}

/** `GET /admin/orders/:orderId` — `customerEmail` MASKESİZ döner. */
export function getOrder(orderId: string) {
  return apiFetch<AdminOrder>(`/admin/orders/${orderId}`);
}

/**
 * `PATCH /admin/orders/:orderId/status` — `.claude/architect-scope-order-management-pro.md` §4.1
 * geçiş tablosuna tabi (409). `ON_HOLD`/`PAID`/`CANCELLED` hedefleri yalnızca ADMIN'e açıktır (403).
 */
export function updateOrderStatus(orderId: string, input: UpdateOrderStatusRequest) {
  return apiFetch<AdminOrder>(`/admin/orders/${orderId}/status`, { method: "PATCH", body: input });
}

/**
 * `PATCH /admin/orders/:orderId` — YENİ (§5.3), yalnızca ADMIN. İletişim/adres/fatura yalnızca
 * `status ∈ {PENDING,PAID,ON_HOLD}` iken düzenlenebilir (aksi halde 409); `adminNotes` her durumda.
 */
export function updateOrder(orderId: string, input: UpdateOrderRequest) {
  return apiFetch<AdminOrder>(`/admin/orders/${orderId}`, { method: "PATCH", body: input });
}

/** `GET /admin/orders/:orderId/activity` — YENİ (§5.4), ADMIN+MANAGER. `ipAddress` DÖNMEZ. */
export function getOrderActivity(orderId: string) {
  return apiFetch<OrderActivityEntry[]>(`/admin/orders/${orderId}/activity`);
}

/** `POST /admin/orders/:orderId/refund` — sadece `PAID`/`SHIPPED`/`FULFILLED`/`ON_HOLD` sipariş için, aksi halde 409. */
export function refundOrder(orderId: string, reason?: string) {
  return apiFetch<AdminOrder>(`/admin/orders/${orderId}/refund`, {
    method: "POST",
    body: { reason } satisfies RefundOrderRequest,
  });
}
