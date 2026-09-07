import { apiFetch } from "./client";
import type { CheckoutSessionResponse, CreateCartCheckoutSessionRequest } from "./types";

/**
 * Sepetten Stripe Checkout oturumu başlatır — dönen `checkoutUrl` HARİCİ bir Stripe domaini
 * olduğu için çağıran taraf `window.location.assign(...)` ile yönlendirmelidir (Next.js router
 * DEĞİL, `.href` ataması react-compiler'ın dış değişken mutasyonu kuralına takılır). Rate limit:
 * 10/dk. 409: sepet boş/ürün artık satılamıyor/stok yetersiz. 422: `error.details` anahtarları
 * `shippingAddress.*`/`billing.*` alan yollarıyla BİREBİR eşleşir (bkz.
 * `.claude/architect-scope-checkout-redesign.md` §5.2/§6.2) — çağıran taraf `setError(key, ...)`
 * ile forma bağlar.
 */
export function createCheckoutSession(input: CreateCartCheckoutSessionRequest) {
  return apiFetch<CheckoutSessionResponse>("/checkout/session", { method: "POST", body: input });
}
