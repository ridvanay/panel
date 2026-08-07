import { apiFetch } from "./client";
import type { AddCartItemRequest, Cart, UpdateCartItemRequest } from "./types";

export function getCart() {
  return apiFetch<Cart>("/cart");
}

export function addCartItem(input: AddCartItemRequest) {
  return apiFetch<Cart>("/cart/items", { method: "POST", body: input });
}

export function updateCartItem(itemId: string, input: UpdateCartItemRequest) {
  return apiFetch<Cart>(`/cart/items/${itemId}`, { method: "PATCH", body: input });
}

/**
 * Backend'in bu uçta 200 (gövdede güncel `Cart`) mi yoksa 204 (boş gövde) mi döndüğü kesinleşmemiş
 * ("kontrol et" notu, bkz. görev tanımı) — `apiFetch` 204'te `undefined` döner, bu durumda sepeti
 * TEKRAR ÇEKEREK savunmacı davranıyoruz; her iki ihtimalde de çağıran her zaman güncel bir `Cart` alır.
 */
export async function removeCartItem(itemId: string): Promise<Cart> {
  const result = await apiFetch<Cart | undefined>(`/cart/items/${itemId}`, { method: "DELETE" });
  return result ?? getCart();
}
