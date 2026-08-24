import { redirectIfModuleDisabledServer } from "@/lib/api/server-modules";
import { OrderDetailClient } from "./order-detail-client";

/**
 * §customer-portal §4.1/§4.3 — `products` modülü kapalıyken `/hesabim/profil`'e yönlendirilir
 * (bkz. `siparislerim/page.tsx` üst notu — AYNI kural). Sipariş verisi `GET /users/me/orders/{orderId}`
 * üzerinden client tarafında çekilir (`OrderDetailClient`).
 */
export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ lang: string; orderId: string }>;
}) {
  const { lang, orderId } = await params;
  await redirectIfModuleDisabledServer(lang, "products");

  return <OrderDetailClient orderId={orderId} />;
}
