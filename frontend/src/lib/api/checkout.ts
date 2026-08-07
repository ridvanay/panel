import { apiFetch } from "./client";
import type { CheckoutSessionResponse, CreateCartCheckoutSessionRequest } from "./types";

/**
 * Sepetten Stripe Checkout oturumu başlatır — dönen `checkoutUrl` HARİCİ bir Stripe domaini
 * olduğu için çağıran taraf `window.location.href` ile yönlendirmelidir (Next.js router DEĞİL).
 * Rate limit: 10/dk (bkz. görev notu). 409: sepet boş/ürün artık satılamıyor/stok yetersiz.
 */
export function createCheckoutSession(input: CreateCartCheckoutSessionRequest) {
  return apiFetch<CheckoutSessionResponse>("/checkout/session", { method: "POST", body: input });
}
