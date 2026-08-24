import { redirectIfModuleDisabledServer } from "@/lib/api/server-modules";
import { OrdersListClient } from "./orders-list-client";

/**
 * §customer-portal §4.1/§4.3 — `products` modülü kapalıyken bu rotaya doğrudan girilirse
 * `/hesabim/profil`'e yönlendirilir (404 DEĞİL). Modül açıkken içerik `OrdersListClient`'a
 * devredilir (auth guard'ı `hesabim/layout.tsx`'te — bu sayfa yalnızca authenticated iken mount edilir).
 */
export default async function MyOrdersPage({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  await redirectIfModuleDisabledServer(lang, "products");

  return <OrdersListClient />;
}
