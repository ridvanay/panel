import { apiFetch, apiFetchPage } from "./client";
import type {
  Address,
  ChangePasswordRequest,
  CreateAddressRequest,
  Order,
  Page,
  UpdateAddressRequest,
  UpdateUserRequest,
  User,
  WishlistItem,
} from "./types";

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

/**
 * `GET /users/me/orders/{orderId}` — `/hesabim/siparislerim/{orderId}` fatura/kargo detay
 * ekranını besleyen uç. `Order.siteUserId = me` filtresiyle bulunur; başkasının siparişi veya
 * var olmayan bir id **404** döner (403 DEĞİL — id'nin VARLIĞI dahi sızdırılmaz). Modül
 * guard'ı YOK (§3 — ödenmiş sipariş bir mali kayıttır, `products` kapalıyken de erişilebilir).
 */
export function getMyOrder(orderId: string) {
  return apiFetch<Order>(`/users/me/orders/${orderId}`);
}

/**
 * `GET /users/me/addresses` — sahiplik filtresi, rol/modül guard'ı YOK ("her zaman açık"
 * sekme). Sayfalama YOK (üst sınır 20 adres), `seq asc` sıralı.
 */
export function getMyAddresses() {
  return apiFetch<Address[]>("/users/me/addresses");
}

/** `POST /users/me/addresses` — 20 adres sınırı aşılırsa 409. İlk adres otomatik varsayılandır. */
export function createMyAddress(input: CreateAddressRequest) {
  return apiFetch<Address>("/users/me/addresses", { method: "POST", body: input });
}

/** `PATCH /users/me/addresses/{addressId}` — başkasının adresiyle çağrılırsa 404 (403 DEĞİL). */
export function updateMyAddress(addressId: string, input: UpdateAddressRequest) {
  return apiFetch<Address>(`/users/me/addresses/${addressId}`, { method: "PATCH", body: input });
}

/** `DELETE /users/me/addresses/{addressId}` — 204, başkasının adresiyle çağrılırsa 404. */
export function deleteMyAddress(addressId: string) {
  return apiFetch<void>(`/users/me/addresses/${addressId}`, { method: "DELETE" });
}

/**
 * `GET /users/me/wishlist` — `requireModuleEnabled("products")`: modül kapalıyken **404**
 * döner (§3 — favoriler türetilmiş/katalog-bağımlı veridir, siparişlerin AKSİNE).
 */
export function getMyWishlist() {
  return apiFetch<WishlistItem[]>("/users/me/wishlist");
}

/**
 * `POST /users/me/wishlist` — ürün zaten favorideyse 200 ile mevcut kayıt döner (İDEMPOTENT,
 * 409 DEĞİL). 100 favori sınırı aşılırsa 409.
 */
export function addToMyWishlist(productId: string) {
  return apiFetch<WishlistItem>("/users/me/wishlist", { method: "POST", body: { productId } });
}

/** `DELETE /users/me/wishlist/{productId}` — anahtar `productId`'dir; kayıt yoksa da 204 (İDEMPOTENT). */
export function removeFromMyWishlist(productId: string) {
  return apiFetch<void>(`/users/me/wishlist/${productId}`, { method: "DELETE" });
}
