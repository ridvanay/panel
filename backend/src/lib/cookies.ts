import { env, isProd } from "../config/env";

export const REFRESH_COOKIE_NAME = "refresh_token";
/** openapi.yaml'daki tüm /auth/* uçları bu path altında; cookie yalnızca bu uçlara gider. */
export const REFRESH_COOKIE_PATH = "/api/v1/auth";

export function refreshCookieOptions() {
  return {
    httpOnly: true,
    secure: isProd,
    sameSite: "strict" as const,
    path: REFRESH_COOKIE_PATH,
    maxAge: env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60,
  };
}

// §10.9.3 Sepet + Stripe Checkout — bkz. modules/cart/cart.routes.ts.
export const CART_COOKIE_NAME = "cart_token";
/** `REFRESH_COOKIE_PATH`'in aksine tüm API altında geçerli: `/` — Stripe checkout başarı/iptal
 * yönlendirmesi sonrası da (frontend, farklı bir uçtan sepeti temizleyebilir/gösterebilir)
 * cookie taşınmalı. */
export const CART_COOKIE_PATH = "/";
export const CART_TOKEN_TTL_DAYS = 30;

/**
 * `refreshCookieOptions` İLE AYNI YAPI, tek fark `sameSite`: burası KASITLI olarak `"lax"`
 * (`"strict"` DEĞİL) — kullanıcı Stripe Checkout'a yönlendirilip ödeme sonrası
 * `success_url`/`cancel_url` ile siteye GERİ DÖNDÜĞÜNDE bu bir cross-site navigasyondur
 * (Stripe'ın domain'inden bizim domain'imize top-level GET yönlendirmesi). `sameSite: "strict"`
 * bu durumda cookie'yi taşımaz (tarayıcı, farklı origin'den gelen navigasyonda strict cookie'yi
 * göndermez) — sepet token'ı kaybolur ve kullanıcı "sipariş onaylandı" ekranında sepetini/siparişini
 * göremez. `"lax"`, GET tabanlı top-level navigasyonlarda cookie'yi taşırken CSRF açısından hâlâ
 * makul bir varsayılan sağlar (bkz. MDN SameSite=Lax).
 */
export function cartCookieOptions() {
  return {
    httpOnly: true,
    secure: isProd,
    sameSite: "lax" as const,
    path: CART_COOKIE_PATH,
    maxAge: CART_TOKEN_TTL_DAYS * 24 * 60 * 60,
  };
}
