import { apiFetch, apiFetchPage } from "./client";
import type { Order, OrderStatus, Page, RefundOrderRequest, UpdateOrderStatusRequest } from "./types";

export interface ListOrdersParams {
  cursor?: string;
  limit?: number;
  status?: OrderStatus;
}

/** `GET /admin/orders` — yalnızca ADMIN, cursor sayfalı, listedeki `customerEmail` MASKELİ. */
export function listOrders(params: ListOrdersParams = {}): Promise<Page<Order>> {
  return apiFetchPage<Order>("/admin/orders", {
    query: { cursor: params.cursor, limit: params.limit ?? 50, status: params.status },
  });
}

/** `GET /admin/orders/:orderId` — `customerEmail` MASKESİZ döner. */
export function getOrder(orderId: string) {
  return apiFetch<Order>(`/admin/orders/${orderId}`);
}

/** `PATCH /admin/orders/:orderId/status` — sadece `PENDING→CANCELLED`, `PAID→FULFILLED` izinli, aksi halde 409. */
export function updateOrderStatus(orderId: string, input: UpdateOrderStatusRequest) {
  return apiFetch<Order>(`/admin/orders/${orderId}/status`, { method: "PATCH", body: input });
}

/** `POST /admin/orders/:orderId/refund` — sadece `PAID`/`FULFILLED` sipariş için, aksi halde 409. */
export function refundOrder(orderId: string, reason?: string) {
  return apiFetch<Order>(`/admin/orders/${orderId}/refund`, {
    method: "POST",
    body: { reason } satisfies RefundOrderRequest,
  });
}
