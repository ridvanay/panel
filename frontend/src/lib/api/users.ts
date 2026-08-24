import { apiFetch, apiFetchPage } from "./client";
import type { ChangePasswordRequest, Order, Page, UpdateUserRequest, User } from "./types";

export function getMe() {
  return apiFetch<User>("/users/me");
}

export function updateMe(input: UpdateUserRequest) {
  return apiFetch<User>("/users/me", { method: "PATCH", body: input });
}

export function changePassword(input: ChangePasswordRequest) {
  return apiFetch<void>("/users/me/change-password", { method: "POST", body: input });
}

export interface ListMyOrdersParams {
  cursor?: string;
  limit?: number;
}

/**
 * `GET /users/me/orders` — authenticated (5 rolün hepsi), `Order.siteUserId = me` sahiplik
 * filtresiyle cursor sayfalı liste döner. ROL GUARD'I YOKTUR (§10.21 §7.4) — bir `USER` bu ucu
 * çağırırsa 403 DEĞİL, boş liste döner (`/siparislerim` boş durumu bu şekilde çizilir).
 * `customerEmail` bu uçta MASKELENMEZ (kullanıcı kendi verisini okuyor).
 */
export function getMyOrders(params: ListMyOrdersParams = {}): Promise<Page<Order>> {
  return apiFetchPage<Order>("/users/me/orders", { query: { cursor: params.cursor, limit: params.limit ?? 20 } });
}
